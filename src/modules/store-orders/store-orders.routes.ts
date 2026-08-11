import { Router } from "express";
import { storeOrdersService } from "./store-orders.service.js";
import { listOrdersQuerySchema, updateOrderStatusSchema } from "./store-orders.schemas.js";
import { asyncHandler } from "../../shared/middleware/error-handler.js";
import { requireAuth } from "../../shared/middleware/auth.js";
import { requireStoreAccess } from "../../shared/middleware/rbac.js";
import { AppError } from "../../shared/errors/app-error.js";
import { routeParam } from "../../shared/utils/route-param.js";

/**
 * Staff-facing order routes — mounted at /api/stores/:storeId/orders
 *
 * Reads/progresses the same `orders`/`order_items` tables the customer app
 * writes to (src/modules/orders). Kept as its own module because the auth
 * (staff requireAuth + requireStoreAccess) is entirely different from the
 * customer-facing requireCustomerAuth used there.
 *
 * Static path (/stats) registered before /:orderId.
 */
export const storeOrdersRouter = Router({ mergeParams: true });

storeOrdersRouter.use(requireAuth);
storeOrdersRouter.use(requireStoreAccess("storeId"));

storeOrdersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = listOrdersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid query", "VALIDATION_ERROR");
    }

    const storeId = routeParam(req.params.storeId, "storeId");
    const data = await storeOrdersService.listOrders(req.auth!, storeId, parsed.data);
    res.json({ data });
  }),
);

storeOrdersRouter.get(
  "/stats",
  asyncHandler(async (req, res) => {
    const storeId = routeParam(req.params.storeId, "storeId");
    const stats = await storeOrdersService.getStats(req.auth!, storeId);
    res.json(stats);
  }),
);

storeOrdersRouter.get(
  "/:orderId",
  asyncHandler(async (req, res) => {
    const storeId = routeParam(req.params.storeId, "storeId");
    const orderId = routeParam(req.params.orderId, "orderId");
    const result = await storeOrdersService.getOrder(req.auth!, storeId, orderId);
    res.json(result);
  }),
);

storeOrdersRouter.patch(
  "/:orderId/status",
  asyncHandler(async (req, res) => {
    const parsed = updateOrderStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const storeId = routeParam(req.params.storeId, "storeId");
    const orderId = routeParam(req.params.orderId, "orderId");
    const updated = await storeOrdersService.updateStatus(req.auth!, storeId, orderId, parsed.data);
    res.json(updated);
  }),
);
