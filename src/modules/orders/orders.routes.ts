import { Router } from "express";
import { ordersService } from "./orders.service.js";
import { checkoutSchema } from "./orders.schemas.js";
import { asyncHandler } from "../../shared/middleware/error-handler.js";
import { requireCustomerAuth } from "../../shared/middleware/customer-auth.js";
import { AppError } from "../../shared/errors/app-error.js";
import { routeParam } from "../../shared/utils/route-param.js";

/** Orders module routes — mounted at /api/orders */
export const ordersRouter = Router();

ordersRouter.use(requireCustomerAuth);

ordersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const result = await ordersService.checkout(req.customerAuth!.customerId, parsed.data);
    res.status(201).json(result);
  }),
);

ordersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const data = await ordersService.listOrders(req.customerAuth!.customerId);
    res.json({ data });
  }),
);

ordersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const result = await ordersService.getOrder(req.customerAuth!.customerId, routeParam(req.params.id, "id"));
    res.json(result);
  }),
);
