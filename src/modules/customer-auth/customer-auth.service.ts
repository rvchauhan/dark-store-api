import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "../../db/client.js";
import { customers } from "../../db/schema/customer.js";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { signAccessToken } from "../../shared/auth/jwt.js";
import { verifyGoogleIdToken } from "../../shared/auth/google.js";
import type { CustomerGoogleAuthInput, CustomerLoginInput, CustomerRegisterInput } from "./customer-auth.schemas.js";
import type { CustomerAuthUser } from "../../shared/types/customer-auth.js";

/**
 * Customer auth module service — login, self-serve registration, Google sign-in.
 *
 * Customers are not tenant-scoped (no business_id/store_id) — they browse and
 * order across any active store. Kept fully separate from AuthService/`users`.
 */
export class CustomerAuthService {
  async login(input: CustomerLoginInput) {
    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.email, input.email.trim().toLowerCase()))
      .limit(1);

    if (!customer || customer.status !== "active") {
      throw new AppError(401, "Invalid email or password", "INVALID_CREDENTIALS");
    }

    if (!customer.passwordHash) {
      throw new AppError(
        401,
        "This account uses Google sign-in. Continue with Google instead.",
        "GOOGLE_ONLY_ACCOUNT",
      );
    }

    const valid = await bcrypt.compare(input.password, customer.passwordHash);
    if (!valid) {
      throw new AppError(401, "Invalid email or password", "INVALID_CREDENTIALS");
    }

    return this.issueSession(customer);
  }

  async register(input: CustomerRegisterInput) {
    const email = input.email.trim().toLowerCase();

    const [existing] = await db.select().from(customers).where(eq(customers.email, email)).limit(1);
    if (existing) {
      throw new AppError(409, "An account with this email already exists", "EMAIL_TAKEN");
    }

    const passwordHash = await bcrypt.hash(input.password, 10);

    const [created] = await db
      .insert(customers)
      .values({
        name: input.name.trim(),
        email,
        phone: input.phone?.trim() || null,
        passwordHash,
        status: "active",
      })
      .returning();

    return this.issueSession(created);
  }

  async googleAuth(input: CustomerGoogleAuthInput) {
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

    let [customer] = await db.select().from(customers).where(eq(customers.googleId, profile.sub)).limit(1);
    if (!customer) {
      [customer] = await db.select().from(customers).where(eq(customers.email, email)).limit(1);
    }

    if (customer) {
      if (customer.status !== "active") {
        throw new AppError(401, "Account is disabled", "ACCOUNT_DISABLED");
      }

      if (!customer.googleId) {
        const [updated] = await db
          .update(customers)
          .set({ googleId: profile.sub })
          .where(eq(customers.id, customer.id))
          .returning();
        customer = updated;
      }

      return this.issueSession(customer);
    }

    const displayName = profile.name?.trim() || email.split("@")[0];
    const [created] = await db
      .insert(customers)
      .values({
        name: displayName,
        email,
        googleId: profile.sub,
        passwordHash: null,
        status: "active",
      })
      .returning();

    return this.issueSession(created);
  }

  /** Returns the current customer profile from JWT claims (no DB round-trip). */
  me(auth: CustomerAuthUser) {
    return { customer: auth };
  }

  private issueSession(customer: typeof customers.$inferSelect) {
    const authUser: CustomerAuthUser = {
      customerId: customer.id,
      email: customer.email,
      name: customer.name,
    };

    const token = signAccessToken(
      {
        sub: authUser.customerId,
        type: "customer",
        email: authUser.email,
        name: authUser.name,
      },
      env.JWT_SECRET,
      env.JWT_EXPIRES_IN_SECONDS,
    );

    return { token, customer: authUser };
  }
}

export const customerAuthService = new CustomerAuthService();
