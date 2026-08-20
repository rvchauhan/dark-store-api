import { Prisma } from "@prisma/client";
import { prisma } from "../../db/client.js";
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
    const cart = await prisma.cart.findFirst({ where: { customerId } });
    if (!cart) {
      throw new AppError(400, "Cart is empty", "EMPTY_CART");
    }

    return prisma.$transaction(async (tx) => {
      const cartLines = await tx.cartItem.findMany({
        where: { cartId: cart.id },
        include: {
          sku: { select: { name: true, basePrice: true } },
        },
      });

      if (cartLines.length === 0) {
        throw new AppError(400, "Cart is empty", "EMPTY_CART");
      }

      const store = await tx.store.findUnique({ where: { id: cart.storeId } });
      if (!store) {
        throw new AppError(404, "Store not found", "NOT_FOUND");
      }

      const skuIds = cartLines.map((l) => l.skuId);
      const mappings = await tx.storeSkuMapping.findMany({
        where: { storeId: cart.storeId, skuId: { in: skuIds } },
        include: { snapshot: { select: { availableQty: true } } },
      });
      const mappingBySku = new Map(mappings.map((m) => [m.skuId, m]));

      const rows = cartLines.map((line) => {
        const mapping = mappingBySku.get(line.skuId);
        return {
          skuId: line.skuId,
          quantity: line.quantity,
          name: line.sku.name,
          basePrice: line.sku.basePrice,
          priceOverride: mapping?.priceOverride ?? null,
          isListed: mapping?.isListed ?? false,
          storeStatus: store.status,
          businessId: store.businessId,
          availableQty: mapping?.snapshot?.availableQty ?? 0,
        };
      });

      for (const row of rows) {
        if (!row.isListed || row.storeStatus !== "active") {
          throw new AppError(409, `${row.name} is no longer available`, "ITEM_UNAVAILABLE");
        }
        if (row.availableQty < row.quantity) {
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

      const order = await tx.order.create({
        data: {
          customerId,
          businessId: rows[0].businessId,
          storeId: cart.storeId,
          status: "placed",
          deliveryAddress: input.deliveryAddress as Prisma.InputJsonValue,
          paymentMethod: input.paymentMethod,
          itemsTotal: itemsTotal.toFixed(2),
          deliveryFee: DELIVERY_FEE.toFixed(2),
          handlingFee: HANDLING_FEE.toFixed(2),
          totalAmount: totalAmount.toFixed(2),
        },
      });

      await tx.orderItem.createMany({
        data: lineItems.map((item) => ({ orderId: order.id, ...item })),
      });

      for (const row of rows) {
        const ledgerRow = await tx.inventoryLedger.create({
          data: {
            storeId: cart.storeId,
            skuId: row.skuId,
            type: "sale",
            quantity: -row.quantity,
            referenceId: order.id,
            source: "customer_order",
          },
        });

        await tx.inventorySnapshot.update({
          where: { storeId_skuId: { storeId: cart.storeId, skuId: row.skuId } },
          data: {
            availableQty: { decrement: row.quantity },
            lastLedgerId: ledgerRow.id,
          },
        });
      }

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      await tx.cart.delete({ where: { id: cart.id } });

      return { order, items: lineItems };
    });
  }

  async listOrders(customerId: string) {
    return prisma.order.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
    });
  }

  async getOrder(customerId: string, orderId: string) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.customerId !== customerId) {
      throw new AppError(404, "Order not found", "NOT_FOUND");
    }

    const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    return { order, items };
  }
}

export const ordersService = new OrdersService();
