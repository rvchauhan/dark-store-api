/**
 * Inventory module schema — append-only ledger + fast-read snapshot.
 *
 * Future microservice: `inventory-service` owns these tables.
 * Contract to order service: available_qty per (store_id, sku_id).
 *
 * NOTE: No Redis for now — snapshot reads come directly from Postgres.
 * Add Redis caching later without changing the ledger write path.
 */
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { foreignKey } from "drizzle-orm/pg-core";
import { businesses } from "./tenant.js";
import { masterCatalog } from "./catalog.js";
import { stores, storeSkuMapping } from "./store.js";
import { users } from "./tenant.js";
import { ledgerEntryTypeEnum, notificationStatusEnum, notificationTypeEnum } from "./enums.js";

// Append-only event log — application NEVER updates or deletes rows here.
export const inventoryLedger = pgTable(
  "inventory_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id").notNull(),
    skuId: uuid("sku_id").notNull(),
    type: ledgerEntryTypeEnum("type").notNull(),
    // Signed integer: positive = stock_in/return, negative = sale/damage.
    quantity: integer("quantity").notNull(),
    // Polymorphic reference (order_id, invoice_id, etc.) — not a hard FK by design.
    referenceId: uuid("reference_id"),
    employeeId: uuid("employee_id").references(() => users.id),
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Composite FK ensures every ledger row maps to a real store-SKU assignment.
    foreignKey({
      columns: [table.storeId, table.skuId],
      foreignColumns: [storeSkuMapping.storeId, storeSkuMapping.skuId],
      name: "inventory_ledger_store_sku_mapping_fk",
    }),
    // Speeds up "history for this store+SKU ordered by time" (ledger UI + reconciliation).
    index("idx_ledger_store_sku_time").on(table.storeId, table.skuId, table.createdAt),
  ],
);

// Fast-read cache — always derivable from SUM(inventory_ledger.quantity).
// Updated in the SAME transaction as each ledger INSERT.
export const inventorySnapshot = pgTable(
  "inventory_snapshot",
  {
    storeId: uuid("store_id").notNull(),
    skuId: uuid("sku_id").notNull(),
    availableQty: integer("available_qty").notNull().default(0),
    lastLedgerId: uuid("last_ledger_id").references(() => inventoryLedger.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.storeId, table.skuId], name: "inventory_snapshot_pkey" }),
    foreignKey({
      columns: [table.storeId, table.skuId],
      foreignColumns: [storeSkuMapping.storeId, storeSkuMapping.skuId],
      name: "inventory_snapshot_store_sku_mapping_fk",
    }),
  ],
);

// Alert records — low_stock, ledger_drift, etc. (HLD Step 6).
// Without Redis/BullMQ, threshold checks run via a scheduled script or admin trigger for now.
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id),
  storeId: uuid("store_id").references(() => stores.id),
  skuId: uuid("sku_id").references(() => masterCatalog.id),
  type: notificationTypeEnum("type").notNull(),
  payload: jsonb("payload"),
  status: notificationStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
