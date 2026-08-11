/**
 * Customer identity — separate from `users` (business_admin/store_manager/store_employee).
 *
 * Staff accounts are tenant-scoped (business_id/store_id baked into every claim
 * and RBAC check). Customers are not tied to one business — they browse and
 * order across any active store — so they get their own table and JWT shape
 * instead of a fourth `user_role` value.
 */
import { pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { customerStatusEnum } from "./enums.js";

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    // Optional — Google-only accounts have null password_hash
    passwordHash: text("password_hash"),
    phone: text("phone"),
    // Google subject (`sub`) when signed up / linked via Google Identity
    googleId: text("google_id"),
    status: customerStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("customers_email_unique").on(table.email),
    uniqueIndex("customers_google_id_unique").on(table.googleId),
  ],
);
