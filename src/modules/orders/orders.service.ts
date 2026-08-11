import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { carts, cartItems, orders, orderItems } from "../../db/schema/order.js";
import { masterCatalog } from "../../db/schema/catalog.js";
import { stores, storeSkuMapping } from "../../db/schema/store.js";
import { inventoryLedger, inventorySnapshot } from "../../db/schema/inventory.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { CheckoutInput } from "./orders.schemas.js";

const HANDLING_FEE = 2;
const DELIVERY_FEE = 0;

/**
 * Orders module service — checkout + order history.
 *
 * Checkout reuses the *existing* inventory_ledger/inventory_snapshot contract
 * (see inventory.service.ts's recordMovement) instead of inventing a new one:
 * every line item becomes a `sale` ledger row with the order id as
 * reference_id, and the same snapshot row the staff portal reads is
 * decremented in the same transaction.
 */
export class OrdersService {
  async checkout(customerId: string, input: CheckoutInput) {
    const [cart] = await db.select().from(carts).where(eq(carts.customerId, customerId)).limit(1);
    if (!cart) {
      throw new AppError(400, "Cart is empty", "EMPTY_CART");
    }

    return db.transaction(async (tx) => {
      const rows = await tx
        .select({
          skuId: cartItems.skuId,
          quantity: cartItems.quantity,
          name: masterCatalog.name,
          basePrice: masterCatalog.basePrice,
          priceOverride: storeSkuMapping.priceOverride,
          isListed: storeSkuMapping.isListed,
          storeStatus: stores.status,
          businessId: stores.businessId,
          availableQty: inventorySnapshot.availableQty,
        })
        .from(cartItems)
        .innerJoin(masterCatalog, eq(cartItems.skuId, masterCatalog.id))
        .innerJoin(
          storeSkuMapping,
          and(eq(storeSkuMapping.storeId, cart.storeId), eq(storeSkuMapping.skuId, cartItems.skuId)),
        )
        .innerJoin(stores, eq(stores.id, cart.storeId))
        .leftJoin(
          inventorySnapshot,
          and(eq(inventorySnapshot.storeId, cart.storeId), eq(inventorySnapshot.skuId, cartItems.skuId)),
        )
        .where(eq(cartItems.cartId, cart.id));

      if (rows.length === 0) {
        throw new AppError(400, "Cart is empty", "EMPTY_CART");
      }

      for (const row of rows) {
        if (!row.isListed || row.storeStatus !== "active") {
          throw new AppError(409, `${row.name} is no longer available`, "ITEM_UNAVAILABLE");
        }
        if ((row.availableQty ?? 0) < row.quantity) {
          throw new AppError(409, `Not enough stock for ${row.name}`, "OUT_OF_STOCK");
        }
      }

      let itemsTotal = 0;
      const lineItems = rows.map((row) => {
        const unitPrice = Number(row.priceOverride ?? row.basePrice);
        const lineTotal = unitPrice * row.quantity;
        itemsTotal += lineTotal;
        return {
          skuId: row.skuId,
          nameSnapshot: row.name,
          unitPrice: unitPrice.toFixed(2),
          quantity: row.quantity,
          lineTotal: lineTotal.toFixed(2),
        };
      });

      const totalAmount = itemsTotal + HANDLING_FEE + DELIVERY_FEE;

      const [order] = await tx
        .insert(orders)
        .values({
          customerId,
          businessId: rows[0].businessId,
          storeId: cart.storeId,
          status: "placed",
          deliveryAddress: input.deliveryAddress,
          paymentMethod: input.paymentMethod,
          itemsTotal: itemsTotal.toFixed(2),
          deliveryFee: DELIVERY_FEE.toFixed(2),
          handlingFee: HANDLING_FEE.toFixed(2),
          totalAmount: totalAmount.toFixed(2),
        })
        .returning();

      await tx.insert(orderItems).values(lineItems.map((item) => ({ orderId: order.id, ...item })));

      for (const row of rows) {
        const [ledgerRow] = await tx
          .insert(inventoryLedger)
          .values({
            storeId: cart.storeId,
            skuId: row.skuId,
            type: "sale",
            quantity: -row.quantity,
            referenceId: order.id,
            source: "customer_order",
          })
          .returning();

        await tx
          .update(inventorySnapshot)
          .set({
            availableQty: sql`${inventorySnapshot.availableQty} - ${row.quantity}`,
            lastLedgerId: ledgerRow.id,
            updatedAt: new Date(),
          })
          .where(and(eq(inventorySnapshot.storeId, cart.storeId), eq(inventorySnapshot.skuId, row.skuId)));
      }

      await tx.delete(cartItems).where(eq(cartItems.cartId, cart.id));
      await tx.delete(carts).where(eq(carts.id, cart.id));

      return { order, items: lineItems };
    });
  }

  async listOrders(customerId: string) {
    return db.select().from(orders).where(eq(orders.customerId, customerId)).orderBy(desc(orders.createdAt));
  }

  async getOrder(customerId: string, orderId: string) {
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order || order.customerId !== customerId) {
      throw new AppError(404, "Order not found", "NOT_FOUND");
    }

    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    return { order, items };
  }
}

export const ordersService = new OrdersService();
