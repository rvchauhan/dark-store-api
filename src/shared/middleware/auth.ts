import type { Request, Response, NextFunction } from "express";
import { env } from "../../config/env.js";
import type { AuthUser } from "../types/auth.js";
import { AppError } from "../errors/app-error.js";
import { verifyAccessToken } from "../auth/jwt.js";

// Extend Express Request so downstream handlers get typed req.auth
declare global {
  namespace Express {
    interface Request {
      auth?: AuthUser;
    }
  }
}

/**
 * Verifies Bearer JWT and attaches AuthUser to req.auth.
 * All protected routes sit behind this middleware.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(new AppError(401, "Missing or invalid Authorization header", "UNAUTHORIZED"));
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = verifyAccessToken(token, env.JWT_SECRET);
    if (payload.type === "customer") {
      return next(new AppError(401, "Invalid or expired token", "UNAUTHORIZED"));
    }

    req.auth = {
      userId: payload.sub,
      businessId: payload.business_id,
      role: payload.role as AuthUser["role"],
      storeId: payload.store_id ?? null,
      email: payload.email,
      name: payload.name,
    };

    next();
  } catch {
    next(new AppError(401, "Invalid or expired token", "UNAUTHORIZED"));
  }
}
