import { z } from "zod";

// Canonical form for a store code, regardless of how it entered the system (wizard
// keystroke transform, direct API call, seed data) — one casing everywhere it's shown.
const storeCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => v.replace(/[^A-Z0-9-]/g, ""))
  .optional();

/** Request body for POST /api/stores (HLD Step 2 — store onboarding) */
export const createStoreSchema = z.object({
  name: z.string().min(1),
  code: storeCodeSchema,
  address: z.string().min(1),
  geofence: z.record(z.unknown()),
  operatingHours: z.record(z.unknown()),
  facility: z.record(z.unknown()).optional(),
  managerEmail: z.string().email().optional(),
  managerName: z.string().optional(),
});

export type CreateStoreInput = z.infer<typeof createStoreSchema>;

/** Request body for PATCH /api/stores/:id — all fields optional, only provided ones change. */
export const updateStoreSchema = z.object({
  name: z.string().min(1).optional(),
  code: storeCodeSchema,
  address: z.string().min(1).optional(),
  geofence: z.record(z.unknown()).optional(),
  operatingHours: z.record(z.unknown()).optional(),
  facility: z.record(z.unknown()).optional(),
  managerEmail: z.string().email().optional(),
  managerName: z.string().optional(),
});

export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;

// ---------------------------------------------------------------------------
// HLD Step 3 — Store ↔ SKU assignment (makes a SKU sellable at a store)
// ---------------------------------------------------------------------------

/**
 * One mapping row. Provide either skuId OR barcode (barcode is resolved
 * against master_catalog within the caller's business_id).
 *
 * Maps to UI fields on Inventory Mapping step:
 *   - Enable for Store → isListed
 *   - Price (£)        → priceOverride (null = use catalog base_price)
 *   - Stock / threshold → reorderThreshold (used later by low-stock alerts)
 */
export const skuMappingItemSchema = z
  .object({
    skuId: z.string().uuid().optional(),
    barcode: z.string().min(1).optional(),
    // null / omitted = fall back to master_catalog.base_price
    priceOverride: z.coerce.number().nonnegative().nullable().optional(),
    isListed: z.boolean().default(false),
    reorderThreshold: z.coerce.number().int().nonnegative().default(10),
  })
  .refine((v) => Boolean(v.skuId || v.barcode), {
    message: "Either skuId or barcode is required",
  });

export type SkuMappingItemInput = z.infer<typeof skuMappingItemSchema>;

/** POST /api/stores/:id/sku-mappings — assign a single SKU */
export const createSkuMappingSchema = skuMappingItemSchema;

export type CreateSkuMappingInput = SkuMappingItemInput;

/** PATCH /api/stores/:id/sku-mappings/:skuId — update listing/price/threshold */
export const updateSkuMappingSchema = z.object({
  priceOverride: z.coerce.number().nonnegative().nullable().optional(),
  isListed: z.boolean().optional(),
  reorderThreshold: z.coerce.number().int().nonnegative().optional(),
});

export type UpdateSkuMappingInput = z.infer<typeof updateSkuMappingSchema>;

/**
 * POST /api/stores/:id/sku-mappings/bulk
 *
 * Accepts either:
 *   { "mappings": [ { skuId|barcode, ... }, ... ] }
 * or
 *   { "csv": "sku_id,barcode,price_override,is_listed,reorder_threshold\\n..." }
 *
 * CSV is what the "Import Batch" card on the Inventory Mapping UI uploads.
 */
export const bulkSkuMappingSchema = z
  .object({
    mappings: z.array(skuMappingItemSchema).optional(),
    csv: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.mappings?.length || v.csv), {
    message: "Provide mappings[] or a csv string",
  });

export type BulkSkuMappingInput = z.infer<typeof bulkSkuMappingSchema>;

/**
 * Parses a simple CSV string into mapping items.
 *
 * Expected header (order-independent, case-insensitive):
 *   sku_id, barcode, price_override, is_listed, reorder_threshold
 *
 * At least one of sku_id / barcode must be present per row.
 * Blank lines and a trailing newline are ignored.
 */
export function parseSkuMappingCsv(csv: string): SkuMappingItemInput[] {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error("CSV must include a header row and at least one data row");
  }

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = {
    skuId: header.indexOf("sku_id"),
    barcode: header.indexOf("barcode"),
    priceOverride: header.indexOf("price_override"),
    isListed: header.indexOf("is_listed"),
    reorderThreshold: header.indexOf("reorder_threshold"),
  };

  if (idx.skuId < 0 && idx.barcode < 0) {
    throw new Error("CSV header must include sku_id and/or barcode");
  }

  const rows: SkuMappingItemInput[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const get = (colIdx: number) => (colIdx >= 0 ? (cols[colIdx] ?? "").trim() : "");

    const skuId = get(idx.skuId) || undefined;
    const barcode = get(idx.barcode) || undefined;
    const priceRaw = get(idx.priceOverride);
    const listedRaw = get(idx.isListed).toLowerCase();
    const thresholdRaw = get(idx.reorderThreshold);

    const parsed = skuMappingItemSchema.safeParse({
      skuId,
      barcode,
      priceOverride: priceRaw === "" ? null : priceRaw,
      isListed: listedRaw === "" ? false : listedRaw === "true" || listedRaw === "1" || listedRaw === "yes",
      reorderThreshold: thresholdRaw === "" ? 10 : thresholdRaw,
    });

    if (!parsed.success) {
      throw new Error(`CSV row ${i + 1}: ${parsed.error.errors[0]?.message ?? "invalid"}`);
    }

    rows.push(parsed.data);
  }

  return rows;
}

/** Minimal CSV cell splitter — handles quoted fields with commas. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // Escaped quote ""
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}
