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
});

export const env = envSchema.parse(process.env);
