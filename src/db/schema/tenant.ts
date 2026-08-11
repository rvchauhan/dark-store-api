/**
 * Tenant + identity tables.
 *
 * Module boundary: these tables are shared infrastructure.
 * Auth service would own `users` in a future split; `businesses` is the tenant root.
 */
import { jsonb, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { userRoleEnum, userStatusEnum } from "./enums.js";

// Every row in the system belongs to exactly one business (multi-tenancy root).
export const businesses = pgTable("businesses", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Users authenticate against this table. store_id is NULL for business_admin.
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    // NULL for business_admin — they see all stores in the business.
    // Set for store_manager / store_employee to scope API access to one store.
    storeId: uuid("store_id"),
    name: text("name").notNull(),
    email: text("email").notNull(),
    // Optional — Google-only accounts have null password_hash
    passwordHash: text("password_hash"),
    phone: text("phone"),
    // Google subject (`sub`) when signed up / linked via Google Identity
    googleId: text("google_id"),
    role: userRoleEnum("role").notNull(),
    status: userStatusEnum("status").notNull().default("invited"),
    // Per-user alert toggles (e.g. { lowStock: true, orderSla: true, dailySummary: false }).
    // Not yet consumed by a notification sender — see notifications table.
    notificationPreferences: jsonb("notification_preferences").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_google_id_unique").on(table.googleId),
  ],
);

/**
 * One-time setup links for invited users (store managers created via the
 * dark-store onboarding wizard). Only the sha256 hash of the raw token is
 * stored — the raw token exists only in the URL sent to the invitee.
 */
export const inviteTokens = pgTable(
  "invite_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("invite_tokens_token_hash_unique").on(table.tokenHash)],
);
