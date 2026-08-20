import { prisma } from "../../db/client.js";
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
    return prisma.store.findMany({
      where: { status: "active" },
      select: {
        id: true,
        name: true,
        address: true,
        geofence: true,
      },
    });
  }

  async listStoreProducts(storeId: string) {
    await this.assertStoreActive(storeId);

    const rows = await prisma.storeSkuMapping.findMany({
      where: { storeId, isListed: true },
      include: {
        sku: {
          select: {
            id: true,
            name: true,
            brand: true,
            category: true,
            basePrice: true,
            compareAtPrice: true,
            unitOfMeasure: true,
            images: true,
            description: true,
          },
        },
        snapshot: { select: { availableQty: true } },
      },
    });

    return rows.map((row) => this.toProduct(row));
  }

  async getStoreProduct(storeId: string, skuId: string) {
    await this.assertStoreActive(storeId);

    const row = await prisma.storeSkuMapping.findFirst({
      where: { storeId, skuId, isListed: true },
      include: {
        sku: {
          select: {
            id: true,
            name: true,
            brand: true,
            category: true,
            basePrice: true,
            compareAtPrice: true,
            unitOfMeasure: true,
            images: true,
            description: true,
          },
        },
        snapshot: { select: { availableQty: true } },
      },
    });

    if (!row) {
      throw new AppError(404, "Product not found", "NOT_FOUND");
    }

    return this.toProduct(row);
  }

  /** Shapes the joined row into a flat customer-facing product — one price field, no raw override/base ambiguity. */
  private toProduct(row: {
    priceOverride: { toString(): string } | null;
    sku: {
      id: string;
      name: string;
      brand: string | null;
      category: string | null;
      basePrice: { toString(): string };
      compareAtPrice: { toString(): string } | null;
      unitOfMeasure: string;
      images: unknown;
      description: string | null;
    };
    snapshot: { availableQty: number } | null;
  }) {
    return {
      skuId: row.sku.id,
      name: row.sku.name,
      brand: row.sku.brand,
      category: row.sku.category,
      price: Number(row.priceOverride ?? row.sku.basePrice).toFixed(2),
      compareAtPrice:
        row.sku.compareAtPrice == null ? null : Number(row.sku.compareAtPrice).toFixed(2),
      unitOfMeasure: row.sku.unitOfMeasure,
      images: Array.isArray(row.sku.images) ? row.sku.images : [],
      description: row.sku.description,
      availableQty: row.snapshot?.availableQty ?? 0,
    };
  }

  private async assertStoreActive(storeId: string) {
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { status: true },
    });
    if (!store || store.status !== "active") {
      throw new AppError(404, "Store not found", "NOT_FOUND");
    }
  }
}

export const storefrontService = new StorefrontService();
