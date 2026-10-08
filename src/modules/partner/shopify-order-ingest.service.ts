import { Prisma } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { AppError } from "../../shared/errors/app-error.js";
import { syncService } from "../sync/sync.service.js";
import type { ShopifyOrderIngestInput } from "./shopify-order-ingest.schemas.js";

type InstallationMetadata = {
  defaultFulfillmentStoreId?: string;
  [key: string]: unknown;
};

function variantGid(variantId: string | number | null | undefined): string | null {
  if (variantId === null || variantId === undefined || variantId === "") return null;
  const raw = String(variantId);
  if (raw.startsWith("gid://")) return raw;
  return `gid://shopify/ProductVariant/${raw}`;
}

function money(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isEchoFromDarkStore(order: ShopifyOrderIngestInput["order"]): boolean {
  const tags = (order.tags ?? "").toLowerCase();
  if (tags.includes("quick-commerce") || tags.includes("dark-store")) return true;
  const note = (order.note ?? "").toLowerCase();
  return note.includes("quick commerce dark-store order");
}

function shopifyOrderGid(order: ShopifyOrderIngestInput["order"]): string {
  if (order.admin_graphql_api_id) return order.admin_graphql_api_id;
  if (order.id !== undefined) return `gid://shopify/Order/${order.id}`;
  throw new AppError(400, "Shopify order id is required", "VALIDATION_ERROR");
}

/**
 * Ingest a Shopify Online Store (or other channel) order into dark-store.
 * Idempotent on shopifyOrderId. Skips QC-originated echoes (tagged quick-commerce).
 */
export class ShopifyOrderIngestService {
  async ingest(input: ShopifyOrderIngestInput) {
    const provider = input.provider.trim().toLowerCase();
    const externalId = input.externalId.trim().toLowerCase();
    const shopifyOrder = input.order;

    if (isEchoFromDarkStore(shopifyOrder)) {
      return { skipped: true as const, reason: "dark_store_echo" };
    }

    const shopifyOrderId = shopifyOrderGid(shopifyOrder);
    const existing = await prisma.order.findFirst({
      where: { shopifyOrderId },
      select: { id: true, orderNumber: true, status: true },
    });
    if (existing) {
      return {
        skipped: true as const,
        reason: "already_imported",
        orderId: existing.id,
        orderNumber: existing.orderNumber,
      };
    }

    const installation = await prisma.externalInstallation.findFirst({
      where: { provider, externalId, uninstalledAt: null },
      include: {
        business: {
          select: {
            id: true,
            name: true,
            stores: {
              select: { id: true, name: true, status: true },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    });

    if (!installation) {
      throw new AppError(
        404,
        `No active Shopify installation for ${externalId}`,
        "INSTALLATION_NOT_FOUND",
      );
    }

    const businessId = installation.businessId;
    const meta = (installation.metadata ?? {}) as InstallationMetadata;

    const linePlans = await this.resolveLineItems(businessId, shopifyOrder.line_items);
    const storeId = await this.resolveStoreId(
      businessId,
      installation.business.stores,
      meta.defaultFulfillmentStoreId,
      linePlans.map((l) => l.skuId),
    );

    const customer = await this.upsertCustomer(shopifyOrder);
    const shipping =
      shopifyOrder.shipping_address ?? shopifyOrder.billing_address ?? undefined;

    const deliveryAddress = {
      line1: shipping?.address1?.trim() || "Address not provided",
      line2: shipping?.address2?.trim() || undefined,
      city: shipping?.city?.trim() || "Unknown",
      postalCode: shipping?.zip?.trim() || "000000",
      phone: shipping?.phone?.trim() || shopifyOrder.phone || customer.phone || "",
    };

    let itemsTotal = 0;
    const lineItems = linePlans.map((line) => {
      const unitPrice = money(line.price);
      const lineTotal = unitPrice * line.quantity;
      itemsTotal += lineTotal;
      return {
        skuId: line.skuId,
        nameSnapshot: line.name,
        unitPrice: unitPrice.toFixed(2),
        quantity: line.quantity,
        lineTotal: lineTotal.toFixed(2),
      };
    });

    const deliveryFee = money(
      shopifyOrder.total_shipping_price_set?.shop_money?.amount,
    );
    const totalFromShopify = money(shopifyOrder.total_price);
    const totalAmount =
      totalFromShopify > 0 ? totalFromShopify : itemsTotal + deliveryFee;
    const handlingFee = Math.max(0, totalAmount - itemsTotal - deliveryFee);

    const paymentMethod =
      shopifyOrder.financial_status === "paid" ||
      shopifyOrder.financial_status === "partially_paid"
        ? "shopify"
        : `shopify_${shopifyOrder.financial_status ?? "pending"}`;

    const created = await prisma.$transaction(async (tx) => {
      // Re-check inside txn for concurrent webhooks
      const duel = await tx.order.findFirst({
        where: { shopifyOrderId },
        select: { id: true, orderNumber: true },
      });
      if (duel) {
        return { orderId: duel.id, orderNumber: duel.orderNumber, created: false as const };
      }

      const order = await tx.order.create({
        data: {
          customerId: customer.id,
          businessId,
          storeId,
          status: "placed",
          deliveryAddress: deliveryAddress as Prisma.InputJsonValue,
          paymentMethod,
          itemsTotal: itemsTotal.toFixed(2),
          deliveryFee: deliveryFee.toFixed(2),
          handlingFee: handlingFee.toFixed(2),
          totalAmount: totalAmount.toFixed(2),
          shopifyOrderId,
          orderNumber: shopifyOrder.name ?? null,
        },
      });

      await tx.orderItem.createMany({
        data: lineItems.map((item) => ({ orderId: order.id, ...item })),
      });

      for (const line of lineItems) {
        const mapping = await tx.storeSkuMapping.findUnique({
          where: { storeId_skuId: { storeId, skuId: line.skuId } },
        });
        if (!mapping) {
          // Ensure mapping + snapshot exist so ledger FK succeeds
          await tx.storeSkuMapping.create({
            data: {
              storeId,
              skuId: line.skuId,
              isListed: false,
            },
          });
          await tx.inventorySnapshot.create({
            data: { storeId, skuId: line.skuId, availableQty: 0 },
          });
        } else {
          const snap = await tx.inventorySnapshot.findUnique({
            where: { storeId_skuId: { storeId, skuId: line.skuId } },
          });
          if (!snap) {
            await tx.inventorySnapshot.create({
              data: { storeId, skuId: line.skuId, availableQty: 0 },
            });
          }
        }

        const ledgerRow = await tx.inventoryLedger.create({
          data: {
            storeId,
            skuId: line.skuId,
            type: "sale",
            quantity: -line.quantity,
            referenceId: order.id,
            source: "shopify_online_store",
          },
        });

        await tx.inventorySnapshot.update({
          where: { storeId_skuId: { storeId, skuId: line.skuId } },
          data: {
            availableQty: { decrement: line.quantity },
            lastLedgerId: ledgerRow.id,
          },
        });
      }

      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        created: true as const,
        skuIds: lineItems.map((l) => l.skuId),
      };
    });

    if (created.created && "skuIds" in created) {
      for (const skuId of created.skuIds) {
        syncService.syncInventory(skuId).catch((err) => {
          console.error(
            `[SHOPIFY_INGEST] Inventory sync failed for ${skuId}:`,
            err instanceof Error ? err.message : err,
          );
        });
      }
    }

    return {
      skipped: false as const,
      created: created.created,
      orderId: created.orderId,
      orderNumber: created.orderNumber,
      storeId,
      shopifyOrderId,
    };
  }

  private async resolveLineItems(
    businessId: string,
    lineItems: ShopifyOrderIngestInput["order"]["line_items"],
  ) {
    const plans: Array<{
      skuId: string;
      name: string;
      quantity: number;
      price: string | number;
    }> = [];

    for (const li of lineItems) {
      const gid = variantGid(li.variant_id ?? null);
      let sku = gid
        ? await prisma.masterCatalog.findFirst({
            where: { businessId, shopifyVariantId: gid },
            select: { id: true, name: true },
          })
        : null;

      if (!sku && li.sku) {
        sku = await prisma.masterCatalog.findFirst({
          where: { businessId, skuCode: li.sku },
          select: { id: true, name: true },
        });
      }

      if (!sku) {
        throw new AppError(
          409,
          `No dark-store SKU mapped for Shopify variant ${gid ?? li.sku ?? "unknown"} (${li.title ?? li.name ?? "item"})`,
          "SKU_NOT_MAPPED",
        );
      }

      plans.push({
        skuId: sku.id,
        name: sku.name || li.title || li.name || "Item",
        quantity: li.quantity,
        price: li.price,
      });
    }

    return plans;
  }

  private async resolveStoreId(
    businessId: string,
    stores: Array<{ id: string; name: string; status: string }>,
    preferredStoreId: string | undefined,
    skuIds: string[],
  ): Promise<string> {
    if (preferredStoreId) {
      const preferred = stores.find((s) => s.id === preferredStoreId);
      if (preferred) return preferred.id;
    }

    const active = stores.filter((s) => s.status === "active");
    const candidates = active.length > 0 ? active : stores;
    if (candidates.length === 0) {
      throw new AppError(
        409,
        "No dark store available to fulfill Shopify order",
        "NO_STORE",
      );
    }

    // Prefer a store that already has all SKUs mapped.
    for (const store of candidates) {
      const mapped = await prisma.storeSkuMapping.count({
        where: { storeId: store.id, skuId: { in: skuIds } },
      });
      if (mapped === skuIds.length) return store.id;
    }

    return candidates[0].id;
  }

  private async upsertCustomer(order: ShopifyOrderIngestInput["order"]) {
    const emailRaw =
      (typeof order.email === "string" && order.email.trim()) ||
      order.customer?.email?.trim() ||
      "";
    const email =
      emailRaw ||
      `shopify-guest-${order.id ?? Date.now()}@noreply.quickcommerce.local`;

    const nameFromCustomer = [order.customer?.first_name, order.customer?.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    const name =
      nameFromCustomer ||
      order.shipping_address?.name?.trim() ||
      order.billing_address?.name?.trim() ||
      email.split("@")[0] ||
      "Shopify Customer";

    const phone =
      order.phone?.trim() ||
      order.customer?.phone?.trim() ||
      order.shipping_address?.phone?.trim() ||
      null;

    const existing = await prisma.customer.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      if ((!existing.phone && phone) || (existing.name.startsWith("shopify-guest") && name)) {
        return prisma.customer.update({
          where: { id: existing.id },
          data: {
            ...(phone && !existing.phone ? { phone } : {}),
            ...(name ? { name } : {}),
          },
        });
      }
      return existing;
    }

    return prisma.customer.create({
      data: {
        email: email.toLowerCase(),
        name,
        phone,
        status: "active",
      },
    });
  }
}

export const shopifyOrderIngestService = new ShopifyOrderIngestService();
