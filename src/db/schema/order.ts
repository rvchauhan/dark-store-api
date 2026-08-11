/**
 * Cart + order schema — the customer-facing checkout flow.
 *
 * Future microservice: `order-service` owns these tables. Stock changes at
 * checkout go through the *existing* inventory_ledger/inventory_snapshot
 * contract (see inventory.ts) rather than inventing a new one, so orders
 * placed here show up correctly in the staff portal's inventory views.
 */
import { integer, numeric, pgTable, text, timestamp, unique, uuid, jsonb } from "drizzle-orm/pg-core";
import { businesses } from "./tenant.js";
import { customers } from "./customer.js";
import { stores } from "./store.js";
import { masterCatalog } from "./catalog.js";
import { orderStatusEnum } from "./enums.js";

// One active cart per customer — enforced by app logic (cart module), not a
// DB constraint, since "active" isn't a column value here (a cart is deleted
// once it converts to an order).
export const carts = pgTable("carts", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  storeId: uuid("store_id")
    .notNull()
    .references(() => stores.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cartItems = pgTable(
  "cart_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id),
    skuId: uuid("sku_id")
      .notNull()
      .references(() => masterCatalog.id),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("cart_items_cart_sku_unique").on(table.cartId, table.skuId)],
);

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  // Denormalized from the fulfilling store — every business-owned row carries
  // business_id so staff-side reporting/queries can filter on it.
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id),
  storeId: uuid("store_id")
    .notNull()
    .references(() => stores.id),
  status: orderStatusEnum("status").notNull().default("placed"),
  // Free-form at MVP — { line1, line2, city, postalCode, phone }
  deliveryAddress: jsonb("delivery_address").notNull(),
  paymentMethod: text("payment_method").notNull(),
  itemsTotal: numeric("items_total", { precision: 10, scale: 2 }).notNull(),
  deliveryFee: numeric("delivery_fee", { precision: 10, scale: 2 }).notNull().default("0"),
  handlingFee: numeric("handling_fee", { precision: 10, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull(),
  // Set when the order is dispatched (status -> out_for_delivery); required by that transition.
  riderName: text("rider_name"),
  riderPhone: text("rider_phone"),
  trackingName: text("tracking_name"),
  trackingNumber: text("tracking_number"),
  trackingUrl: text("tracking_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Name/price snapshotted at order time — decoupled from later catalog edits.
export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  skuId: uuid("sku_id")
    .notNull()
    .references(() => masterCatalog.id),
  nameSnapshot: text("name_snapshot").notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  quantity: integer("quantity").notNull(),
  lineTotal: numeric("line_total", { precision: 10, scale: 2 }).notNull(),
});
