import { Router } from "express";
import { authService } from "./auth.service.js";
import {
  acceptInviteSchema,
  changePasswordSchema,
  checkManagerEmailSchema,
  googleAuthSchema,
  inviteManagerSchema,
  loginSchema,
  notificationPreferencesSchema,
  registerSchema,
} from "./auth.schemas.js";
import { asyncHandler } from "../../shared/middleware/error-handler.js";
import { requireAuth } from "../../shared/middleware/auth.js";
import { requireRoles } from "../../shared/middleware/rbac.js";
import { AppError } from "../../shared/errors/app-error.js";
import { routeParam } from "../../shared/utils/route-param.js";

/**
 * Auth module routes — mounted at /api/auth
 *
 * This module has no dependency on catalog/store/inventory modules.
 */
export const authRouter = Router();

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const result = await authService.login(parsed.data);
    res.json(result);
  }),
);

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const result = await authService.register(parsed.data);
    res.status(201).json(result);
  }),
);

authRouter.post(
  "/google",
  asyncHandler(async (req, res) => {
    const parsed = googleAuthSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const result = await authService.googleAuth(parsed.data);
    res.json(result);
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(authService.me(req.auth!));
  }),
);

authRouter.post(
  "/invite-manager",
  requireAuth,
  requireRoles("business_admin"),
  asyncHandler(async (req, res) => {
    const parsed = inviteManagerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const result = await authService.inviteManager(req.auth!, parsed.data);
    res.status(201).json(result);
  }),
);

authRouter.post(
  "/check-manager-email",
  requireAuth,
  requireRoles("business_admin"),
  asyncHandler(async (req, res) => {
    const parsed = checkManagerEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const result = await authService.checkManagerEmail(req.auth!, parsed.data);
    res.json(result);
  }),
);

authRouter.get(
  "/invite/:token",
  asyncHandler(async (req, res) => {
    const result = await authService.getInvite(routeParam(req.params.token, "token"));
    res.json(result);
  }),
);

authRouter.post(
  "/accept-invite",
  asyncHandler(async (req, res) => {
    const parsed = acceptInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const result = await authService.acceptInvite(parsed.data);
    res.json(result);
  }),
);

authRouter.post(
  "/change-password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const result = await authService.changePassword(req.auth!, parsed.data);
    res.json(result);
  }),
);

authRouter.get(
  "/notification-preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    const preferences = await authService.getNotificationPreferences(req.auth!);
    res.json({ preferences });
  }),
);

authRouter.patch(
  "/notification-preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = notificationPreferencesSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const preferences = await authService.updateNotificationPreferences(req.auth!, parsed.data);
    res.json({ preferences });
  }),
);
