import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** Self-serve signup — creates a new business tenant + business_admin user */
export const registerSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  email: z.string().email(),
  phone: z.string().min(5, "Phone number is required").max(40),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type RegisterInput = z.infer<typeof registerSchema>;

/** Google Identity Services ID token from the frontend button */
export const googleAuthSchema = z.object({
  idToken: z.string().min(1),
});

export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;

/** POST /api/auth/invite-manager — admin invites a store_manager for one of their stores */
export const inviteManagerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  storeId: z.string().uuid(),
});

export type InviteManagerInput = z.infer<typeof inviteManagerSchema>;

/** POST /api/auth/check-manager-email — is this email free to invite as a store manager? */
export const checkManagerEmailSchema = z.object({
  email: z.string().email(),
  storeId: z.string().uuid().optional(),
});

export type CheckManagerEmailInput = z.infer<typeof checkManagerEmailSchema>;

/** POST /api/auth/accept-invite — invitee sets their own password */
export const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

/** POST /api/auth/change-password — self-serve password change while logged in */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** PATCH /api/auth/notification-preferences — arbitrary boolean toggle map */
export const notificationPreferencesSchema = z.record(z.boolean());

export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;
