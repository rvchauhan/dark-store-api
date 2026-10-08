import type { Cart } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { AddCartItemInput } from "./cart.schemas.js";

/**
 * Cart module service — one active cart per customer.
 *
 * A cart is deleted (not just emptied) once it converts to an order in the
 * orders module, so "does a cart row exist for this customer" always means
 * "does this customer have items in progress right now".
 */
export class CartService {
  async getCart(customerId: string) {
    const cart = await this.findCart(customerId);
    if (!cart) return { cartId: null, storeId: null, items: [], itemsTotal: "0.00" };
    await this.pruneUnavailableItems(cart.id, cart.storeId);
    const refreshed = await this.findCart(customerId);
    if (!refreshed) return { cartId: null, storeId: null, items: [], itemsTotal: "0.00" };
    return this.cartWithItems(refreshed);
  }

  async addItem(customerId: string, input: AddCartItemInput) {
    await this.assertPurchasable(input.storeId, input.skuId, input.quantity);

    let cart = await this.findCart(customerId);
    if (cart && cart.storeId !== input.storeId) {
      throw new AppError(
        409,
        "Your cart has items from a different store — clear it to order from this store instead",
        "STORE_MISMATCH",
      );
    }

    if (!cart) {
      cart = await prisma.cart.create({
        data: { customerId, storeId: input.storeId },
      });
    }

    await prisma.cartItem.upsert({
      where: { cartId_skuId: { cartId: cart.id, skuId: input.skuId } },
      create: { cartId: cart.id, skuId: input.skuId, quantity: input.quantity },
      update: { quantity: { increment: input.quantity } },
    });

    await prisma.cart.update({
      where: { id: cart.id },
      data: { updatedAt: new Date() },
    });

    return this.cartWithItems(cart);
  }

  async updateItemQuantity(customerId: string, skuId: string, quantity: number) {
    const cart = await this.findCart(customerId);
    if (!cart) {
      throw new AppError(404, "Cart is empty", "NOT_FOUND");
    }

    if (quantity === 0) {
      await prisma.cartItem.deleteMany({ where: { cartId: cart.id, skuId } });
    } else {
      await this.assertPurchasable(cart.storeId, skuId, quantity);
      const updated = await prisma.cartItem.updateMany({
        where: { cartId: cart.id, skuId },
        data: { quantity },
      });

      if (updated.count === 0) {
        throw new AppError(404, "Item not in cart", "NOT_FOUND");
      }
    }

    await prisma.cart.update({
      where: { id: cart.id },
      data: { updatedAt: new Date() },
    });
    return this.cartWithItems(cart);
  }

  async removeItem(customerId: string, skuId: string) {
    return this.updateItemQuantity(customerId, skuId, 0);
  }

  async clearCart(customerId: string) {
    const cart = await this.findCart(customerId);
    if (!cart) return { cleared: true };

    await prisma.$transaction(async (tx) => {
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      await tx.cart.delete({ where: { id: cart.id } });
    });

    return { cleared: true };
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private async findCart(customerId: string) {
    return prisma.cart.findFirst({ where: { customerId } });
  }

  private async cartWithItems(cart: Cart) {
    const rows = await prisma.cartItem.findMany({
      where: { cartId: cart.id },
      include: {
        sku: { select: { name: true, images: true, basePrice: true } },
      },
    });

    const mappings = await prisma.storeSkuMapping.findMany({
      where: {
        storeId: cart.storeId,
        skuId: { in: rows.map((r) => r.skuId) },
      },
      select: { skuId: true, priceOverride: true },
    });
    const overrideBySku = new Map(mappings.map((m) => [m.skuId, m.priceOverride]));

    const items = rows.map((row) => {
      const price = Number(overrideBySku.get(row.skuId) ?? row.sku.basePrice);
      const lineTotal = price * row.quantity;
      return {
        skuId: row.skuId,
        name: row.sku.name,
        image: Array.isArray(row.sku.images) && row.sku.images.length > 0 ? row.sku.images[0] : null,
        price: price.toFixed(2),
        quantity: row.quantity,
        lineTotal: lineTotal.toFixed(2),
      };
    });

    const itemsTotal = items.reduce((sum, item) => sum + Number(item.lineTotal), 0);

    return {
      cartId: cart.id,
      storeId: cart.storeId,
      items,
      itemsTotal: itemsTotal.toFixed(2),
    };
  }

  /** Re-checks listing/store-active/stock before accepting a cart mutation. */
  private async assertPurchasable(storeId: string, skuId: string, quantity: number) {
    const row = await prisma.storeSkuMapping.findUnique({
      where: { storeId_skuId: { storeId, skuId } },
      include: {
        store: { select: { status: true } },
        sku: { select: { name: true, status: true } },
        snapshot: { select: { availableQty: true } },
      },
    });

    if (!row || !row.isListed || row.store.status !== "active" || row.sku.status === "archived") {
      const name = row?.sku.name ? ` (${row.sku.name})` : "";
      throw new AppError(404, `Product is not available${name}`, "NOT_FOUND");
    }

    if ((row.snapshot?.availableQty ?? 0) < quantity) {
      throw new AppError(409, "Not enough stock available", "OUT_OF_STOCK");
    }
  }

  /**
   * Drop cart lines that can no longer be bought (unlisted / archived / inactive store).
   * Deletes the cart entirely when nothing purchasable remains.
   */
  private async pruneUnavailableItems(cartId: string, storeId: string) {
    const lines = await prisma.cartItem.findMany({
      where: { cartId },
      select: { skuId: true },
    });
    if (lines.length === 0) return;

    const mappings = await prisma.storeSkuMapping.findMany({
      where: { storeId, skuId: { in: lines.map((l) => l.skuId) } },
      include: {
        store: { select: { status: true } },
        sku: { select: { status: true } },
      },
    });
    const ok = new Set(
      mappings
        .filter(
          (m) => m.isListed && m.store.status === "active" && m.sku.status !== "archived",
        )
        .map((m) => m.skuId),
    );

    const staleIds = lines.map((l) => l.skuId).filter((id) => !ok.has(id));
    if (staleIds.length === 0) return;

    await prisma.cartItem.deleteMany({
      where: { cartId, skuId: { in: staleIds } },
    });

    const remaining = await prisma.cartItem.count({ where: { cartId } });
    if (remaining === 0) {
      await prisma.cart.delete({ where: { id: cartId } }).catch(() => undefined);
    }
  }
}

export const cartService = new CartService();
