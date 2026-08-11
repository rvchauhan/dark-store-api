import { randomBytes, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "../../db/client.js";
import { businesses, users, inviteTokens } from "../../db/schema/tenant.js";
import { stores } from "../../db/schema/store.js";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { signAccessToken } from "../../shared/auth/jwt.js";
import { verifyGoogleIdToken } from "../../shared/auth/google.js";
import { sendManagerInviteEmail } from "../../shared/email/email.service.js";
import type {
  AcceptInviteInput,
  ChangePasswordInput,
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
    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);

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

    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      throw new AppError(409, "An account with this email already exists", "EMAIL_TAKEN");
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    const businessName = `${input.fullName.trim()}'s Business`;

    const user = await db.transaction(async (tx) => {
      const [business] = await tx.insert(businesses).values({ name: businessName }).returning();

      const [created] = await tx
        .insert(users)
        .values({
          businessId: business.id,
          storeId: null,
          name: input.fullName.trim(),
          email,
          phone: input.phone.trim() || null,
          passwordHash,
          role: "business_admin",
          status: "active",
        })
        .returning();

      return created;
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

    const emailVerified =
      profile.email_verified === true || profile.email_verified === "true";
    if (!emailVerified) {
      throw new AppError(401, "Google email is not verified", "GOOGLE_EMAIL_UNVERIFIED");
    }

    const email = profile.email.trim().toLowerCase();

    // Prefer lookup by googleId, then by email (link existing password account)
    let [user] = await db.select().from(users).where(eq(users.googleId, profile.sub)).limit(1);

    if (!user) {
      [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    }

    if (user) {
      if (user.status !== "active") {
        throw new AppError(401, "Account is disabled", "ACCOUNT_DISABLED");
      }

      // Link Google subject if this was originally a password account
      if (!user.googleId) {
        const [updated] = await db
          .update(users)
          .set({ googleId: profile.sub })
          .where(eq(users.id, user.id))
          .returning();
        user = updated;
      }

      return this.issueSession(user);
    }

    // First-time Google signup
    const displayName = profile.name?.trim() || email.split("@")[0];
    const created = await db.transaction(async (tx) => {
      const [business] = await tx
        .insert(businesses)
        .values({ name: `${displayName}'s Business` })
        .returning();

      const [row] = await tx
        .insert(users)
        .values({
          businessId: business.id,
          storeId: null,
          name: displayName,
          email,
          googleId: profile.sub,
          passwordHash: null,
          role: "business_admin",
          status: "active",
        })
        .returning();

      return row;
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
    const [store] = await db.select().from(stores).where(eq(stores.id, input.storeId)).limit(1);
    if (!store || store.businessId !== auth.businessId) {
      throw new AppError(404, "Store not found", "NOT_FOUND");
    }

    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();

    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    let user: typeof users.$inferSelect;
    if (existing) {
      if (existing.businessId !== auth.businessId) {
        throw new AppError(409, "An account with this email already exists", "EMAIL_TAKEN");
      }
      // Re-invite: reassign to this store and reset to invited (does not touch an active password).
      const [updated] = await db
        .update(users)
        .set({ name, storeId: input.storeId, role: "store_manager", status: "invited" })
        .where(eq(users.id, existing.id))
        .returning();
      user = updated;
    } else {
      const [created] = await db
        .insert(users)
        .values({
          businessId: auth.businessId,
          storeId: input.storeId,
          name,
          email,
          passwordHash: null,
          role: "store_manager",
          status: "invited",
        })
        .returning();
      user = created;
    }

    await db
      .update(stores)
      .set({ managerUserId: user.id, updatedAt: new Date() })
      .where(eq(stores.id, input.storeId));

    const rawToken = randomBytes(32).toString("hex");
    const [invite] = await db
      .insert(inviteTokens)
      .values({
        userId: user.id,
        tokenHash: this.hashToken(rawToken),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      })
      .returning();

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

  /** Public — lets the set-password page greet the invitee before they submit. */
  async getInvite(rawToken: string) {
    const invite = await this.resolveInvite(rawToken);
    const [user] = await db.select().from(users).where(eq(users.id, invite.userId)).limit(1);
    if (!user) {
      throw new AppError(404, "Invite not found", "NOT_FOUND");
    }
    return { email: user.email, name: user.name };
  }

  /** Public — invitee sets their own password; auto-logs them in afterward. */
  async acceptInvite(input: AcceptInviteInput) {
    const invite = await this.resolveInvite(input.token);
    const passwordHash = await bcrypt.hash(input.password, 10);

    const user = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(users)
        .set({ passwordHash, status: "active" })
        .where(eq(users.id, invite.userId))
        .returning();

      await tx.update(inviteTokens).set({ usedAt: new Date() }).where(eq(inviteTokens.id, invite.id));

      return updated;
    });

    return this.issueSession(user);
  }

  /** Self-serve password change for a logged-in user. */
  async changePassword(auth: AuthUser, input: ChangePasswordInput) {
    const [user] = await db.select().from(users).where(eq(users.id, auth.userId)).limit(1);
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
    await db.update(users).set({ passwordHash }).where(eq(users.id, auth.userId));

    return { success: true };
  }

  async getNotificationPreferences(auth: AuthUser) {
    const [user] = await db
      .select({ notificationPreferences: users.notificationPreferences })
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1);
    if (!user) {
      throw new AppError(404, "User not found", "NOT_FOUND");
    }
    return user.notificationPreferences as Record<string, boolean>;
  }

  /** Merges provided toggles into the existing preference map — omitted keys are left untouched. */
  async updateNotificationPreferences(auth: AuthUser, input: NotificationPreferencesInput) {
    const existing = await this.getNotificationPreferences(auth);
    const merged = { ...existing, ...input };

    const [updated] = await db
      .update(users)
      .set({ notificationPreferences: merged })
      .where(eq(users.id, auth.userId))
      .returning({ notificationPreferences: users.notificationPreferences });

    return updated.notificationPreferences as Record<string, boolean>;
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private hashToken(rawToken: string): string {
    return createHash("sha256").update(rawToken).digest("hex");
  }

  private async resolveInvite(rawToken: string) {
    const [invite] = await db
      .select()
      .from(inviteTokens)
      .where(eq(inviteTokens.tokenHash, this.hashToken(rawToken)))
      .limit(1);

    if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
      throw new AppError(400, "This invite link is invalid or has expired", "INVALID_INVITE");
    }

    return invite;
  }

  private issueSession(user: typeof users.$inferSelect) {
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
