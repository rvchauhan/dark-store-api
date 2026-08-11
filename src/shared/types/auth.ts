/**
 * JWT payload shape — attached to every authenticated request as req.auth.
 *
 * business_id scopes multi-tenancy; store_id scopes store-level roles.
 */
export type AuthUser = {
  userId: string;
  businessId: string;
  role: "business_admin" | "store_manager" | "store_employee";
  storeId: string | null;
  email: string;
  name: string;
};

export type UserRole = AuthUser["role"];
