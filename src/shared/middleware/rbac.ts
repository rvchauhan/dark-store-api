import type { Request, Response, NextFunction } from "express";
import { prisma } from "../../db/client.js";
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
 * Ensures a caller can only reach stores they are entitled to.
 *
 * - store-scoped roles: only their own store_id.
 * - business_admin: any store, but only within their own business. The tenant
 *   check matters because store ids are supplied in the URL, and admin-level
 *   credentials (including partner API keys) would otherwise read across
 *   tenants — the service layer scopes by store_id alone.
 */
export function requireStoreAccess(storeIdParam = "id") {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      return next(new AppError(401, "Not authenticated", "UNAUTHORIZED"));
    }

    const rawStoreId = req.params[storeIdParam];
    const requestedStoreId = typeof rawStoreId === "string" ? rawStoreId : undefined;
    if (!requestedStoreId) {
      return next(new AppError(400, `Missing ${storeIdParam} parameter`, "VALIDATION_ERROR"));
    }

    if (req.auth.role === "business_admin") {
      try {
        const store = await prisma.store.findUnique({
          where: { id: requestedStoreId },
          select: { businessId: true },
        });

        if (!store || store.businessId !== req.auth.businessId) {
          return next(new AppError(403, "Cannot access another business's store", "FORBIDDEN"));
        }
      } catch (err) {
        return next(err);
      }

      return next();
    }

    if (!req.auth.storeId || req.auth.storeId !== requestedStoreId) {
      return next(new AppError(403, "Cannot access another store's data", "FORBIDDEN"));
    }

    next();
  };
}
