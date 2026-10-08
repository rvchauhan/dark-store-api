import { z } from "zod";

// Validated at startup — fail fast if required env vars are missing.
const envSchema = z.object({
  DATABASE_URL: z.string().url().or(z.string().startsWith("postgresql://")),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN_SECONDS: z.coerce.number().default(28800),
  PORT: z.coerce.number().default(3001),
  /** Comma-separated list — one entry per frontend dev origin allowed to call this API. */
  CORS_ORIGIN: z
    .string()
    .default("http://localhost:8080")
    .transform((value) => value.split(",").map((origin) => origin.trim())),
  /** Google OAuth Web Client ID — required for POST /api/auth/google */
  GOOGLE_CLIENT_ID: z.string().optional(),
  /** Resend API key — optional; without it, invite emails are skipped and the setup link is copy-only */
  RESEND_API_KEY: z.string().optional(),
  /** Must be a verified sender on the Resend account (or the resend.dev sandbox address in dev) */
  EMAIL_FROM: z.string().default("Q-Commerce <onboarding@resend.dev>"),
  /** Portal origin used to build links inside emails (invite/setup links, etc.) */
  PORTAL_URL: z.string().default("http://localhost:8080"),
  /**
   * Public base URL for this API — used when pushing product image URLs to Shopify.
   * e.g. http://localhost:3001 or your ngrok URL for dark-store-api.
   */
  PUBLIC_API_URL: z.string().url().optional(),
  /**
   * Operator secret guarding /api/admin/partner-keys. Optional — when unset the
   * admin routes are disabled entirely, so a missing value can never mean
   * "open to everyone". Issue keys via `npm run partner-key:create` instead.
   */
  ADMIN_API_SECRET: z.string().min(16).optional(),
});

export const env = envSchema.parse(process.env);
