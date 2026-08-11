import { Router } from "express";
import { analyticsService } from "./analytics.service.js";
import { asyncHandler } from "../../shared/middleware/error-handler.js";
import { requireAuth } from "../../shared/middleware/auth.js";
import { requireRoles } from "../../shared/middleware/rbac.js";

/**
 * Analytics module routes — mounted at /api/analytics
 *
 *   GET /analytics/overview — business-wide revenue/units trend, top/slow SKUs,
 *   order status breakdown, avg fulfillment time. Admin-only.
 */
export const analyticsRouter = Router();

analyticsRouter.use(requireAuth);

analyticsRouter.get(
  "/overview",
  requireRoles("business_admin"),
  asyncHandler(async (req, res) => {
    const overview = await analyticsService.getOverview(req.auth!);
    res.json(overview);
  }),
);
