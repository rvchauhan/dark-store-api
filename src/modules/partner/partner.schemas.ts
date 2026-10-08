import { z } from "zod";

const adminSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(5).max(40).optional(),
  /**
   * Optional password for later portal email/password login.
   * If omitted, the admin is active with JWT returned now, but must set a
   * password (or use Google) before the next email/password login.
   */
  password: z.string().min(8).optional(),
});

/**
 * Optional first dark store created at provision time.
 * Geofence / operatingHours get safe defaults when omitted so Shopify install
 * can register a store with only name + address.
 */
export const provisionStoreSchema = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().min(1).max(500),
  code: z.string().trim().max(32).optional(),
  geofence: z.record(z.unknown()).optional(),
  operatingHours: z.record(z.unknown()).optional(),
  /** When true (default), mark the store active immediately. */
  activate: z.boolean().default(true),
});

export type ProvisionStoreInput = z.infer<typeof provisionStoreSchema>;

/** Request body for POST /api/partner/provision */
export const provisionSchema = z.object({
  /** External system name — typically "shopify". */
  provider: z.string().trim().min(1).max(40).default("shopify"),
  /**
   * Unique identity of the store/site/organization in that system.
   * For Shopify: the shop domain, e.g. "acme.myshopify.com".
   */
  externalId: z.string().trim().min(1).max(200),
  /** Display name for the Business tenant. */
  organizationName: z.string().trim().min(1).max(200),
  /** Optional human-friendly name from the external system. */
  displayName: z.string().trim().max(200).optional(),
  /** Arbitrary metadata (Shopify shop id, plan, locale, …). */
  metadata: z.record(z.unknown()).optional(),
  /** Shopify Admin API offline access token — stored for product/order sync. */
  shopifyAccessToken: z.string().trim().min(1).optional(),
  admin: adminSchema,
  /**
   * Optional first dark store. When set, created in the same transaction as
   * the Business so Shopify install can register + land on a usable store.
   */
  store: provisionStoreSchema.optional(),
});

export type ProvisionInput = z.infer<typeof provisionSchema>;

/**
 * Request body for POST /api/partner/session
 *
 * Lightweight "app open" login: look up by Shopify shop domain and return a
 * fresh staff JWT. Does not create tenants — call /provision for first install.
 */
export const sessionSchema = z.object({
  provider: z.string().trim().min(1).max(40).default("shopify"),
  externalId: z.string().trim().min(1).max(200),
  /**
   * Optional — when provided, prefer this admin email within the business.
   * Otherwise the earliest business_admin is used.
   */
  adminEmail: z.string().email().optional(),
  /** Refreshes the Shopify Admin API token on every app open. */
  shopifyAccessToken: z.string().trim().min(1).optional(),
});

export type SessionInput = z.infer<typeof sessionSchema>;
