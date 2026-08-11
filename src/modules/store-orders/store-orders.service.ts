import { and, asc, count, eq, gte, inArray, ne, or, sum } from "drizzle-orm";
import { db } from "../../db/client.js";
import { orders, orderItems } from "../../db/schema/order.js";
import { customers } from "../../db/schema/customer.js";
import { masterCatalog } from "../../db/schema/catalog.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { AuthUser } from "../../shared/types/auth.js";
import type { ListOrdersQuery } from "./store-orders.schemas.js";

const ACTIVE_STATUSES = ["placed", "confirmed", "preparing", "out_for_delivery"] as const;

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

    const conditions = [eq(orders.storeId, storeId)];
    if (query.status === "active") {
      conditions.push(inArray(orders.status, ACTIVE_STATUSES));
    }

    const rows = await db
      .select({
        id: orders.id,
        status: orders.status,
        paymentMethod: orders.paymentMethod,
        itemsTotal: orders.itemsTotal,
        totalAmount: orders.totalAmount,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        customerName: customers.name,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(and(...conditions))
      .orderBy(asc(orders.createdAt));

    if (rows.length === 0) return [];

    const itemCounts = await db
      .select({ orderId: orderItems.orderId, count: count() })
      .from(orderItems)
      .where(
        inArray(
          orderItems.orderId,
          rows.map((r) => r.id),
        ),
      )
      .groupBy(orderItems.orderId);

    const countByOrder = new Map(itemCounts.map((c) => [c.orderId, Number(c.count)]));

    return rows.map((row) => ({ ...row, itemCount: countByOrder.get(row.id) ?? 0 }));
  }

  async getStats(auth: AuthUser, storeId: string) {
    void auth;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // An order placed yesterday and delivered today is part of "today" twice
    // over — it's still in-flight revenue until delivery closes it out. Count
    // it under whichever day that happens, not the day it was merely placed,
    // or its revenue never lands in any day's total.
    const touchedToday = and(
      eq(orders.storeId, storeId),
      ne(orders.status, "cancelled"),
      or(
        gte(orders.createdAt, todayStart),
        and(eq(orders.status, "delivered"), gte(orders.updatedAt, todayStart)),
      ),
    );

    const [todayRow] = await db.select({ count: count() }).from(orders).where(touchedToday);

    const [activeRow] = await db
      .select({ count: count() })
      .from(orders)
      .where(and(eq(orders.storeId, storeId), inArray(orders.status, ACTIVE_STATUSES)));

    const [revenueRow] = await db
      .select({ total: sum(orders.totalAmount) })
      .from(orders)
      .where(touchedToday);

    return {
      todayCount: Number(todayRow?.count ?? 0),
      activeCount: Number(activeRow?.count ?? 0),
      todayRevenue: Number(revenueRow?.total ?? 0),
    };
  }

  async getOrder(auth: AuthUser, storeId: string, orderId: string) {
    void auth;

    const [order] = await db
      .select({
        id: orders.id,
        storeId: orders.storeId,
        status: orders.status,
        deliveryAddress: orders.deliveryAddress,
        paymentMethod: orders.paymentMethod,
        itemsTotal: orders.itemsTotal,
        deliveryFee: orders.deliveryFee,
        handlingFee: orders.handlingFee,
        totalAmount: orders.totalAmount,
        riderName: orders.riderName,
        riderPhone: orders.riderPhone,
        trackingName: orders.trackingName,
        trackingNumber: orders.trackingNumber,
        trackingUrl: orders.trackingUrl,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        customerName: customers.name,
        customerPhone: customers.phone,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order || order.storeId !== storeId) {
      throw new AppError(404, "Order not found", "NOT_FOUND");
    }

    const items = await db
      .select({
        id: orderItems.id,
        orderId: orderItems.orderId,
        skuId: orderItems.skuId,
        nameSnapshot: orderItems.nameSnapshot,
        unitPrice: orderItems.unitPrice,
        quantity: orderItems.quantity,
        lineTotal: orderItems.lineTotal,
        brand: masterCatalog.brand,
        category: masterCatalog.category,
        images: masterCatalog.images,
        description: masterCatalog.description,
        isFragile: masterCatalog.isFragile,
        requiresColdStorage: masterCatalog.requiresColdStorage,
        weightKg: masterCatalog.weightKg,
        dimensionsCm: masterCatalog.dimensionsCm,
        barcode: masterCatalog.barcode,
        skuCode: masterCatalog.skuCode,
        specs: masterCatalog.specs,
      })
      .from(orderItems)
      // left join: an order must still render its picking list even if the
      // SKU was later archived/deleted from the catalog.
      .leftJoin(masterCatalog, eq(masterCatalog.id, orderItems.skuId))
      .where(eq(orderItems.orderId, orderId));

    return { order, items };
  }

  async updateStatus(
    auth: AuthUser,
    storeId: string,
    orderId: string,
    input: { status: string; riderName?: string; riderPhone?: string },
  ) {
    void auth;
    const { status } = input;

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
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

    const [updated] = await db
      .update(orders)
      // Drizzle's pgEnum column type narrows to the enum union; `status` here is
      // already validated against the same enum by updateOrderStatusSchema.
      .set({
        status: status as (typeof orders.$inferInsert)["status"],
        ...(riderName !== undefined ? { riderName } : {}),
        ...(riderPhone !== undefined ? { riderPhone } : {}),
        ...(trackingName !== undefined ? { trackingName } : {}),
        ...(trackingNumber !== undefined ? { trackingNumber } : {}),
        ...(trackingUrl !== undefined ? { trackingUrl } : {}),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId))
      .returning();

    return updated;
  }
}

export const storeOrdersService = new StoreOrdersService();
