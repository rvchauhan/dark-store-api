/**
 * Re-push dark-store fulfillments to Shopify for orders whose live sync failed
 * (e.g. the app token was missing fulfillment-order scopes at the time).
 *
 *   npm run sync:fulfillments
 *   npm run sync:fulfillments -- --order <uuid>
 *
 * Safe to re-run: orders already fulfilled on Shopify are skipped.
 */
import "dotenv/config";
import { prisma } from "../db/client.js";
import { syncService } from "../modules/sync/sync.service.js";

const orderFlag = process.argv.indexOf("--order");
const orderId = orderFlag >= 0 ? process.argv[orderFlag + 1] : undefined;

const orders = await prisma.order.findMany({
  where: {
    status: "fulfilled",
    shopifyOrderId: { not: null },
    ...(orderId ? { id: orderId } : {}),
  },
  select: { id: true, businessId: true, orderNumber: true },
  orderBy: { createdAt: "asc" },
});

console.log(`Checking ${orders.length} fulfilled order(s) against Shopify…`);

let failed = 0;
for (const order of orders) {
  try {
    await syncService.syncOrderFulfillmentToShopify(order.id, order.businessId);
  } catch (err) {
    failed += 1;
    console.error(
      `Failed ${order.orderNumber ?? order.id}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

console.log(`Done. ${orders.length - failed} ok, ${failed} failed.`);
await prisma.$disconnect();
process.exit(failed > 0 ? 1 : 0);
