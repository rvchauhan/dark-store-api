/**
 * Store module schema — dark store registry + SKU-to-store mapping.
 *
 * Future microservice: `store-service` owns `stores` and `store_sku_mapping`.
 * Inventory service references (store_id, sku_id) pairs via composite FK.
 */
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { businesses } from "./tenant.js";
import { masterCatalog } from "./catalog.js";
import { storeStatusEnum } from "./enums.js";

export const stores = pgTable("stores", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id),
  name: text("name").notNull(),
  // Human-readable code shown in UI (e.g. DS04) — optional but useful for ops.
  code: text("code"),
  address: text("address").notNull(),
  // GeoJSON polygon/circle — customer app reads this for delivery radius (Flow 3).
  geofence: jsonb("geofence").notNull(),
  operatingHours: jsonb("operating_hours").notNull(),
  // Flexible facility fields from onboarding UI (capacity, cold storage, etc.).
  facility: jsonb("facility"),
  // Gatekeeper: SKU assignment + customer visibility require status = 'active'.
  status: storeStatusEnum("status").notNull().default("onboarding"),
  // Circular FK to users — set after manager account is created during onboarding.
  managerUserId: uuid("manager_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// The table that makes a SKU sellable at a specific store (HLD Step 3).
export const storeSkuMapping = pgTable(
  "store_sku_mapping",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    skuId: uuid("sku_id")
      .notNull()
      .references(() => masterCatalog.id),
    // NULL means "use master_catalog.base_price"
    priceOverride: numeric("price_override", { precision: 10, scale: 2 }),
    // Customer-facing on/off switch for this store.
    isListed: boolean("is_listed").notNull().default(false),
    // Compared against inventory_snapshot.available_qty for low_stock alerts.
    reorderThreshold: integer("reorder_threshold").notNull().default(10),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // THE real identity of a mapping — inventory tables FK to this pair, not mapping.id.
  (table) => [unique("store_sku_mapping_store_sku_unique").on(table.storeId, table.skuId)],
);
