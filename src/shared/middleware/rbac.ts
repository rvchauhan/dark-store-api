import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/app-error.js";
import type { UserRole } from "../types/auth.js";

/**
 * Role-based access control factory.
 *
 * Usage:
 *   router.post('/skus', requireAuth, requireRoles('business_admin'), handler)
 *
 * When extracting microservices, each service enforces only the roles it cares about.
 */
export function requireRoles(...allowed: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      return next(new AppError(401, "Not authenticated", "UNAUTHORIZED"));
    }
    if (!allowed.includes(req.auth.role)) {
      return next(new AppError(403, "Insufficient permissions", "FORBIDDEN"));
    }
    next();
  };
}

/**
 * Ensures store-scoped users can only access their own store_id.
 * business_admin bypasses this check (they see all stores in the business).
 */
export function requireStoreAccess(storeIdParam = "id") {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      return next(new AppError(401, "Not authenticated", "UNAUTHORIZED"));
    }

    // Admins are not tied to a single store
    if (req.auth.role === "business_admin") {
      return next();
    }

    const requestedStoreId = req.params[storeIdParam];
    if (!req.auth.storeId || req.auth.storeId !== requestedStoreId) {
      return next(new AppError(403, "Cannot access another store's data", "FORBIDDEN"));
    }

    next();
  };
}
