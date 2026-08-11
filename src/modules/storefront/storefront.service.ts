import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { stores, storeSkuMapping } from "../../db/schema/store.js";
import { masterCatalog } from "../../db/schema/catalog.js";
import { inventorySnapshot } from "../../db/schema/inventory.js";
import { AppError } from "../../shared/errors/app-error.js";

/**
 * Storefront module service — read-only customer browsing.
 *
 * Deliberately separate from StoreService (store.service.ts), which sits
 * behind staff-only `requireAuth` and exposes CRUD/onboarding semantics that
 * don't belong on a customer-facing read API.
 */
export class StorefrontService {
  async listActiveStores() {
    return db
      .select({
        id: stores.id,
        name: stores.name,
        address: stores.address,
        geofence: stores.geofence,
      })
      .from(stores)
      .where(eq(stores.status, "active"));
  }

  async listStoreProducts(storeId: string) {
    await this.assertStoreActive(storeId);

    const rows = await db
      .select(this.productColumns())
      .from(storeSkuMapping)
      .innerJoin(masterCatalog, eq(storeSkuMapping.skuId, masterCatalog.id))
      .leftJoin(
        inventorySnapshot,
        and(
          eq(inventorySnapshot.storeId, storeSkuMapping.storeId),
          eq(inventorySnapshot.skuId, storeSkuMapping.skuId),
        ),
      )
      .where(and(eq(storeSkuMapping.storeId, storeId), eq(storeSkuMapping.isListed, true)));

    return rows.map((row) => this.toProduct(row));
  }

  async getStoreProduct(storeId: string, skuId: string) {
    await this.assertStoreActive(storeId);

    const [row] = await db
      .select(this.productColumns())
      .from(storeSkuMapping)
      .innerJoin(masterCatalog, eq(storeSkuMapping.skuId, masterCatalog.id))
      .leftJoin(
        inventorySnapshot,
        and(
          eq(inventorySnapshot.storeId, storeSkuMapping.storeId),
          eq(inventorySnapshot.skuId, storeSkuMapping.skuId),
        ),
      )
      .where(
        and(
          eq(storeSkuMapping.storeId, storeId),
          eq(storeSkuMapping.skuId, skuId),
          eq(storeSkuMapping.isListed, true),
        ),
      )
      .limit(1);

    if (!row) {
      throw new AppError(404, "Product not found", "NOT_FOUND");
    }

    return this.toProduct(row);
  }

  private productColumns() {
    return {
      skuId: masterCatalog.id,
      name: masterCatalog.name,
      brand: masterCatalog.brand,
      category: masterCatalog.category,
      basePrice: masterCatalog.basePrice,
      priceOverride: storeSkuMapping.priceOverride,
      compareAtPrice: masterCatalog.compareAtPrice,
      unitOfMeasure: masterCatalog.unitOfMeasure,
      images: masterCatalog.images,
      description: masterCatalog.description,
      availableQty: inventorySnapshot.availableQty,
    };
  }

  /** Shapes the joined row into a flat customer-facing product — one price field, no raw override/base ambiguity. */
  private toProduct(row: {
    skuId: string;
    name: string;
    brand: string | null;
    category: string | null;
    basePrice: string;
    priceOverride: string | null;
    compareAtPrice: string | null;
    unitOfMeasure: string;
    images: unknown;
    description: string | null;
    availableQty: number | null;
  }) {
    return {
      skuId: row.skuId,
      name: row.name,
      brand: row.brand,
      category: row.category,
      price: row.priceOverride ?? row.basePrice,
      compareAtPrice: row.compareAtPrice,
      unitOfMeasure: row.unitOfMeasure,
      images: Array.isArray(row.images) ? row.images : [],
      description: row.description,
      availableQty: row.availableQty ?? 0,
    };
  }

  private async assertStoreActive(storeId: string) {
    const [store] = await db.select({ status: stores.status }).from(stores).where(eq(stores.id, storeId)).limit(1);
    if (!store || store.status !== "active") {
      throw new AppError(404, "Store not found", "NOT_FOUND");
    }
  }
}

export const storefrontService = new StorefrontService();
