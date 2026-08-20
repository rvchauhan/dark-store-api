import type { OrderStatus } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { AuthUser } from "../../shared/types/auth.js";
import type { ListOrdersQuery, UpdateOrderStatusInput } from "./store-orders.schemas.js";

const ACTIVE_STATUSES: OrderStatus[] = ["placed", "confirmed", "preparing", "out_for_delivery"];

/** Forward-only transitions; anything can be cancelled except a terminal order. */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  placed: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["out_for_delivery", "cancelled"],
  out_for_delivery: ["delivered"],
  delivered: [],
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
        ...(query.status === "active" ? { status: { in: ACTIVE_STATUSES } } : {}),
      },
      include: { customer: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    });

    if (rows.length === 0) return [];

    const itemCounts = await prisma.orderItem.groupBy({
      by: ["orderId"],
      where: { orderId: { in: rows.map((r) => r.id) } },
      _count: { _all: true },
    });

    const countByOrder = new Map(itemCounts.map((c) => [c.orderId, c._count._all]));

    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      paymentMethod: row.paymentMethod,
      itemsTotal: row.itemsTotal,
      totalAmount: row.totalAmount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      customerName: row.customer.name,
      itemCount: countByOrder.get(row.id) ?? 0,
    }));
  }

  async getStats(auth: AuthUser, storeId: string) {
    void auth;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // An order placed yesterday and delivered today is part of "today" twice
    // over — it's still in-flight revenue until delivery closes it out. Count
    // it under whichever day that happens, not the day it was merely placed,
    // or its revenue never lands in any day's total.
    const touchedToday = {
      storeId,
      status: { not: "cancelled" as const },
      OR: [
        { createdAt: { gte: todayStart } },
        { status: "delivered" as const, updatedAt: { gte: todayStart } },
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

    return prisma.order.update({
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
  }
}

export const storeOrdersService = new StoreOrdersService();
