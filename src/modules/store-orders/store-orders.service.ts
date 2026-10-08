import type { OrderStatus } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { AuthUser } from "../../shared/types/auth.js";
import { syncService } from "../sync/sync.service.js";
import type {
  ListNetworkOrdersQuery,
  ListOrdersQuery,
  UpdateOrderStatusInput,
} from "./store-orders.schemas.js";

const ACTIVE_STATUSES: OrderStatus[] = ["placed", "confirmed", "preparing", "out_for_delivery"];
const COMPLETED_STATUSES: OrderStatus[] = ["fulfilled", "cancelled"];

function statusWhere(status: "active" | "all" | "fulfilled") {
  if (status === "active") return { status: { in: ACTIVE_STATUSES } };
  if (status === "fulfilled") return { status: { in: COMPLETED_STATUSES } };
  return {};
}

/** Forward-only transitions; anything can be cancelled except a terminal order. */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  placed: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["out_for_delivery", "cancelled"],
  out_for_delivery: ["fulfilled"],
  fulfilled: [],
  cancelled: [],
};

/**
 * Staff-facing reads/actions over the `orders`/`order_items` tables created
 * for the customer app. Separate from src/modules/orders (customer-facing,
 * requireCustomerAuth) — this module sits behind staff requireAuth +
 * requireStoreAccess, mirroring the inventory module's nested-router shape.
 */
export class StoreOrdersService {
  async listOrders(auth: AuthUser, storeId: string, query: ListOrdersQuery) {
    void auth;

    const rows = await prisma.order.findMany({
      where: {
        storeId,
        ...statusWhere(query.status),
      },
      include: { customer: { select: { name: true } } },
      // Active queue: oldest first (FIFO). Fulfilled/history: most recently closed first.
      orderBy:
        query.status === "fulfilled"
          ? { updatedAt: "desc" }
          : { createdAt: "asc" },
    });

    if (rows.length === 0) return [];

    const itemCounts = await prisma.orderItem.groupBy({
      by: ["orderId"],
      where: { orderId: { in: rows.map((r) => r.id) } },
      _count: { _all: true },
      _sum: { quantity: true },
    });

    const countByOrder = new Map(
      itemCounts.map((c) => [
        c.orderId,
        { itemCount: c._count._all, totalUnits: c._sum.quantity ?? 0 },
      ]),
    );

    return rows.map((row) => ({
      id: row.id,
      orderNumber: row.orderNumber,
      status: row.status,
      paymentMethod: row.paymentMethod,
      itemsTotal: row.itemsTotal,
      totalAmount: row.totalAmount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      customerName: row.customer.name,
      itemCount: countByOrder.get(row.id)?.itemCount ?? 0,
      totalUnits: countByOrder.get(row.id)?.totalUnits ?? 0,
    }));
  }

  /**
   * Business-admin network view — every store's orders for the tenant.
   * Used by the Shopify embedded admin (read-only supervision).
   */
  async listNetworkOrders(auth: AuthUser, query: ListNetworkOrdersQuery) {
    if (auth.role !== "business_admin") {
      throw new AppError(403, "Only business admins can list network orders", "FORBIDDEN");
    }

    const rows = await prisma.order.findMany({
      where: {
        businessId: auth.businessId,
        ...(query.storeId ? { storeId: query.storeId } : {}),
        ...statusWhere(query.status),
      },
      include: {
        customer: { select: { name: true } },
        store: { select: { id: true, name: true, code: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    if (rows.length === 0) return [];

    const itemCounts = await prisma.orderItem.groupBy({
      by: ["orderId"],
      where: { orderId: { in: rows.map((r) => r.id) } },
      _count: { _all: true },
      _sum: { quantity: true },
    });

    const countByOrder = new Map(
      itemCounts.map((c) => [
        c.orderId,
        { itemCount: c._count._all, totalUnits: c._sum.quantity ?? 0 },
      ]),
    );

    return rows.map((row) => ({
      id: row.id,
      orderNumber: row.orderNumber,
      storeId: row.store.id,
      storeName: row.store.name,
      storeCode: row.store.code,
      status: row.status,
      paymentMethod: row.paymentMethod,
      itemsTotal: row.itemsTotal,
      totalAmount: row.totalAmount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      customerName: row.customer.name,
      itemCount: countByOrder.get(row.id)?.itemCount ?? 0,
      totalUnits: countByOrder.get(row.id)?.totalUnits ?? 0,
    }));
  }

  async getNetworkOrder(auth: AuthUser, orderId: string) {
    if (auth.role !== "business_admin") {
      throw new AppError(403, "Only business admins can view network orders", "FORBIDDEN");
    }

    const orderRow = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: { select: { name: true, phone: true } },
        store: { select: { id: true, name: true, code: true } },
      },
    });

    if (!orderRow || orderRow.businessId !== auth.businessId) {
      throw new AppError(404, "Order not found", "NOT_FOUND");
    }

    const items = await prisma.orderItem.findMany({
      where: { orderId },
      include: {
        sku: {
          select: {
            brand: true,
            category: true,
            images: true,
            description: true,
            isFragile: true,
            requiresColdStorage: true,
            weightKg: true,
            dimensionsCm: true,
            barcode: true,
            skuCode: true,
            specs: true,
          },
        },
      },
    });

    return {
      order: {
        id: orderRow.id,
        orderNumber: orderRow.orderNumber,
        storeId: orderRow.storeId,
        storeName: orderRow.store.name,
        storeCode: orderRow.store.code,
        status: orderRow.status,
        deliveryAddress: orderRow.deliveryAddress,
        paymentMethod: orderRow.paymentMethod,
        itemsTotal: orderRow.itemsTotal,
        deliveryFee: orderRow.deliveryFee,
        handlingFee: orderRow.handlingFee,
        totalAmount: orderRow.totalAmount,
        riderName: orderRow.riderName,
        riderPhone: orderRow.riderPhone,
        trackingName: orderRow.trackingName,
        trackingNumber: orderRow.trackingNumber,
        trackingUrl: orderRow.trackingUrl,
        createdAt: orderRow.createdAt,
        updatedAt: orderRow.updatedAt,
        customerName: orderRow.customer.name,
        customerPhone: orderRow.customer.phone,
      },
      items: items.map((item) => ({
        id: item.id,
        orderId: item.orderId,
        skuId: item.skuId,
        nameSnapshot: item.nameSnapshot,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
        brand: item.sku?.brand ?? null,
        category: item.sku?.category ?? null,
        images: item.sku?.images ?? null,
        description: item.sku?.description ?? null,
        isFragile: item.sku?.isFragile ?? null,
        requiresColdStorage: item.sku?.requiresColdStorage ?? null,
        weightKg: item.sku?.weightKg ?? null,
        dimensionsCm: item.sku?.dimensionsCm ?? null,
        barcode: item.sku?.barcode ?? null,
        skuCode: item.sku?.skuCode ?? null,
        specs: item.sku?.specs ?? null,
      })),
    };
  }

  async getStats(auth: AuthUser, storeId: string) {
    void auth;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // An order placed yesterday and fulfilled today is part of "today" twice
    // over — it's still in-flight revenue until fulfillment closes it out. Count
    // it under whichever day that happens, not the day it was merely placed,
    // or its revenue never lands in any day's total.
    const touchedToday = {
      storeId,
      status: { not: "cancelled" as const },
      OR: [
        { createdAt: { gte: todayStart } },
        { status: "fulfilled" as const, updatedAt: { gte: todayStart } },
      ],
    };

    const [todayCount, activeCount, revenueAgg] = await Promise.all([
      prisma.order.count({ where: touchedToday }),
      prisma.order.count({
        where: { storeId, status: { in: ACTIVE_STATUSES } },
      }),
      prisma.order.aggregate({
        where: touchedToday,
        _sum: { totalAmount: true },
      }),
    ]);

    return {
      todayCount,
      activeCount,
      todayRevenue: Number(revenueAgg._sum.totalAmount ?? 0),
    };
  }

  async getOrder(auth: AuthUser, storeId: string, orderId: string) {
    void auth;

    const orderRow = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: { select: { name: true, phone: true } },
      },
    });

    if (!orderRow || orderRow.storeId !== storeId) {
      throw new AppError(404, "Order not found", "NOT_FOUND");
    }

    const order = {
      id: orderRow.id,
      orderNumber: orderRow.orderNumber,
      storeId: orderRow.storeId,
      status: orderRow.status,
      deliveryAddress: orderRow.deliveryAddress,
      paymentMethod: orderRow.paymentMethod,
      itemsTotal: orderRow.itemsTotal,
      deliveryFee: orderRow.deliveryFee,
      handlingFee: orderRow.handlingFee,
      totalAmount: orderRow.totalAmount,
      riderName: orderRow.riderName,
      riderPhone: orderRow.riderPhone,
      trackingName: orderRow.trackingName,
      trackingNumber: orderRow.trackingNumber,
      trackingUrl: orderRow.trackingUrl,
      createdAt: orderRow.createdAt,
      updatedAt: orderRow.updatedAt,
      customerName: orderRow.customer.name,
      customerPhone: orderRow.customer.phone,
    };

    const items = await prisma.orderItem.findMany({
      where: { orderId },
      include: {
        // left join semantics: keep line items even if the SKU was later removed
        sku: {
          select: {
            brand: true,
            category: true,
            images: true,
            description: true,
            isFragile: true,
            requiresColdStorage: true,
            weightKg: true,
            dimensionsCm: true,
            barcode: true,
            skuCode: true,
            specs: true,
          },
        },
      },
    });

    return {
      order,
      items: items.map((item) => ({
        id: item.id,
        orderId: item.orderId,
        skuId: item.skuId,
        nameSnapshot: item.nameSnapshot,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
        brand: item.sku?.brand ?? null,
        category: item.sku?.category ?? null,
        images: item.sku?.images ?? null,
        description: item.sku?.description ?? null,
        isFragile: item.sku?.isFragile ?? null,
        requiresColdStorage: item.sku?.requiresColdStorage ?? null,
        weightKg: item.sku?.weightKg ?? null,
        dimensionsCm: item.sku?.dimensionsCm ?? null,
        barcode: item.sku?.barcode ?? null,
        skuCode: item.sku?.skuCode ?? null,
        specs: item.sku?.specs ?? null,
      })),
    };
  }

  async updateStatus(auth: AuthUser, storeId: string, orderId: string, input: UpdateOrderStatusInput) {
    void auth;
    const { status } = input;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.storeId !== storeId) {
      throw new AppError(404, "Order not found", "NOT_FOUND");
    }

    const allowed = ALLOWED_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(status)) {
      throw new AppError(
        400,
        `Cannot move order from '${order.status}' to '${status}'`,
        "INVALID_TRANSITION",
      );
    }

    // Dispatch requires a rider on record — either just assigned or already set
    // from a previous attempt at this transition.
    const riderName = input.riderName ?? order.riderName ?? undefined;
    const riderPhone = input.riderPhone ?? order.riderPhone ?? undefined;
    const trackingName = input.trackingName ?? order.trackingName ?? undefined;
    const trackingNumber = input.trackingNumber ?? order.trackingNumber ?? undefined;
    const trackingUrl = input.trackingUrl ?? order.trackingUrl ?? undefined;

    if (status === "out_for_delivery" && (!trackingName || !trackingNumber || !trackingUrl)) {
      throw new AppError(
        400,
        "Provide tracking name, tracking number, and tracking URL before marking the order shipped",
        "TRACKING_REQUIRED",
      );
    }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        status,
        ...(riderName !== undefined ? { riderName } : {}),
        ...(riderPhone !== undefined ? { riderPhone } : {}),
        ...(trackingName !== undefined ? { trackingName } : {}),
        ...(trackingNumber !== undefined ? { trackingNumber } : {}),
        ...(trackingUrl !== undefined ? { trackingUrl } : {}),
      },
    });

    if (status === "fulfilled") {
      try {
        await syncService.syncOrderFulfillmentToShopify(orderId, order.businessId);
      } catch (err) {
        console.warn(
          `[SHOPIFY_SYNC] Fulfillment sync failed for ${orderId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return updated;
  }
}

export const storeOrdersService = new StoreOrdersService();
