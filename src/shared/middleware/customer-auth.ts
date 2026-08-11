import type { Request, Response, NextFunction } from "express";
import { env } from "../../config/env.js";
import type { CustomerAuthUser, CustomerJwtClaims } from "../types/customer-auth.js";
import { AppError } from "../errors/app-error.js";
import { verifyAccessToken } from "../auth/jwt.js";

declare global {
  namespace Express {
    interface Request {
      customerAuth?: CustomerAuthUser;
    }
  }
}

/**
 * Verifies a Bearer JWT issued by customer-auth and attaches CustomerAuthUser
 * to req.customerAuth. Rejects staff tokens (missing/mismatched `type`).
 */
export async function requireCustomerAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(new AppError(401, "Missing or invalid Authorization header", "UNAUTHORIZED"));
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = verifyAccessToken<CustomerJwtClaims>(token, env.JWT_SECRET);
    if (payload.type !== "customer") {
      return next(new AppError(401, "Invalid or expired token", "UNAUTHORIZED"));
    }

    req.customerAuth = {
      customerId: payload.sub,
      email: payload.email,
      name: payload.name,
    };

    next();
  } catch {
    next(new AppError(401, "Invalid or expired token", "UNAUTHORIZED"));
  }
}
