import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { carts, cartItems } from "../../db/schema/order.js";
import { masterCatalog } from "../../db/schema/catalog.js";
import { stores, storeSkuMapping } from "../../db/schema/store.js";
import { inventorySnapshot } from "../../db/schema/inventory.js";
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
    return this.cartWithItems(cart);
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
      [cart] = await db.insert(carts).values({ customerId, storeId: input.storeId }).returning();
    }

    await db
      .insert(cartItems)
      .values({ cartId: cart.id, skuId: input.skuId, quantity: input.quantity })
      .onConflictDoUpdate({
        target: [cartItems.cartId, cartItems.skuId],
        set: { quantity: sql`${cartItems.quantity} + ${input.quantity}` },
      });

    await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id));

    return this.cartWithItems(cart);
  }

  async updateItemQuantity(customerId: string, skuId: string, quantity: number) {
    const cart = await this.findCart(customerId);
    if (!cart) {
      throw new AppError(404, "Cart is empty", "NOT_FOUND");
    }

    if (quantity === 0) {
      await db.delete(cartItems).where(and(eq(cartItems.cartId, cart.id), eq(cartItems.skuId, skuId)));
    } else {
      await this.assertPurchasable(cart.storeId, skuId, quantity);
      const updated = await db
        .update(cartItems)
        .set({ quantity })
        .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.skuId, skuId)))
        .returning();

      if (updated.length === 0) {
        throw new AppError(404, "Item not in cart", "NOT_FOUND");
      }
    }

    await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id));
    return this.cartWithItems(cart);
  }

  async removeItem(customerId: string, skuId: string) {
    return this.updateItemQuantity(customerId, skuId, 0);
  }

  async clearCart(customerId: string) {
    const cart = await this.findCart(customerId);
    if (!cart) return { cleared: true };

    await db.transaction(async (tx) => {
      await tx.delete(cartItems).where(eq(cartItems.cartId, cart.id));
      await tx.delete(carts).where(eq(carts.id, cart.id));
    });

    return { cleared: true };
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private async findCart(customerId: string) {
    const [cart] = await db.select().from(carts).where(eq(carts.customerId, customerId)).limit(1);
    return cart ?? null;
  }

  private async cartWithItems(cart: typeof carts.$inferSelect) {
    const rows = await db
      .select({
        skuId: cartItems.skuId,
        quantity: cartItems.quantity,
        name: masterCatalog.name,
        images: masterCatalog.images,
        basePrice: masterCatalog.basePrice,
        priceOverride: storeSkuMapping.priceOverride,
      })
      .from(cartItems)
      .innerJoin(masterCatalog, eq(cartItems.skuId, masterCatalog.id))
      .leftJoin(
        storeSkuMapping,
        and(eq(storeSkuMapping.storeId, cart.storeId), eq(storeSkuMapping.skuId, cartItems.skuId)),
      )
      .where(eq(cartItems.cartId, cart.id));

    const items = rows.map((row) => {
      const price = Number(row.priceOverride ?? row.basePrice);
      const lineTotal = price * row.quantity;
      return {
        skuId: row.skuId,
        name: row.name,
        image: Array.isArray(row.images) && row.images.length > 0 ? row.images[0] : null,
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
    const [row] = await db
      .select({
        isListed: storeSkuMapping.isListed,
        storeStatus: stores.status,
        availableQty: inventorySnapshot.availableQty,
      })
      .from(storeSkuMapping)
      .innerJoin(stores, eq(stores.id, storeSkuMapping.storeId))
      .leftJoin(
        inventorySnapshot,
        and(eq(inventorySnapshot.storeId, storeSkuMapping.storeId), eq(inventorySnapshot.skuId, storeSkuMapping.skuId)),
      )
      .where(and(eq(storeSkuMapping.storeId, storeId), eq(storeSkuMapping.skuId, skuId)))
      .limit(1);

    if (!row || !row.isListed || row.storeStatus !== "active") {
      throw new AppError(404, "Product is not available", "NOT_FOUND");
    }

    if ((row.availableQty ?? 0) < quantity) {
      throw new AppError(409, "Not enough stock available", "OUT_OF_STOCK");
    }
  }
}

export const cartService = new CartService();
