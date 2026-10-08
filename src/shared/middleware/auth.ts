import type { Request, Response, NextFunction } from "express";
import { env } from "../../config/env.js";
import type { AuthUser, PlatformKeyAuth } from "../types/auth.js";
import { AppError } from "../errors/app-error.js";
import { verifyAccessToken } from "../auth/jwt.js";
import { partnerKeysService } from "../../modules/partner-keys/partner-keys.service.js";

// Extend Express Request so downstream handlers get typed auth context
declare global {
  namespace Express {
    interface Request {
      auth?: AuthUser;
      /** Set only by requirePlatformKey for /api/partner/* routes. */
      platformKey?: PlatformKeyAuth;
    }
  }
}

/** Header carrying an organization's partner API key. */
export const API_KEY_HEADER = "x-api-key";

/** Methods that only read — everything else needs the "write" scope. */
const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Verifies the request's credential and attaches AuthUser to req.auth.
 * All protected tenant routes sit behind this middleware.
 *
 * Accepts either credential:
 *   - `x-api-key: dsk_...`      — organization partner key (machine)
 *   - `Authorization: Bearer …` — staff JWT (human)
 *
 * Platform keys (no businessId) are rejected here — they must use
 * requirePlatformKey on /api/partner/* instead.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const apiKey = req.headers[API_KEY_HEADER];

  if (typeof apiKey === "string" && apiKey.length > 0) {
    try {
      const key = await partnerKeysService.verify(apiKey);

      if (!READ_ONLY_METHODS.has(req.method) && !key.scopes.includes("write")) {
        throw new AppError(
          403,
          'API key is missing the "write" scope',
          "INSUFFICIENT_SCOPE",
        );
      }

      if (key.isPlatform || !key.businessId) {
        throw new AppError(
          403,
          "Platform API keys can only call /api/partner/* provisioning routes",
          "PLATFORM_KEY_NOT_ALLOWED",
        );
      }

      req.auth = {
        userId: null,
        businessId: key.businessId,
        role: "business_admin",
        storeId: null,
        email: `partner:${key.name}`,
        name: key.name,
        apiKey: { id: key.id, name: key.name, scopes: key.scopes },
      };

      return next();
    } catch (err) {
      return next(err);
    }
  }

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

/**
 * Accepts only a platform partner API key (businessId null).
 * Used by /api/partner/provision so the Shopify app can create merchants.
 */
export async function requirePlatformKey(req: Request, _res: Response, next: NextFunction) {
  const apiKey = req.headers[API_KEY_HEADER];

  if (typeof apiKey !== "string" || apiKey.length === 0) {
    return next(new AppError(401, "Missing x-api-key header", "UNAUTHORIZED"));
  }

  try {
    const key = await partnerKeysService.verify(apiKey);

    if (!key.isPlatform) {
      return next(
        new AppError(
          403,
          "This endpoint requires a platform partner API key (created with --platform)",
          "PLATFORM_KEY_REQUIRED",
        ),
      );
    }

    if (!READ_ONLY_METHODS.has(req.method) && !key.scopes.includes("write")) {
      return next(
        new AppError(403, 'API key is missing the "write" scope', "INSUFFICIENT_SCOPE"),
      );
    }

    req.platformKey = {
      id: key.id,
      name: key.name,
      scopes: key.scopes,
    };

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Rejects partner keys outright — mounted on routers whose operations only
 * make sense for a signed-in person or belong to the customer identity domain.
 */
export function blockApiKeyAuth(req: Request, _res: Response, next: NextFunction) {
  if (req.headers[API_KEY_HEADER]) {
    return next(
      new AppError(
        403,
        "This endpoint cannot be accessed with a partner API key",
        "API_KEY_NOT_ALLOWED",
      ),
    );
  }
  next();
}

/**
 * Narrows AuthUser to a request made by an actual person.
 * Use in services that must read or write a user row.
 */
export function requireUserId(auth: AuthUser): string {
  if (!auth.userId) {
    throw new AppError(
      403,
      "This action requires a signed-in user",
      "USER_CONTEXT_REQUIRED",
    );
  }
  return auth.userId;
}
