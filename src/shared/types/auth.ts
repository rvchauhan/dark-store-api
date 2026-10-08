/**
 * Authenticated principal — attached to every authenticated request as req.auth.
 *
 * business_id scopes multi-tenancy; store_id scopes store-level roles.
 *
 * Credentials that produce this shape (see shared/middleware/auth.ts):
 *   - A staff JWT, which always has a userId.
 *   - An organization partner API key (userId null, apiKey set).
 *
 * Platform partner keys do NOT use this type — they attach `req.platformKey`
 * via requirePlatformKey and never reach tenant-scoped services.
 */
export type AuthUser = {
  /** null when the request authenticated with an organization partner API key. */
  userId: string | null;
  businessId: string;
  role: "business_admin" | "store_manager" | "store_employee";
  storeId: string | null;
  email: string;
  name: string;
  /** Present only for organization-scoped machine requests. */
  apiKey?: {
    id: string;
    name: string;
    scopes: string[];
  };
};

export type UserRole = AuthUser["role"];

/** Identity attached by requirePlatformKey for /api/partner/* only. */
export type PlatformKeyAuth = {
  id: string;
  name: string;
  scopes: string[];
};
