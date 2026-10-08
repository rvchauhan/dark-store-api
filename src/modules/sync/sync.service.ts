import type { MasterCatalog, Order } from "@prisma/client";
import path from "node:path";
import { prisma } from "../../db/client.js";
import { env } from "../../config/env.js";
import {
  createShopifyOrder,
  createShopifyProduct,
  fulfillShopifyOrder,
  getOnlineStorePublicationId,
  getPrimaryShopifyLocationId,
  getVariantInventoryItemId,
  publishProductToOnlineStore,
  setShopifyInventoryQuantity,
  syncShopifyProductMedia,
  updateShopifyProduct,
  type ShopifyCredentials,
} from "./shopify.client.js";

/** Same folder catalog.routes serves at /uploads — keep in sync. */
const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

type OrderLineItem = {
  skuId: string;
  nameSnapshot: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
};

type DeliveryAddress = {
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  phone: string;
};

type InstallationMetadata = {
  shop?: string;
  shopifyAccessToken?: string;
  shopifyApiVersion?: string;
  shopifyLocationId?: string;
  shopifyOnlineStorePublicationId?: string;
  [key: string]: unknown;
};

function catalogStatusToShopify(status: MasterCatalog["status"]): "ACTIVE" | "DRAFT" | "ARCHIVED" {
  if (status === "active") return "ACTIVE";
  if (status === "archived") return "ARCHIVED";
  return "DRAFT";
}

function absoluteImageUrl(url: string): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const base = env.PUBLIC_API_URL?.replace(/\/$/, "");
  if (!base) {
    // Keep relative /uploads paths — staged upload resolves them from disk.
    return url.startsWith("/") ? url : `/${url}`;
  }
  return `${base}${url.startsWith("/") ? url : `/${url}`}`;
}

function catalogImageUrls(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  return images
    .map((img) => (typeof img === "string" ? absoluteImageUrl(img) : null))
    .filter((u): u is string => Boolean(u));
}

export class SyncService {
  async persistShopifyCredentials(
    businessId: string,
    shop: string,
    accessToken: string,
    apiVersion?: string,
  ): Promise<void> {
    const installation = await prisma.externalInstallation.findFirst({
      where: { businessId, provider: "shopify", uninstalledAt: null },
    });
    if (!installation) return;

    const existing = (installation.metadata ?? {}) as InstallationMetadata;
    await prisma.externalInstallation.update({
      where: { id: installation.id },
      data: {
        metadata: {
          ...existing,
          shop: shop.toLowerCase(),
          shopifyAccessToken: accessToken,
          ...(apiVersion ? { shopifyApiVersion: apiVersion } : {}),
        },
      },
    });
  }

  private async getShopifyCredentials(businessId: string): Promise<ShopifyCredentials | null> {
    const installation = await prisma.externalInstallation.findFirst({
      where: { businessId, provider: "shopify", uninstalledAt: null },
    });
    if (!installation) return null;

    const meta = (installation.metadata ?? {}) as InstallationMetadata;
    const accessToken = meta.shopifyAccessToken;
    const shop = (meta.shop ?? installation.externalId).toLowerCase();
    if (!accessToken || !shop) return null;

    return {
      shop,
      accessToken,
      apiVersion: meta.shopifyApiVersion,
    };
  }

  private async resolveShopifyLocationId(
    businessId: string,
    creds: ShopifyCredentials,
  ): Promise<string> {
    const installation = await prisma.externalInstallation.findFirst({
      where: { businessId, provider: "shopify", uninstalledAt: null },
    });
    if (!installation) {
      return getPrimaryShopifyLocationId(creds);
    }

    const meta = (installation.metadata ?? {}) as InstallationMetadata;
    if (meta.shopifyLocationId) return meta.shopifyLocationId;

    const locationId = await getPrimaryShopifyLocationId(creds);
    await prisma.externalInstallation.update({
      where: { id: installation.id },
      data: {
        metadata: {
          ...meta,
          shopifyLocationId: locationId,
        },
      },
    });
    return locationId;
  }

  private async resolveOnlineStorePublicationId(
    businessId: string,
    creds: ShopifyCredentials,
  ): Promise<string> {
    const installation = await prisma.externalInstallation.findFirst({
      where: { businessId, provider: "shopify", uninstalledAt: null },
    });
    if (!installation) {
      return getOnlineStorePublicationId(creds);
    }

    const meta = (installation.metadata ?? {}) as InstallationMetadata;
    if (meta.shopifyOnlineStorePublicationId) {
      return meta.shopifyOnlineStorePublicationId;
    }

    const publicationId = await getOnlineStorePublicationId(creds);
    await prisma.externalInstallation.update({
      where: { id: installation.id },
      data: {
        metadata: {
          ...meta,
          shopifyOnlineStorePublicationId: publicationId,
        },
      },
    });
    return publicationId;
  }

  /** Sum available qty across all dark stores for this SKU (Shopify mirror is store-wide). */
  private async aggregateAvailableQty(skuId: string): Promise<number> {
    const agg = await prisma.inventorySnapshot.aggregate({
      where: { skuId },
      _sum: { availableQty: true },
    });
    return Math.max(0, agg._sum.availableQty ?? 0);
  }

  async syncProduct(skuId: string): Promise<void> {
    const sku = await prisma.masterCatalog.findUnique({ where: { id: skuId } });
    if (!sku) return;

    const creds = await this.getShopifyCredentials(sku.businessId);
    if (!creds) {
      console.warn(`[SHOPIFY_SYNC] No credentials for business ${sku.businessId} — skip product ${skuId}`);
      return;
    }

    const status = catalogStatusToShopify(sku.status);
    const descriptionHtml = sku.description ?? "";

    const payload = {
      title: sku.name,
      descriptionHtml,
      vendor: sku.brand,
      productType: sku.category,
      status,
      price: Number(sku.basePrice).toFixed(2),
      sku: sku.skuCode,
      barcode: sku.barcode,
      currencyCode: sku.currency || "INR",
      allowBackorder: sku.allowBackorder,
    };

    let result: { productId: string; variantId: string; inventoryItemId: string };
    if (sku.shopifyProductId && sku.shopifyVariantId) {
      result = await updateShopifyProduct(creds, {
        productId: sku.shopifyProductId,
        variantId: sku.shopifyVariantId,
        ...payload,
      });
    } else {
      result = await createShopifyProduct(creds, payload);
    }

    await prisma.masterCatalog.update({
      where: { id: sku.id },
      data: {
        shopifyProductId: result.productId,
        shopifyVariantId: result.variantId,
      },
    });

    // Product Media gallery (also powers thumbnails on Shopify orders).
    const imageUrls = catalogImageUrls(sku.images);
    if (imageUrls.length > 0) {
      try {
        await syncShopifyProductMedia(creds, {
          productId: result.productId,
          imageUrls,
          alt: sku.name,
          uploadsDir: UPLOADS_DIR,
        });
      } catch (err) {
        console.error(
          `[SHOPIFY_SYNC] Media sync failed for ${skuId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // Default channel: Online Store (Channels column should not stay at 0).
    if (status !== "ARCHIVED") {
      try {
        const publicationId = await this.resolveOnlineStorePublicationId(
          sku.businessId,
          creds,
        );
        await publishProductToOnlineStore(creds, {
          productId: result.productId,
          publicationId,
        });
      } catch (err) {
        console.error(
          `[SHOPIFY_SYNC] Online Store publish failed for ${skuId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // Enable tracking + push aggregated dark-store stock to Shopify.
    await this.pushInventoryToShopify(sku.businessId, creds, result.inventoryItemId, skuId);
  }

  /**
   * Push current dark-store stock for a SKU to Shopify (requires product already linked).
   * Safe to call after stock-in / sale / adjustment.
   */
  async syncInventory(skuId: string): Promise<void> {
    const sku = await prisma.masterCatalog.findUnique({
      where: { id: skuId },
      select: {
        id: true,
        businessId: true,
        shopifyVariantId: true,
      },
    });
    if (!sku?.shopifyVariantId) return;

    const creds = await this.getShopifyCredentials(sku.businessId);
    if (!creds) return;

    const inventoryItemId = await getVariantInventoryItemId(creds, sku.shopifyVariantId);
    await this.pushInventoryToShopify(sku.businessId, creds, inventoryItemId, skuId);
  }

  private async pushInventoryToShopify(
    businessId: string,
    creds: ShopifyCredentials,
    inventoryItemId: string,
    skuId: string,
  ): Promise<void> {
    const [locationId, quantity] = await Promise.all([
      this.resolveShopifyLocationId(businessId, creds),
      this.aggregateAvailableQty(skuId),
    ]);

    await setShopifyInventoryQuantity(creds, {
      inventoryItemId,
      locationId,
      quantity,
      referenceUri: `gid://quick-commerce/MasterCatalog/${skuId}`,
    });

    console.log(
      `[SHOPIFY_SYNC] Inventory synced for SKU ${skuId}: ${quantity} @ ${locationId}`,
    );
  }

  async ensureProductSynced(skuId: string): Promise<string | null> {
    const sku = await prisma.masterCatalog.findUnique({ where: { id: skuId } });
    if (!sku) return null;
    if (sku.shopifyVariantId) return sku.shopifyVariantId;

    await this.syncProduct(skuId);
    const refreshed = await prisma.masterCatalog.findUnique({
      where: { id: skuId },
      select: { shopifyVariantId: true },
    });
    return refreshed?.shopifyVariantId ?? null;
  }

  async routeInternalOrder(
    orderId: string,
    businessId: string,
    _items: OrderLineItem[],
  ): Promise<void> {
    await this.syncOrderToShopify(orderId, businessId);
  }

  async syncOrderToShopify(orderId: string, businessId: string): Promise<void> {
    const creds = await this.getShopifyCredentials(businessId);
    if (!creds) {
      console.warn(`[SHOPIFY_SYNC] No credentials for business ${businessId} — skip order ${orderId}`);
      return;
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: { select: { email: true, name: true, phone: true } },
        items: true,
      },
    });

    if (!order || order.businessId !== businessId) return;
    if (order.shopifyOrderId && order.orderNumber) return;

    const deliveryAddress = order.deliveryAddress as DeliveryAddress;
    const lineItems: Array<{ variantId: string; quantity: number }> = [];

    for (const item of order.items) {
      const variantId = await this.ensureProductSynced(item.skuId);
      if (!variantId) {
        throw new Error(`Could not sync Shopify variant for SKU ${item.skuId}`);
      }
      lineItems.push({ variantId, quantity: item.quantity });
    }

    const result = await createShopifyOrder(creds, {
      email: order.customer.email,
      phone: deliveryAddress.phone ?? order.customer.phone,
      lineItems,
      shippingAddress: {
        address1: deliveryAddress.line1,
        address2: deliveryAddress.line2,
        city: deliveryAddress.city,
        zip: deliveryAddress.postalCode,
        phone: deliveryAddress.phone,
      },
      totalAmount: Number(order.totalAmount).toFixed(2),
      note: `Quick Commerce dark-store order ${order.id}`,
    });

    await prisma.order.update({
      where: { id: order.id },
      data: {
        shopifyOrderId: result.orderId,
        orderNumber: result.orderName,
      },
    });

    // Reflect post-sale stock on Shopify (order create may also decrement there;
    // re-push absolute dark-store totals so both stay aligned).
    for (const item of order.items) {
      await this.syncInventory(item.skuId).catch((err) =>
        console.error(`[SHOPIFY_SYNC] Inventory sync after order failed for ${item.skuId}:`, err),
      );
    }
  }

  /**
   * Mirror dark-store fulfillment onto the linked Shopify order (with tracking when present).
   * No-ops when there is no Shopify link or the order is already fulfilled there.
   */
  async syncOrderFulfillmentToShopify(orderId: string, businessId: string): Promise<void> {
    const creds = await this.getShopifyCredentials(businessId);
    if (!creds) {
      console.warn(
        `[SHOPIFY_SYNC] No credentials for business ${businessId} — skip fulfillment ${orderId}`,
      );
      return;
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        businessId: true,
        shopifyOrderId: true,
        trackingName: true,
        trackingNumber: true,
        trackingUrl: true,
        status: true,
      },
    });

    if (!order || order.businessId !== businessId) return;
    if (!order.shopifyOrderId) {
      console.warn(`[SHOPIFY_SYNC] Order ${orderId} has no shopifyOrderId — skip fulfillment`);
      return;
    }
    if (order.status !== "fulfilled") return;

    const result = await fulfillShopifyOrder(creds, {
      shopifyOrderId: order.shopifyOrderId,
      trackingCompany: order.trackingName,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
      notifyCustomer: false,
    });

    if (result) {
      console.log(
        `[SHOPIFY_SYNC] Fulfilled Shopify order ${order.shopifyOrderId} → ${result.fulfillmentId}`,
      );
    }
  }
}

export const syncService = new SyncService();

export function formatOrderLabel(order: Pick<Order, "id" | "orderNumber">): string {
  if (order.orderNumber) return order.orderNumber;
  return `#${order.id.slice(0, 8)}`;
}
