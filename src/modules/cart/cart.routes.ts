import { Router } from "express";
import { cartService } from "./cart.service.js";
import { addCartItemSchema, updateCartItemSchema } from "./cart.schemas.js";
import { asyncHandler } from "../../shared/middleware/error-handler.js";
import { requireCustomerAuth } from "../../shared/middleware/customer-auth.js";
import { AppError } from "../../shared/errors/app-error.js";
import { routeParam } from "../../shared/utils/route-param.js";

/** Cart module routes — mounted at /api/cart */
export const cartRouter = Router();

cartRouter.use(requireCustomerAuth);

cartRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const cart = await cartService.getCart(req.customerAuth!.customerId);
    res.json(cart);
  }),
);

cartRouter.post(
  "/items",
  asyncHandler(async (req, res) => {
    const parsed = addCartItemSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const cart = await cartService.addItem(req.customerAuth!.customerId, parsed.data);
    res.status(201).json(cart);
  }),
);

cartRouter.patch(
  "/items/:skuId",
  asyncHandler(async (req, res) => {
    const parsed = updateCartItemSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const cart = await cartService.updateItemQuantity(
      req.customerAuth!.customerId,
      routeParam(req.params.skuId, "skuId"),
      parsed.data.quantity,
    );
    res.json(cart);
  }),
);

cartRouter.delete(
  "/items/:skuId",
  asyncHandler(async (req, res) => {
    const cart = await cartService.removeItem(req.customerAuth!.customerId, routeParam(req.params.skuId, "skuId"));
    res.json(cart);
  }),
);

cartRouter.delete(
  "/",
  asyncHandler(async (req, res) => {
    const result = await cartService.clearCart(req.customerAuth!.customerId);
    res.json(result);
  }),
);
