import { and, count, desc, eq, gte, ne, sql, sum } from "drizzle-orm";
import { db } from "../../db/client.js";
import { orders, orderItems } from "../../db/schema/order.js";
import { inventoryLedger } from "../../db/schema/inventory.js";
import { stores } from "../../db/schema/store.js";
import { masterCatalog } from "../../db/schema/catalog.js";
import type { AuthUser } from "../../shared/types/auth.js";

const TREND_DAYS = 14;
const SKU_WINDOW_DAYS = 30;
const TOP_N = 5;

/**
 * Business-wide admin Analytics — first real version. Everything scoped to the
 * caller's business (orders.businessId directly; ledger/stores joined since
 * inventory_ledger only carries store_id).
 */
export class AnalyticsService {
  async getOverview(auth: AuthUser) {
    const trendSince = new Date(Date.now() - TREND_DAYS * 24 * 60 * 60 * 1000);
    const skuWindowSince = new Date(Date.now() - SKU_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const revenueRows = await db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${orders.createdAt}), 'YYYY-MM-DD')`,
        revenue: sum(orders.totalAmount),
        orderCount: count(),
      })
      .from(orders)
      .where(
        and(
          eq(orders.businessId, auth.businessId),
          gte(orders.createdAt, trendSince),
          ne(orders.status, "cancelled"),
        ),
      )
      .groupBy(sql`date_trunc('day', ${orders.createdAt})`)
      .orderBy(sql`date_trunc('day', ${orders.createdAt})`);

    const unitsRows = await db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${inventoryLedger.createdAt}), 'YYYY-MM-DD')`,
        units: sum(inventoryLedger.quantity),
      })
      .from(inventoryLedger)
      .innerJoin(stores, eq(stores.id, inventoryLedger.storeId))
      .where(
        and(
          eq(stores.businessId, auth.businessId),
          eq(inventoryLedger.type, "sale"),
          gte(inventoryLedger.createdAt, trendSince),
        ),
      )
      .groupBy(sql`date_trunc('day', ${inventoryLedger.createdAt})`)
      .orderBy(sql`date_trunc('day', ${inventoryLedger.createdAt})`);

    const skuSalesRows = await db
      .select({
        skuId: orderItems.skuId,
        name: masterCatalog.name,
        unitsSold: sum(orderItems.quantity),
        revenue: sum(orderItems.lineTotal),
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .innerJoin(masterCatalog, eq(masterCatalog.id, orderItems.skuId))
      .where(
        and(
          eq(orders.businessId, auth.businessId),
          gte(orders.createdAt, skuWindowSince),
          ne(orders.status, "cancelled"),
        ),
      )
      .groupBy(orderItems.skuId, masterCatalog.name);

    const bySkuUnitsDesc = [...skuSalesRows].sort((a, b) => Number(b.unitsSold) - Number(a.unitsSold));

    const statusRows = await db
      .select({ status: orders.status, count: count() })
      .from(orders)
      .where(and(eq(orders.businessId, auth.businessId), gte(orders.createdAt, skuWindowSince)))
      .groupBy(orders.status);

    const [fulfillmentRow] = await db
      .select({
        avgMinutes: sql<string | null>`avg(extract(epoch from (${orders.updatedAt} - ${orders.createdAt})) / 60)`,
      })
      .from(orders)
      .where(
        and(
          eq(orders.businessId, auth.businessId),
          eq(orders.status, "delivered"),
          gte(orders.createdAt, skuWindowSince),
        ),
      );

    return {
      windowDays: SKU_WINDOW_DAYS,
      revenueTrend: revenueRows.map((r) => ({
        day: r.day,
        revenue: Number(r.revenue ?? 0),
        orderCount: Number(r.orderCount),
      })),
      unitsTrend: unitsRows.map((r) => ({ day: r.day, units: Math.abs(Number(r.units ?? 0)) })),
      topSkus: bySkuUnitsDesc.slice(0, TOP_N).map((r) => ({
        skuId: r.skuId,
        name: r.name,
        unitsSold: Number(r.unitsSold),
        revenue: Number(r.revenue ?? 0),
      })),
      // Only meaningful once there are more sold SKUs than the top-N slice, otherwise
      // "slow movers" would just be the same list as "top sellers" reversed.
      slowMovers:
        bySkuUnitsDesc.length > TOP_N
          ? bySkuUnitsDesc
              .slice(-TOP_N)
              .reverse()
              .map((r) => ({
                skuId: r.skuId,
                name: r.name,
                unitsSold: Number(r.unitsSold),
                revenue: Number(r.revenue ?? 0),
              }))
          : [],
      statusBreakdown: statusRows.map((r) => ({ status: r.status, count: Number(r.count) })),
      avgFulfillmentMinutes: fulfillmentRow?.avgMinutes ? Math.round(Number(fulfillmentRow.avgMinutes)) : null,
    };
  }
}

export const analyticsService = new AnalyticsService();
