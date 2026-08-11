/**
 * PostgreSQL enums shared across domain modules.
 *
 * Keeping enums in one file avoids circular imports between schema modules.
 * When splitting into microservices later, each service owns the enums
 * for its tables — copy the relevant subset at extraction time.
 */
import { pgEnum } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", [
  "business_admin",
  "store_manager",
  "store_employee",
]);

export const userStatusEnum = pgEnum("user_status", ["invited", "active", "disabled"]);

export const storeStatusEnum = pgEnum("store_status", [
  "onboarding",
  "active",
  "inactive",
  "closed",
]);

export const catalogStatusEnum = pgEnum("catalog_status", ["draft", "active", "archived"]);

export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", [
  "stock_in",
  "sale",
  "damage",
  "return",
  "adjustment",
  "correction",
]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "low_stock",
  "qty_mismatch",
  "ledger_drift",
  "store_verification_pending",
]);

export const notificationStatusEnum = pgEnum("notification_status", [
  "pending",
  "acknowledged",
  "resolved",
]);

export const customerStatusEnum = pgEnum("customer_status", ["active", "disabled"]);

export const orderStatusEnum = pgEnum("order_status", [
  "placed",
  "confirmed",
  "preparing",
  "out_for_delivery",
  "delivered",
  "cancelled",
]);
