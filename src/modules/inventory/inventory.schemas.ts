import { z } from "zod";

/** Request body for POST /api/stores/:id/inventory/stock-in (HLD Step 4) */
export const stockInSchema = z.object({
  skuId: z.string().uuid(),
  quantity: z.coerce.number().int().positive(),
  source: z.string().optional(),
  referenceId: z.string().uuid().optional(),
});

export type StockInInput = z.infer<typeof stockInSchema>;

// ---------------------------------------------------------------------------
// HLD Step 5 — Inventory ledger reads + continuous stock movements
// ---------------------------------------------------------------------------

const ledgerEntryTypes = [
  "stock_in",
  "sale",
  "damage",
  "return",
  "adjustment",
  "correction",
] as const;

/**
 * Query params for GET .../inventory/ledger
 * Powers the manager Ledger filter bar: date range, SKU, action type.
 */
export const ledgerQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  skuId: z.string().uuid().optional(),
  type: z.enum(ledgerEntryTypes).optional(),
  // Pagination — manager UI "Showing 1–3 of 1,244 entries"
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});

export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;

/**
 * POST .../inventory/movements — continuous ledger writes (Step 5).
 *
 * quantity is always positive in the request; the service applies the sign
 * based on type (stock_in/return → +, sale/damage → −).
 * adjustment/correction keep the sign you pass via `signedQuantity` if set,
 * otherwise treat `quantity` as the delta (can be negative).
 */
export const inventoryMovementSchema = z
  .object({
    skuId: z.string().uuid(),
    type: z.enum(["stock_in", "sale", "damage", "return", "adjustment", "correction"]),
    quantity: z.coerce.number().int().optional(),
    /** Prefer this for adjustment/correction when the delta can go either way */
    signedQuantity: z.coerce.number().int().optional(),
    source: z.string().optional(),
    referenceId: z.string().uuid().optional(),
  })
  .refine((v) => v.quantity !== undefined || v.signedQuantity !== undefined, {
    message: "Provide quantity or signedQuantity",
  });

export type InventoryMovementInput = z.infer<typeof inventoryMovementSchema>;

/** Query for GET .../inventory/:skuId history page size */
export const skuInventoryQuerySchema = z.object({
  historyLimit: z.coerce.number().int().positive().max(200).default(50),
});

export type SkuInventoryQuery = z.infer<typeof skuInventoryQuerySchema>;
