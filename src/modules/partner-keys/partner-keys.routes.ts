import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { partnerKeysService, secretsMatch } from "./partner-keys.service.js";
import { createPartnerKeySchema, listPartnerKeysQuerySchema } from "./partner-keys.schemas.js";
import { asyncHandler } from "../../shared/middleware/error-handler.js";
import { AppError } from "../../shared/errors/app-error.js";
import { routeParam } from "../../shared/utils/route-param.js";
import { env } from "../../config/env.js";

/**
 * Operator-only partner key administration — mounted at /api/admin/partner-keys
 *
 * Sits outside both identity domains (staff JWT and customer JWT) because
 * issuing credentials to an organization is a platform operation, not
 * something any tenant should be able to perform for itself.
 *
 * Guarded solely by ADMIN_API_SECRET. When that env var is unset the whole
 * router returns 404, so forgetting to configure it fails closed.
 */
export const adminPartnerKeysRouter = Router();

const ADMIN_SECRET_HEADER = "x-admin-secret";

function requireAdminSecret(req: Request, _res: Response, next: NextFunction) {
  const expected = env.ADMIN_API_SECRET;

  // Fail closed: without a configured secret there is nothing to authenticate
  // against, so the surface simply does not exist.
  if (!expected) {
    return next(new AppError(404, "Not found", "NOT_FOUND"));
  }

  const provided = req.headers[ADMIN_SECRET_HEADER];
  if (typeof provided !== "string" || !secretsMatch(provided, expected)) {
    return next(new AppError(401, "Invalid admin secret", "UNAUTHORIZED"));
  }

  next();
}

adminPartnerKeysRouter.use(requireAdminSecret);

adminPartnerKeysRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createPartnerKeySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const created = await partnerKeysService.create({
      businessId: parsed.data.platform ? null : parsed.data.businessId,
      name: parsed.data.name,
      scopes: parsed.data.scopes,
      expiresAt: parsed.data.expiresAt,
    });
    res.status(201).json({
      ...created,
      warning: "Store this key now — it cannot be retrieved again.",
    });
  }),
);

adminPartnerKeysRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = listPartnerKeysQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, "Invalid query parameters", "VALIDATION_ERROR");
    }

    const filter =
      parsed.data.platform === true
        ? null
        : parsed.data.businessId;

    const data = await partnerKeysService.list(filter);
    res.json({ data });
  }),
);

adminPartnerKeysRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const revoked = await partnerKeysService.revoke(routeParam(req.params.id, "id"));
    res.json(revoked);
  }),
);
