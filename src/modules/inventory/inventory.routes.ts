import { Router } from "express";
import { inventoryService } from "./inventory.service.js";
import {
  inventoryMovementSchema,
  ledgerQuerySchema,
  skuInventoryQuerySchema,
  stockInSchema,
} from "./inventory.schemas.js";
import { asyncHandler } from "../../shared/middleware/error-handler.js";
import { requireAuth } from "../../shared/middleware/auth.js";
import { requireRoles, requireStoreAccess } from "../../shared/middleware/rbac.js";
import { AppError } from "../../shared/errors/app-error.js";
import { routeParam } from "../../shared/utils/route-param.js";

/**
 * Inventory module routes — mounted at /api/stores/:storeId/inventory
 *
 * HLD Step 4: POST .../stock-in
 * HLD Step 5: GET  .../  (list)
 *             GET  .../ledger
 *             GET  .../ledger/summary
 *             GET  .../:skuId
 *             POST .../movements
 * HLD Step 6: GET  .../alerts  (placeholder)
 *
 * Static paths (/ledger, /stock-in, /alerts) MUST be registered before /:skuId.
 */
export const inventoryRouter = Router({ mergeParams: true });

inventoryRouter.use(requireAuth);
inventoryRouter.use(requireStoreAccess("storeId"));

// ---------------------------------------------------------------------------
// Step 4 — Stock-in
// ---------------------------------------------------------------------------

inventoryRouter.post(
  "/stock-in",
  requireRoles("business_admin", "store_manager", "store_employee"),
  asyncHandler(async (req, res) => {
    const parsed = stockInSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const storeId = routeParam(req.params.storeId, "storeId");
    const entry = await inventoryService.stockIn(req.auth!, storeId, parsed.data);
    res.status(201).json(entry);
  }),
);

// ---------------------------------------------------------------------------
// Step 5 — Continuous movements (damage / sale / return / adjustment)
// ---------------------------------------------------------------------------

inventoryRouter.post(
  "/movements",
  requireRoles("business_admin", "store_manager", "store_employee"),
  asyncHandler(async (req, res) => {
    const parsed = inventoryMovementSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const storeId = routeParam(req.params.storeId, "storeId");
    const entry = await inventoryService.recordMovement(req.auth!, storeId, parsed.data);
    res.status(201).json(entry);
  }),
);

// ---------------------------------------------------------------------------
// Step 5 — Reads
// ---------------------------------------------------------------------------

/** Live inventory table (manager Inventory screen) */
inventoryRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const storeId = routeParam(req.params.storeId, "storeId");
    const rows = await inventoryService.listInventory(req.auth!, storeId);
    res.json({ data: rows });
  }),
);

/** Paginated ledger + filters (manager Ledger screen) */
inventoryRouter.get(
  "/ledger",
  asyncHandler(async (req, res) => {
    const parsed = ledgerQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid query", "VALIDATION_ERROR");
    }

    const storeId = routeParam(req.params.storeId, "storeId");
    const result = await inventoryService.getLedgerHistory(req.auth!, storeId, parsed.data);
    res.json(result);
  }),
);

/** 24h restock / picked / damage cards */
inventoryRouter.get(
  "/ledger/summary",
  asyncHandler(async (req, res) => {
    const storeId = routeParam(req.params.storeId, "storeId");
    const summary = await inventoryService.getLedgerSummary24h(req.auth!, storeId);
    res.json(summary);
  }),
);

// Placeholder — low-stock alerts (Step 6)
inventoryRouter.get(
  "/alerts",
  asyncHandler(async (_req, res) => {
    res.status(501).json({
      message: "Inventory alerts endpoint — implement in Phase 6",
      hint: "Threshold checks will run via scheduled script (Postgres only, no Redis)",
    });
  }),
);

/**
 * Per-SKU snapshot + history.
 * Registered LAST so it doesn't swallow /ledger, /alerts, etc.
 */
inventoryRouter.get(
  "/:skuId",
  asyncHandler(async (req, res) => {
    const parsed = skuInventoryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, "Invalid query parameters", "VALIDATION_ERROR");
    }

    const storeId = routeParam(req.params.storeId, "storeId");
    const skuId = routeParam(req.params.skuId, "skuId");
    const result = await inventoryService.getSkuInventory(req.auth!, storeId, skuId, parsed.data);
    res.json(result);
  }),
);
