/**
 * Catalog module schema — master product list at business level.
 *
 * Future microservice: move this file + catalog routes/services into `catalog-service`.
 * Other services reference sku_id as an opaque UUID.
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
import { catalogStatusEnum } from "./enums.js";

export const masterCatalog = pgTable(
  "master_catalog",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Tenant scoping — every catalog query MUST filter on business_id.
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    name: text("name").notNull(),
    brand: text("brand"),
    category: text("category"),
    // Duplicate detection is per-business, not global (see composite unique below).
    barcode: text("barcode"),
    basePrice: numeric("base_price", { precision: 10, scale: 2 }).notNull(),
    // ISO 4217 code (USD, INR, EUR, ...) — a display tag, not a live conversion rate.
    currency: text("currency").notNull().default("USD"),
    // "Was" price shown struck-through next to basePrice; null = no markdown shown.
    compareAtPrice: numeric("compare_at_price", { precision: 10, scale: 2 }),
    costPrice: numeric("cost_price", { precision: 10, scale: 2 }),
    taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    // Storefront can still list it at 0 stock instead of hiding it.
    allowBackorder: boolean("allow_backorder").notNull().default(false),
    unitOfMeasure: text("unit_of_measure").notNull(),
    // Human-readable internal identifier (e.g. SKU-8F3K2A); generated server-side when absent.
    skuCode: text("sku_code"),
    isFragile: boolean("is_fragile").notNull().default(false),
    requiresColdStorage: boolean("requires_cold_storage").notNull().default(false),
    weightKg: numeric("weight_kg", { precision: 10, scale: 3 }),
    // { length, width, height } in centimeters
    dimensionsCm: jsonb("dimensions_cm"),
    // Seed values for store_sku_mapping.reorderThreshold / onboarding stock-in.
    defaultReorderPoint: integer("default_reorder_point").notNull().default(10),
    defaultInitialStock: integer("default_initial_stock"),
    images: jsonb("images").notNull().default([]),
    description: text("description"),
    // Free-form key/value spec sheet: [{ key: "Processor", value: "Intel i8" }, ...].
    specs: jsonb("specs").notNull().default([]),
    // Lightweight variants: [{ name: "Size", values: ["S","M","L"] }, ...] — max 2 options.
    variantOptions: jsonb("variant_options").notNull().default([]),
    // One row per option combination: [{ id, options: {Size:"M"}, price, barcode, stock }, ...].
    // Rides along with the parent SKU — not individually mapped to stores/inventory.
    variants: jsonb("variants").notNull().default([]),
    // Stays 'draft' until at least one store assignment exists (Step 3).
    status: catalogStatusEnum("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("master_catalog_business_barcode_unique").on(table.businessId, table.barcode),
    unique("master_catalog_business_sku_code_unique").on(table.businessId, table.skuCode),
  ],
);
