import { Router } from "express";
import { customerAuthService } from "./customer-auth.service.js";
import { customerGoogleAuthSchema, customerLoginSchema, customerRegisterSchema } from "./customer-auth.schemas.js";
import { asyncHandler } from "../../shared/middleware/error-handler.js";
import { requireCustomerAuth } from "../../shared/middleware/customer-auth.js";
import { AppError } from "../../shared/errors/app-error.js";

/**
 * Customer auth module routes — mounted at /api/customer-auth
 *
 * Independent of the staff `auth` module — separate identity, separate JWT
 * claim shape (see shared/types/customer-auth.ts).
 */
export const customerAuthRouter = Router();

customerAuthRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = customerLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const result = await customerAuthService.login(parsed.data);
    res.json(result);
  }),
);

customerAuthRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const parsed = customerRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const result = await customerAuthService.register(parsed.data);
    res.status(201).json(result);
  }),
);

customerAuthRouter.post(
  "/google",
  asyncHandler(async (req, res) => {
    const parsed = customerGoogleAuthSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const result = await customerAuthService.googleAuth(parsed.data);
    res.json(result);
  }),
);

customerAuthRouter.get(
  "/me",
  requireCustomerAuth,
  asyncHandler(async (req, res) => {
    res.json(customerAuthService.me(req.customerAuth!));
  }),
);
