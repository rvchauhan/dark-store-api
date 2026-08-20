import { Prisma } from "@prisma/client";
import { prisma } from "../../db/client.js";
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
    const businessId = auth.businessId;

    const revenueRows = await prisma.$queryRaw<
      { day: string; revenue: string | null; order_count: bigint }[]
    >(Prisma.sql`
      SELECT
        to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
        SUM(total_amount)::text AS revenue,
        COUNT(*)::bigint AS order_count
      FROM orders
      WHERE business_id = ${businessId}::uuid
        AND created_at >= ${trendSince}
        AND status <> 'cancelled'
      GROUP BY date_trunc('day', created_at)
      ORDER BY date_trunc('day', created_at)
    `);

    const unitsRows = await prisma.$queryRaw<{ day: string; units: string | null }[]>(Prisma.sql`
      SELECT
        to_char(date_trunc('day', l.created_at), 'YYYY-MM-DD') AS day,
        SUM(l.quantity)::text AS units
      FROM inventory_ledger l
      INNER JOIN stores s ON s.id = l.store_id
      WHERE s.business_id = ${businessId}::uuid
        AND l.type = 'sale'
        AND l.created_at >= ${trendSince}
      GROUP BY date_trunc('day', l.created_at)
      ORDER BY date_trunc('day', l.created_at)
    `);

    const skuSalesRows = await prisma.$queryRaw<
      { sku_id: string; name: string; units_sold: string | null; revenue: string | null }[]
    >(Prisma.sql`
      SELECT
        oi.sku_id,
        c.name,
        SUM(oi.quantity)::text AS units_sold,
        SUM(oi.line_total)::text AS revenue
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      INNER JOIN master_catalog c ON c.id = oi.sku_id
      WHERE o.business_id = ${businessId}::uuid
        AND o.created_at >= ${skuWindowSince}
        AND o.status <> 'cancelled'
      GROUP BY oi.sku_id, c.name
    `);

    const bySkuUnitsDesc = [...skuSalesRows].sort(
      (a, b) => Number(b.units_sold) - Number(a.units_sold),
    );

    const statusRows = await prisma.order.groupBy({
      by: ["status"],
      where: {
        businessId,
        createdAt: { gte: skuWindowSince },
      },
      _count: { _all: true },
    });

    const [fulfillmentRow] = await prisma.$queryRaw<{ avg_minutes: string | null }[]>(Prisma.sql`
      SELECT avg(extract(epoch from (updated_at - created_at)) / 60)::text AS avg_minutes
      FROM orders
      WHERE business_id = ${businessId}::uuid
        AND status = 'delivered'
        AND created_at >= ${skuWindowSince}
    `);

    return {
      windowDays: SKU_WINDOW_DAYS,
      revenueTrend: revenueRows.map((r) => ({
        day: r.day,
        revenue: Number(r.revenue ?? 0),
        orderCount: Number(r.order_count),
      })),
      unitsTrend: unitsRows.map((r) => ({ day: r.day, units: Math.abs(Number(r.units ?? 0)) })),
      topSkus: bySkuUnitsDesc.slice(0, TOP_N).map((r) => ({
        skuId: r.sku_id,
        name: r.name,
        unitsSold: Number(r.units_sold),
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
                skuId: r.sku_id,
                name: r.name,
                unitsSold: Number(r.units_sold),
                revenue: Number(r.revenue ?? 0),
              }))
          : [],
      statusBreakdown: statusRows.map((r) => ({ status: r.status, count: r._count._all })),
      avgFulfillmentMinutes: fulfillmentRow?.avg_minutes
        ? Math.round(Number(fulfillmentRow.avg_minutes))
        : null,
    };
  }
}

export const analyticsService = new AnalyticsService();
