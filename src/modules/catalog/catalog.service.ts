import { randomBytes } from "node:crypto";
import type { CatalogStatus, Prisma } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { asUniqueViolation, uniqueHit } from "../../db/prisma-helpers.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { AuthUser } from "../../shared/types/auth.js";
import type { CreateSkuInput, ListSkusQuery, UpdateSkuInput } from "./catalog.schemas.js";
import { syncService } from "../sync/sync.service.js";

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
        const sku = await prisma.masterCatalog.create({
          data: {
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
            dimensionsCm: input.dimensionsCm as Prisma.InputJsonValue | undefined,
            defaultReorderPoint: input.defaultReorderPoint,
            defaultInitialStock: input.defaultInitialStock,
            variantOptions: input.variantOptions as Prisma.InputJsonValue,
            variants: input.variants as Prisma.InputJsonValue,
            images: input.images as Prisma.InputJsonValue,
            description: input.description,
            specs: input.specs as Prisma.InputJsonValue,
            status: input.status,
          },
        });

        // MVP "event": sku.created — in-process only until we add a message bus
        syncService.syncProduct(sku.id).catch((err) => {
          console.error(`[SHOPIFY_SYNC] Product create failed for ${sku.id}:`, err);
        });
        return sku;
      } catch (err: unknown) {
        const violation = asUniqueViolation(err);
        if (violation) {
          if (uniqueHit(violation, "skuCode", "sku_code")) {
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
      const data: Prisma.MasterCatalogUpdateInput = {
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
        ...(input.requiresColdStorage !== undefined ? { requiresColdStorage: input.requiresColdStorage } : {}),
        ...(input.weightKg !== undefined ? { weightKg: input.weightKg.toFixed(3) } : {}),
        ...(input.dimensionsCm !== undefined
          ? { dimensionsCm: input.dimensionsCm as Prisma.InputJsonValue }
          : {}),
        ...(input.defaultReorderPoint !== undefined ? { defaultReorderPoint: input.defaultReorderPoint } : {}),
        ...(input.defaultInitialStock !== undefined ? { defaultInitialStock: input.defaultInitialStock } : {}),
        ...(input.variantOptions !== undefined
          ? { variantOptions: input.variantOptions as Prisma.InputJsonValue }
          : {}),
        ...(input.variants !== undefined ? { variants: input.variants as Prisma.InputJsonValue } : {}),
        ...(input.images !== undefined ? { images: input.images as Prisma.InputJsonValue } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.specs !== undefined ? { specs: input.specs as Prisma.InputJsonValue } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      };

      const updated = await prisma.masterCatalog.update({
        where: { id: skuId },
        data,
      });

      // Soft-deleted SKUs must not stay listed on stores (bulk assign rejects archived),
      // and must leave any open customer carts so checkout doesn't fail on ghosts.
      if (input.status === "archived") {
        await prisma.storeSkuMapping.updateMany({
          where: { skuId },
          data: { isListed: false },
        });
        await prisma.cartItem.deleteMany({ where: { skuId } });
      }

      syncService.syncProduct(updated.id).catch((err) => {
        console.error(`[SHOPIFY_SYNC] Product update failed for ${updated.id}:`, err);
      });

      return updated;
    } catch (err: unknown) {
      const violation = asUniqueViolation(err);
      if (violation) {
        if (uniqueHit(violation, "skuCode", "sku_code")) {
          throw new AppError(409, "SKU code already exists in this catalog", "DUPLICATE_SKU_CODE");
        }
        throw new AppError(409, "Barcode already exists in this catalog", "DUPLICATE_BARCODE");
      }
      throw err;
    }
  }

  async listSkus(auth: AuthUser, query: ListSkusQuery) {
    const where: Prisma.MasterCatalogWhereInput = {
      businessId: auth.businessId,
    };

    if (query.status && query.status !== "unassigned") {
      where.status = query.status as CatalogStatus;
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: "insensitive" } },
        { brand: { contains: query.search, mode: "insensitive" } },
        { barcode: { contains: query.search, mode: "insensitive" } },
        { skuCode: { contains: query.search, mode: "insensitive" } },
      ];
    }

    // "unassigned" = SKUs with no row in store_sku_mapping yet (HLD GET ?status=unassigned)
    if (query.status === "unassigned") {
      where.storeMappings = { none: {} };
    }

    return prisma.masterCatalog.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
  }

  async getSku(auth: AuthUser, skuId: string) {
    const sku = await prisma.masterCatalog.findFirst({
      where: { id: skuId, businessId: auth.businessId },
    });

    if (!sku) {
      throw new AppError(404, "SKU not found", "NOT_FOUND");
    }

    return sku;
  }

  /** Distinct brand/category values for form dropdowns (GET /api/catalog/meta). */
  async getCatalogMeta(auth: AuthUser) {
    const [brandRows, categoryRows] = await Promise.all([
      prisma.masterCatalog.findMany({
        where: { businessId: auth.businessId, brand: { not: null } },
        select: { brand: true },
        distinct: ["brand"],
        orderBy: { brand: "asc" },
      }),
      prisma.masterCatalog.findMany({
        where: { businessId: auth.businessId, category: { not: null } },
        select: { category: true },
        distinct: ["category"],
        orderBy: { category: "asc" },
      }),
    ]);

    return {
      brands: brandRows.map((r) => r.brand).filter((v): v is string => !!v),
      categories: categoryRows.map((r) => r.category).filter((v): v is string => !!v),
    };
  }

  /** Push every active/draft SKU in the tenant catalog to the linked Shopify store. */
  async syncAllToShopify(auth: AuthUser) {
    const skus = await prisma.masterCatalog.findMany({
      where: { businessId: auth.businessId, status: { not: "archived" } },
      select: { id: true },
    });

    let synced = 0;
    const failures: Array<{ skuId: string; error: string }> = [];

    for (const { id } of skus) {
      try {
        await syncService.syncProduct(id);
        synced += 1;
      } catch (err) {
        failures.push({
          skuId: id,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return { total: skus.length, synced, failures };
  }
}

export const catalogService = new CatalogService();
