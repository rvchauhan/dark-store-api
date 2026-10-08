import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { signAccessToken } from "../../shared/auth/jwt.js";
import { verifyGoogleIdToken } from "../../shared/auth/google.js";
import { sendManagerInviteEmail } from "../../shared/email/email.service.js";
import { requireUserId } from "../../shared/middleware/auth.js";
import type {
  AcceptInviteInput,
  ChangePasswordInput,
  CheckManagerEmailInput,
  GoogleAuthInput,
  InviteManagerInput,
  LoginInput,
  NotificationPreferencesInput,
  RegisterInput,
} from "./auth.schemas.js";
import type { AuthUser } from "../../shared/types/auth.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Auth module service — owns login, registration, and Google sign-in.
 *
 * Future split: this becomes the `auth-service` with its own users table
 * or a read-only replica of user credentials.
 */
export class AuthService {
  async login(input: LoginInput) {
    const user = await prisma.user.findUnique({ where: { email: input.email } });

    if (!user || user.status !== "active") {
      throw new AppError(401, "Invalid email or password", "INVALID_CREDENTIALS");
    }

    if (!user.passwordHash) {
      throw new AppError(
        401,
        "This account uses Google sign-in. Continue with Google instead.",
        "GOOGLE_ONLY_ACCOUNT",
      );
    }

    const valid = await bcrypt.compare(input.password, user.passwordHash);
    if (!valid) {
      throw new AppError(401, "Invalid email or password", "INVALID_CREDENTIALS");
    }

    return this.issueSession(user);
  }

  /**
   * Self-serve registration:
   *   1. Create a new business tenant named after the user
   *   2. Create an active business_admin for that tenant
   *   3. Return JWT (auto-login)
   */
  async register(input: RegisterInput) {
    const email = input.email.trim().toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppError(409, "An account with this email already exists", "EMAIL_TAKEN");
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    const businessName = `${input.fullName.trim()}'s Business`;

    const user = await prisma.$transaction(async (tx) => {
      const business = await tx.business.create({ data: { name: businessName } });

      return tx.user.create({
        data: {
          businessId: business.id,
          storeId: null,
          name: input.fullName.trim(),
          email,
          phone: input.phone.trim() || null,
          passwordHash,
          role: "business_admin",
          status: "active",
        },
      });
    });

    return this.issueSession(user);
  }

  /**
   * Google Identity Services — verify ID token, then login-or-register.
   * New Google users get their own business tenant (same as email register).
   */
  async googleAuth(input: GoogleAuthInput) {
    if (!env.GOOGLE_CLIENT_ID) {
      throw new AppError(
        503,
        "Google sign-in is not configured. Set GOOGLE_CLIENT_ID on the API.",
        "GOOGLE_NOT_CONFIGURED",
      );
    }

    const profile = await verifyGoogleIdToken(input.idToken);
    if (profile.aud !== env.GOOGLE_CLIENT_ID) {
      throw new AppError(401, "Invalid Google token audience", "INVALID_GOOGLE_TOKEN");
    }

    const emailVerified = profile.email_verified === true || profile.email_verified === "true";
    if (!emailVerified) {
      throw new AppError(401, "Google email is not verified", "GOOGLE_EMAIL_UNVERIFIED");
    }

    const email = profile.email.trim().toLowerCase();

    // Prefer lookup by googleId, then by email (link existing password account)
    let user = await prisma.user.findUnique({ where: { googleId: profile.sub } });
    if (!user) {
      user = await prisma.user.findUnique({ where: { email } });
    }

    if (user) {
      if (user.status !== "active") {
        throw new AppError(401, "Account is disabled", "ACCOUNT_DISABLED");
      }

      // Link Google subject if this was originally a password account
      if (!user.googleId) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { googleId: profile.sub },
        });
      }

      return this.issueSession(user);
    }

    // First-time Google signup
    const displayName = profile.name?.trim() || email.split("@")[0];
    const created = await prisma.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: { name: `${displayName}'s Business` },
      });

      return tx.user.create({
        data: {
          businessId: business.id,
          storeId: null,
          name: displayName,
          email,
          googleId: profile.sub,
          passwordHash: null,
          role: "business_admin",
          status: "active",
        },
      });
    });

    return this.issueSession(created);
  }

  /** Returns the current user profile from JWT claims (no DB round-trip). */
  me(auth: AuthUser) {
    return { user: auth };
  }

  /**
   * Invite a store_manager for one of the admin's own stores.
   *
   * Creates (or re-invites) the user with status='invited' and no password,
   * plus a one-time setup token. The raw token is returned ONCE here — only
   * its sha256 hash is persisted — so the caller must surface it immediately
   * (the wizard shows it as a copyable setup link).
   */
  async inviteManager(auth: AuthUser, input: InviteManagerInput) {
    const store = await prisma.store.findUnique({ where: { id: input.storeId } });
    if (!store || store.businessId !== auth.businessId) {
      throw new AppError(404, "Store not found", "NOT_FOUND");
    }

    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();

    const existing = await prisma.user.findUnique({ where: { email } });

    let user: User;
    if (existing) {
      if (!this.canReinvite(existing, auth, input.storeId)) {
        throw new AppError(409, "This email is already registered", "EMAIL_TAKEN");
      }
      // Re-invite the same store's pending manager: refresh name and issue a new token.
      user = await prisma.user.update({
        where: { id: existing.id },
        data: { name, storeId: input.storeId, role: "store_manager", status: "invited" },
      });
    } else {
      user = await prisma.user.create({
        data: {
          businessId: auth.businessId,
          storeId: input.storeId,
          name,
          email,
          passwordHash: null,
          role: "store_manager",
          status: "invited",
        },
      });
    }

    await prisma.store.update({
      where: { id: input.storeId },
      data: { managerUserId: user.id },
    });

    const rawToken = randomBytes(32).toString("hex");
    const invite = await prisma.inviteToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(rawToken),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });

    const inviteLink = `${env.PORTAL_URL}/set-password?token=${rawToken}`;
    const emailSent = await sendManagerInviteEmail({ to: user.email, name: user.name, inviteLink });

    return {
      user: { id: user.id, email: user.email, name: user.name },
      inviteToken: rawToken,
      inviteLink,
      expiresAt: invite.expiresAt,
      emailSent,
    };
  }

  /** Lets the wizard reject an already-registered manager email before creating the store. */
  async checkManagerEmail(auth: AuthUser, input: CheckManagerEmailInput) {
    const email = input.email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    const available =
      !existing || (input.storeId ? this.canReinvite(existing, auth, input.storeId) : false);
    return { available };
  }

  /** Public — lets the set-password page greet the invitee before they submit. */
  async getInvite(rawToken: string) {
    const invite = await this.resolveInvite(rawToken);
    const user = await prisma.user.findUnique({ where: { id: invite.userId } });
    if (!user) {
      throw new AppError(404, "Invite not found", "NOT_FOUND");
    }
    return { email: user.email, name: user.name };
  }

  /** Public — invitee sets their own password; auto-logs them in afterward. */
  async acceptInvite(input: AcceptInviteInput) {
    const invite = await this.resolveInvite(input.token);
    const passwordHash = await bcrypt.hash(input.password, 10);

    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: invite.userId },
        data: { passwordHash, status: "active" },
      });

      await tx.inviteToken.update({
        where: { id: invite.id },
        data: { usedAt: new Date() },
      });

      return updated;
    });

    return this.issueSession(user);
  }

  /** Self-serve password change for a logged-in user. */
  async changePassword(auth: AuthUser, input: ChangePasswordInput) {
    const userId = requireUserId(auth);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError(404, "User not found", "NOT_FOUND");
    }

    if (!user.passwordHash) {
      throw new AppError(
        400,
        "This account uses Google sign-in and has no password to change.",
        "GOOGLE_ONLY_ACCOUNT",
      );
    }

    const valid = await bcrypt.compare(input.currentPassword, user.passwordHash);
    if (!valid) {
      throw new AppError(401, "Current password is incorrect", "INVALID_CREDENTIALS");
    }

    const passwordHash = await bcrypt.hash(input.newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    return { success: true };
  }

  async getNotificationPreferences(auth: AuthUser) {
    const user = await prisma.user.findUnique({
      where: { id: requireUserId(auth) },
      select: { notificationPreferences: true },
    });
    if (!user) {
      throw new AppError(404, "User not found", "NOT_FOUND");
    }
    return user.notificationPreferences as Record<string, boolean>;
  }

  /** Merges provided toggles into the existing preference map — omitted keys are left untouched. */
  async updateNotificationPreferences(auth: AuthUser, input: NotificationPreferencesInput) {
    const existing = await this.getNotificationPreferences(auth);
    const merged = { ...existing, ...input };

    const updated = await prisma.user.update({
      where: { id: requireUserId(auth) },
      data: { notificationPreferences: merged },
      select: { notificationPreferences: true },
    });

    return updated.notificationPreferences as Record<string, boolean>;
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /** Only a still-pending manager of this same store may be re-invited; any other existing account is taken. */
  private canReinvite(existing: User, auth: AuthUser, storeId: string): boolean {
    return (
      existing.businessId === auth.businessId &&
      existing.role === "store_manager" &&
      existing.status === "invited" &&
      existing.storeId === storeId
    );
  }

  private hashToken(rawToken: string): string {
    return createHash("sha256").update(rawToken).digest("hex");
  }

  private async resolveInvite(rawToken: string) {
    const invite = await prisma.inviteToken.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
    });

    if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
      throw new AppError(400, "This invite link is invalid or has expired", "INVALID_INVITE");
    }

    return invite;
  }

  /** Issues a staff JWT for an existing user — used by login and partner provision. */
  issueSessionForUser(user: User) {
    return this.issueSession(user);
  }

  private issueSession(user: User) {
    const authUser: AuthUser = {
      userId: user.id,
      businessId: user.businessId,
      role: user.role,
      storeId: user.storeId,
      email: user.email,
      name: user.name,
    };

    const token = signAccessToken(
      {
        sub: authUser.userId,
        type: "staff",
        business_id: authUser.businessId,
        role: authUser.role,
        store_id: authUser.storeId,
        email: authUser.email,
        name: authUser.name,
      },
      env.JWT_SECRET,
      env.JWT_EXPIRES_IN_SECONDS,
    );

    return { token, user: authUser };
  }
}

export const authService = new AuthService();
