import { Router } from "express";
import { partnerProvisionService } from "./partner.service.js";
import { provisionSchema, sessionSchema } from "./partner.schemas.js";
import { shopifyOrderIngestSchema } from "./shopify-order-ingest.schemas.js";
import { shopifyOrderIngestService } from "./shopify-order-ingest.service.js";
import { asyncHandler } from "../../shared/middleware/error-handler.js";
import { requirePlatformKey } from "../../shared/middleware/auth.js";
import { AppError } from "../../shared/errors/app-error.js";

/**
 * Partner Open API routes — mounted at /api/partner
 *
 * Authenticated only with a *platform* partner key (CLI: --platform).
 * Used by the Shopify app backend (never from the browser) to:
 *   - provision a merchant on first install
 *   - issue a session JWT on every app open
 *   - soft-uninstall
 *   - ingest Shopify Online Store orders into dark-store
 */
export const partnerRouter = Router();

partnerRouter.use(requirePlatformKey);

/**
 * POST /api/partner/provision
 *
 * First install (or reinstall). Idempotent on (provider, externalId).
 * Optionally creates the first dark store when `store` is provided.
 */
partnerRouter.post(
  "/provision",
  asyncHandler(async (req, res) => {
    const parsed = provisionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const result = await partnerProvisionService.provision(parsed.data);
    res.status(result.created ? 201 : 200).json(result);
  }),
);

/**
 * POST /api/partner/session
 *
 * App-open login. Looks up the Shopify shop and returns a fresh staff JWT.
 * Returns 404 INSTALLATION_NOT_FOUND if provision was never called.
 */
partnerRouter.post(
  "/session",
  asyncHandler(async (req, res) => {
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const result = await partnerProvisionService.session(parsed.data);
    res.json(result);
  }),
);

/**
 * POST /api/partner/uninstall
 *
 * Soft-marks the external installation as uninstalled. Does not delete the
 * Business or admin — they can still log into the portal.
 */
partnerRouter.post(
  "/uninstall",
  asyncHandler(async (req, res) => {
    const provider = typeof req.body?.provider === "string" ? req.body.provider : "shopify";
    const externalId = typeof req.body?.externalId === "string" ? req.body.externalId : "";

    if (!externalId.trim()) {
      throw new AppError(400, "externalId is required", "VALIDATION_ERROR");
    }

    const installation = await partnerProvisionService.uninstall(provider, externalId);
    res.json({
      id: installation.id,
      provider: installation.provider,
      externalId: installation.externalId,
      uninstalledAt: installation.uninstalledAt,
    });
  }),
);

/**
 * POST /api/partner/shopify/orders
 *
 * Ingest a Shopify orders/create webhook payload into dark-store so Online Store
 * (and other channel) orders appear for managers/admins. Idempotent + skips
 * dark-store→Shopify echo orders tagged quick-commerce.
 */
partnerRouter.post(
  "/shopify/orders",
  asyncHandler(async (req, res) => {
    const parsed = shopifyOrderIngestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const result = await shopifyOrderIngestService.ingest(parsed.data);
    res.status(result.skipped ? 200 : result.created ? 201 : 200).json(result);
  }),
);
