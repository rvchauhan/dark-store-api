import { randomBytes } from "node:crypto";
import { and, desc, eq, ilike, isNotNull, notExists, or, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { masterCatalog } from "../../db/schema/catalog.js";
import { storeSkuMapping } from "../../db/schema/store.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { AuthUser } from "../../shared/types/auth.js";
import type { CreateSkuInput, ListSkusQuery, UpdateSkuInput } from "./catalog.schemas.js";

/**
 * Catalog module service — owns master_catalog CRUD.
 *
 * Module boundary rules:
 * - Only touches master_catalog (+ read store_sku_mapping for "unassigned" filter)
 * - Never writes to stores or inventory tables
 * - Always scopes queries by business_id from JWT
 *
 * Future split: deploy as catalog-service with POST/GET /catalog/skus endpoints.
 */

type PgError = { code?: string; constraint?: string };

/**
 * drizzle-orm ≥0.44 wraps driver errors in DrizzleQueryError with the pg error
 * on `cause`, so unwrap before checking for a unique violation (23505).
 */
function asUniqueViolation(err: unknown): PgError | null {
  let current: unknown = err;
  for (let depth = 0; depth < 3 && typeof current === "object" && current !== null; depth++) {
    const candidate = current as PgError & { cause?: unknown };
    if (candidate.code === "23505") return candidate;
    current = candidate.cause;
  }
  return null;
}

function generateSkuCode(): string {
  // 6 chars from an unambiguous alphabet (no 0/O/1/I)
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let suffix = "";
  for (const b of bytes) suffix += alphabet[b % alphabet.length];
  return `SKU-${suffix}`;
}

const SKU_CODE_RETRIES = 3;

export class CatalogService {
  async createSku(auth: AuthUser, input: CreateSkuInput) {
    // Client-supplied codes fail fast on conflict; generated ones retry.
    const generateCode = !input.skuCode;

    for (let attempt = 0; ; attempt++) {
      const skuCode = input.skuCode ?? generateSkuCode();
      try {
        const [sku] = await db
          .insert(masterCatalog)
          .values({
            businessId: auth.businessId,
            name: input.name,
            brand: input.brand,
            category: input.category,
            barcode: input.barcode,
            basePrice: input.basePrice.toFixed(2),
            currency: input.currency,
            compareAtPrice: input.compareAtPrice?.toFixed(2),
            costPrice: input.costPrice?.toFixed(2),
            taxRate: input.taxRate.toFixed(2),
            allowBackorder: input.allowBackorder,
            unitOfMeasure: input.unitOfMeasure,
            skuCode,
            isFragile: input.isFragile,
            requiresColdStorage: input.requiresColdStorage,
            weightKg: input.weightKg?.toFixed(3),
            dimensionsCm: input.dimensionsCm,
            defaultReorderPoint: input.defaultReorderPoint,
            defaultInitialStock: input.defaultInitialStock,
            variantOptions: input.variantOptions,
            variants: input.variants,
            images: input.images,
            description: input.description,
            specs: input.specs,
            status: input.status,
          })
          .returning();

        // MVP "event": sku.created — in-process only until we add a message bus
        return sku;
      } catch (err: unknown) {
        const violation = asUniqueViolation(err);
        if (violation) {
          if (violation.constraint === "master_catalog_business_sku_code_unique") {
            if (generateCode && attempt < SKU_CODE_RETRIES) continue;
            throw new AppError(409, "SKU code already exists in this catalog", "DUPLICATE_SKU_CODE");
          }
          throw new AppError(409, "Barcode already exists in this catalog", "DUPLICATE_BARCODE");
        }
        throw err;
      }
    }
  }

  /** Partial update for the "Edit SKU" flow — only touches provided fields. */
  async updateSku(auth: AuthUser, skuId: string, input: UpdateSkuInput) {
    await this.getSku(auth, skuId);

    try {
      const [updated] = await db
        .update(masterCatalog)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.brand !== undefined ? { brand: input.brand } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
          ...(input.basePrice !== undefined ? { basePrice: input.basePrice.toFixed(2) } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.compareAtPrice !== undefined ? { compareAtPrice: input.compareAtPrice.toFixed(2) } : {}),
          ...(input.costPrice !== undefined ? { costPrice: input.costPrice.toFixed(2) } : {}),
          ...(input.taxRate !== undefined ? { taxRate: input.taxRate.toFixed(2) } : {}),
          ...(input.allowBackorder !== undefined ? { allowBackorder: input.allowBackorder } : {}),
          ...(input.unitOfMeasure !== undefined ? { unitOfMeasure: input.unitOfMeasure } : {}),
          ...(input.skuCode !== undefined ? { skuCode: input.skuCode } : {}),
          ...(input.isFragile !== undefined ? { isFragile: input.isFragile } : {}),
          ...(input.requiresColdStorage !== undefined
            ? { requiresColdStorage: input.requiresColdStorage }
            : {}),
          ...(input.weightKg !== undefined ? { weightKg: input.weightKg.toFixed(3) } : {}),
          ...(input.dimensionsCm !== undefined ? { dimensionsCm: input.dimensionsCm } : {}),
          ...(input.defaultReorderPoint !== undefined
            ? { defaultReorderPoint: input.defaultReorderPoint }
            : {}),
          ...(input.defaultInitialStock !== undefined
            ? { defaultInitialStock: input.defaultInitialStock }
            : {}),
          ...(input.variantOptions !== undefined ? { variantOptions: input.variantOptions } : {}),
          ...(input.variants !== undefined ? { variants: input.variants } : {}),
          ...(input.images !== undefined ? { images: input.images } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.specs !== undefined ? { specs: input.specs } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(masterCatalog.id, skuId), eq(masterCatalog.businessId, auth.businessId)))
        .returning();

      return updated;
    } catch (err: unknown) {
      const violation = asUniqueViolation(err);
      if (violation) {
        if (violation.constraint === "master_catalog_business_sku_code_unique") {
          throw new AppError(409, "SKU code already exists in this catalog", "DUPLICATE_SKU_CODE");
        }
        throw new AppError(409, "Barcode already exists in this catalog", "DUPLICATE_BARCODE");
      }
      throw err;
    }
  }

  async listSkus(auth: AuthUser, query: ListSkusQuery) {
    const conditions = [eq(masterCatalog.businessId, auth.businessId)];

    if (query.status && query.status !== "unassigned") {
      conditions.push(eq(masterCatalog.status, query.status));
    }

    if (query.search) {
      conditions.push(
        or(
          ilike(masterCatalog.name, `%${query.search}%`),
          ilike(masterCatalog.brand, `%${query.search}%`),
          ilike(masterCatalog.barcode, `%${query.search}%`),
          ilike(masterCatalog.skuCode, `%${query.search}%`),
        )!,
      );
    }

    // "unassigned" = SKUs with no row in store_sku_mapping yet (HLD GET ?status=unassigned)
    if (query.status === "unassigned") {
      conditions.push(
        notExists(
          db
            .select({ one: sql`1` })
            .from(storeSkuMapping)
            .where(eq(storeSkuMapping.skuId, masterCatalog.id)),
        ),
      );
    }

    return db
      .select()
      .from(masterCatalog)
      .where(and(...conditions))
      .orderBy(desc(masterCatalog.createdAt));
  }

  async getSku(auth: AuthUser, skuId: string) {
    const [sku] = await db
      .select()
      .from(masterCatalog)
      .where(and(eq(masterCatalog.id, skuId), eq(masterCatalog.businessId, auth.businessId)))
      .limit(1);

    if (!sku) {
      throw new AppError(404, "SKU not found", "NOT_FOUND");
    }

    return sku;
  }

  /** Distinct brand/category values for form dropdowns (GET /api/catalog/meta). */
  async getCatalogMeta(auth: AuthUser) {
    const [brands, categories] = await Promise.all([
      db
        .selectDistinct({ value: masterCatalog.brand })
        .from(masterCatalog)
        .where(and(eq(masterCatalog.businessId, auth.businessId), isNotNull(masterCatalog.brand)))
        .orderBy(masterCatalog.brand),
      db
        .selectDistinct({ value: masterCatalog.category })
        .from(masterCatalog)
        .where(and(eq(masterCatalog.businessId, auth.businessId), isNotNull(masterCatalog.category)))
        .orderBy(masterCatalog.category),
    ]);

    return {
      brands: brands.map((r) => r.value).filter((v): v is string => !!v),
      categories: categories.map((r) => r.value).filter((v): v is string => !!v),
    };
  }
}

export const catalogService = new CatalogService();
