import { Router } from "express";
import { geoService } from "./geo.service.js";
import { asyncHandler } from "../../shared/middleware/error-handler.js";
import { requireAuth } from "../../shared/middleware/auth.js";
import { AppError } from "../../shared/errors/app-error.js";

/**
 * Geo module routes — mounted at /api/geo
 *
 *   GET /geo/lookup?address=... — forward geocoding for the dark-store wizard's map
 */
export const geoRouter = Router();

geoRouter.use(requireAuth);

geoRouter.get(
  "/lookup",
  asyncHandler(async (req, res) => {
    const street = typeof req.query.street === "string" ? req.query.street.trim() : undefined;
    const city = typeof req.query.city === "string" ? req.query.city.trim() : undefined;
    const postalCode = typeof req.query.postalCode === "string" ? req.query.postalCode.trim() : undefined;
    const country = typeof req.query.country === "string" ? req.query.country.trim() : undefined;

    if (!street && !city && !postalCode && !country) {
      throw new AppError(400, "At least one of street, city, postalCode, or country is required", "VALIDATION_ERROR");
    }

    const result = await geoService.lookupAddress({ street, city, postalCode, country });
    res.json(result);
  }),
);
