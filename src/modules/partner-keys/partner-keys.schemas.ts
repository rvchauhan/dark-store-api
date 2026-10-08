import { z } from "zod";
import { PARTNER_KEY_SCOPES } from "./partner-keys.service.js";

/**
 * Request body for POST /api/admin/partner-keys
 *
 * Provide either businessId (organization key) or platform: true (Shopify app env key).
 */
export const createPartnerKeySchema = z
  .object({
    businessId: z.string().uuid().optional(),
    platform: z.boolean().optional(),
    /** Human label identifying the integration, e.g. "Shopify App" or "Acme ERP". */
    name: z.string().trim().min(1).max(100),
    scopes: z.array(z.enum(PARTNER_KEY_SCOPES)).min(1).default([...PARTNER_KEY_SCOPES]),
    /** Omit for a key that never expires. */
    expiresAt: z.coerce.date().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.platform && value.businessId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pass either platform:true or businessId, not both",
      });
    }
    if (!value.platform && !value.businessId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide businessId for an organization key, or platform:true for a platform key",
      });
    }
  });

export type CreatePartnerKeyBody = z.infer<typeof createPartnerKeySchema>;

/** Query params for GET /api/admin/partner-keys */
export const listPartnerKeysQuerySchema = z.object({
  businessId: z.string().uuid().optional(),
  /** When true, list only platform keys (businessId null). */
  platform: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

export type ListPartnerKeysQuery = z.infer<typeof listPartnerKeysQuerySchema>;
