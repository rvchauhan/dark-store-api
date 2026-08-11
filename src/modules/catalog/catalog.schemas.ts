import { z } from "zod";

// numeric(10,2) caps out at 8 integer digits — validate here so a too-large value
// fails with a clear message instead of a raw Postgres overflow error.
const MONEY_MAX = 99_999_999.99;
// weightKg/dimensionsCm have no real ceiling from the DB column itself (numeric(10,3)
// would allow up to ~9,999,999.999) — these are sane real-world limits for a single
// retail SKU instead (heaviest realistic single item ~1000kg, largest ~1000cm/10m).
const WEIGHT_MAX = 1_000;
const DIMENSION_MAX = 1_000;
const QTY_MAX = 1_000_000;

/** e.g. { name: "Size", values: ["S", "M", "L"] }. */
const variantOptionSchema = z.object({
  name: z.string().trim().min(1).max(40),
  values: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
});

/**
 * Keys that shadow a structured column — blocked so a spec can't silently
 * disagree with the real field (e.g. a "Weight" spec vs. weightKg).
 */
const RESERVED_SPEC_KEYS = new Set([
  "name",
  "brand",
  "category",
  "barcode",
  "price",
  "baseprice",
  "compareatprice",
  "costprice",
  "taxrate",
  "currency",
  "unitofmeasure",
  "skucode",
  "weight",
  "weightkg",
  "dimensions",
  "dimensionscm",
  "description",
  "status",
  "images",
]);

/** Free-form product spec sheet: [{ key: "Processor", value: "Intel i8" }, ...]. */
const specSchema = z.object({
  key: z.string().trim().min(1).max(40),
  value: z.string().trim().min(1).max(200),
});

const specsArraySchema = z
  .array(specSchema)
  .max(30)
  .superRefine((specs, ctx) => {
    const seen = new Set<string>();
    specs.forEach((spec, index) => {
      const normalized = spec.key.toLowerCase();
      if (RESERVED_SPEC_KEYS.has(normalized.replace(/[\s_-]/g, ""))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "key"],
          message: `"${spec.key}" duplicates a built-in product field — use a different label`,
        });
      }
      if (seen.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "key"],
          message: `Duplicate spec key "${spec.key}"`,
        });
      }
      seen.add(normalized);
    });
  });

/**
 * One row of the generated variant matrix. `options` keys must match a
 * variantOptions[].name; price/barcode/stock override the parent SKU's
 * when set, otherwise the parent's values apply. Lightweight by design —
 * variants ride along with the parent SKU rather than becoming independent
 * store-mappable rows (see catalog.service.ts module doc).
 */
const skuVariantSchema = z.object({
  id: z.string().min(1).max(64),
  options: z.record(z.string()),
  price: z.coerce.number().nonnegative().max(MONEY_MAX).optional(),
  barcode: z
    .string()
    .regex(/^\d{8,14}$/, "Barcode must be 8-14 digits")
    .optional(),
  stock: z.coerce.number().int().nonnegative().max(QTY_MAX).optional(),
});

/** Request body for POST /api/catalog/skus (HLD Step 1) */
export const createSkuSchema = z.object({
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(60).optional(),
  category: z.string().trim().max(60).optional(),
  barcode: z
    .string()
    .regex(/^\d{8,14}$/, "Barcode must be 8-14 digits")
    .optional(),
  basePrice: z.coerce.number().nonnegative().max(MONEY_MAX),
  currency: z.string().trim().toUpperCase().length(3).default("USD"),
  compareAtPrice: z.coerce.number().nonnegative().max(MONEY_MAX).optional(),
  costPrice: z.coerce.number().nonnegative().max(MONEY_MAX).optional(),
  taxRate: z.coerce.number().min(0).max(100).default(0),
  allowBackorder: z.boolean().default(false),
  unitOfMeasure: z.string().min(1).default("each"),
  skuCode: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[A-Za-z0-9][A-Za-z0-9-_]*$/, "SKU code must be alphanumeric with - or _")
    .optional(),
  isFragile: z.boolean().default(false),
  requiresColdStorage: z.boolean().default(false),
  weightKg: z.coerce.number().nonnegative().max(WEIGHT_MAX).optional(),
  dimensionsCm: z
    .object({
      length: z.coerce.number().nonnegative().max(DIMENSION_MAX),
      width: z.coerce.number().nonnegative().max(DIMENSION_MAX),
      height: z.coerce.number().nonnegative().max(DIMENSION_MAX),
    })
    .optional(),
  defaultReorderPoint: z.coerce.number().int().nonnegative().max(QTY_MAX).default(10),
  defaultInitialStock: z.coerce.number().int().nonnegative().max(QTY_MAX).optional(),
  // Options themselves are capped generously (20) just to bound payload size — the
  // meaningful ceiling is on the generated matrix below, enforced client-side too.
  variantOptions: z.array(variantOptionSchema).max(20).default([]),
  variants: z.array(skuVariantSchema).max(200).default([]),
  images: z.array(z.string().url()).default([]),
  description: z.string().trim().max(5000).optional(),
  specs: specsArraySchema.default([]),
  // "Save as Draft" vs "Save & Add to Catalog"
  status: z.enum(["draft", "active"]).default("draft"),
});

export type CreateSkuInput = z.infer<typeof createSkuSchema>;

/** Request body for PATCH /api/catalog/skus/:id — all fields optional, only provided ones change. */
export const updateSkuSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  brand: z.string().trim().max(60).optional(),
  category: z.string().trim().max(60).optional(),
  barcode: z
    .string()
    .regex(/^\d{8,14}$/, "Barcode must be 8-14 digits")
    .optional(),
  basePrice: z.coerce.number().nonnegative().max(MONEY_MAX).optional(),
  currency: z.string().trim().toUpperCase().length(3).optional(),
  compareAtPrice: z.coerce.number().nonnegative().max(MONEY_MAX).optional(),
  costPrice: z.coerce.number().nonnegative().max(MONEY_MAX).optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  allowBackorder: z.boolean().optional(),
  unitOfMeasure: z.string().min(1).optional(),
  skuCode: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[A-Za-z0-9][A-Za-z0-9-_]*$/, "SKU code must be alphanumeric with - or _")
    .optional(),
  isFragile: z.boolean().optional(),
  requiresColdStorage: z.boolean().optional(),
  weightKg: z.coerce.number().nonnegative().max(WEIGHT_MAX).optional(),
  dimensionsCm: z
    .object({
      length: z.coerce.number().nonnegative().max(DIMENSION_MAX),
      width: z.coerce.number().nonnegative().max(DIMENSION_MAX),
      height: z.coerce.number().nonnegative().max(DIMENSION_MAX),
    })
    .optional(),
  defaultReorderPoint: z.coerce.number().int().nonnegative().max(QTY_MAX).optional(),
  defaultInitialStock: z.coerce.number().int().nonnegative().max(QTY_MAX).optional(),
  variantOptions: z.array(variantOptionSchema).max(20).optional(),
  variants: z.array(skuVariantSchema).max(200).optional(),
  images: z.array(z.string().url()).optional(),
  description: z.string().trim().max(5000).optional(),
  specs: specsArraySchema.optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
});

export type UpdateSkuInput = z.infer<typeof updateSkuSchema>;

export const listSkusQuerySchema = z.object({
  status: z.enum(["draft", "active", "archived", "unassigned"]).optional(),
  search: z.string().optional(),
});

export type ListSkusQuery = z.infer<typeof listSkusQuerySchema>;

/** Request body for POST /api/catalog/uploads — base64 image payload */
export const uploadImageSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  /** Base64-encoded file content (no data: prefix) */
  data: z.string().min(1),
});

export type UploadImageInput = z.infer<typeof uploadImageSchema>;
