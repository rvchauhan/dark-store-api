import { Router } from "express";
import { storeService } from "./store.service.js";
import {
  bulkSkuMappingSchema,
  createStoreSchema,
  createSkuMappingSchema,
  updateSkuMappingSchema,
  updateStoreSchema,
} from "./store.schemas.js";
import { asyncHandler } from "../../shared/middleware/error-handler.js";
import { requireAuth } from "../../shared/middleware/auth.js";
import { requireRoles, requireStoreAccess } from "../../shared/middleware/rbac.js";
import { AppError } from "../../shared/errors/app-error.js";
import { routeParam } from "../../shared/utils/route-param.js";

/**
 * Store module routes — mounted at /api/stores
 *
 * HLD Step 2: Store registration
 *   POST  /stores
 *   GET   /stores
 *   GET   /stores/:id
 *   PATCH /stores/:id
 *   POST  /stores/:id/activate
 *
 * HLD Step 3: Store ↔ SKU assignment
 *   POST   /stores/:id/sku-mappings
 *   GET    /stores/:id/sku-mappings
 *   PATCH  /stores/:id/sku-mappings/:skuId
 *   DELETE /stores/:id/sku-mappings/:skuId
 *   POST   /stores/:id/sku-mappings/bulk
 */
export const storeRouter = Router();

storeRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// Step 2 — Store CRUD / activation
// ---------------------------------------------------------------------------

storeRouter.post(
  "/",
  requireRoles("business_admin"),
  asyncHandler(async (req, res) => {
    const parsed = createStoreSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const store = await storeService.createStore(req.auth!, parsed.data);
    res.status(201).json(store);
  }),
);

storeRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const stores = await storeService.listStores(req.auth!);
    res.json({ data: stores });
  }),
);

// Static path — must be registered before "/:id" or Express treats "dashboard-stats" as an id.
storeRouter.get(
  "/dashboard-stats",
  requireRoles("business_admin"),
  asyncHandler(async (req, res) => {
    const stats = await storeService.getDashboardStats(req.auth!);
    res.json(stats);
  }),
);

storeRouter.get(
  "/:id",
  requireStoreAccess("id"),
  asyncHandler(async (req, res) => {
    const store = await storeService.getStore(req.auth!, routeParam(req.params.id, "id"));
    res.json(store);
  }),
);

// Store managers may edit their own store's operating profile (hours/facility)
// but not identity/ownership fields (name, code, address, manager assignment) — admin-only.
const MANAGER_EDITABLE_FIELDS = ["operatingHours", "facility"] as const;

storeRouter.patch(
  "/:id",
  requireRoles("business_admin", "store_manager"),
  requireStoreAccess("id"),
  asyncHandler(async (req, res) => {
    const parsed = updateStoreSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const input =
      req.auth!.role === "business_admin"
        ? parsed.data
        : Object.fromEntries(
            Object.entries(parsed.data).filter(([key]) =>
              MANAGER_EDITABLE_FIELDS.includes(key as (typeof MANAGER_EDITABLE_FIELDS)[number]),
            ),
          );

    const store = await storeService.updateStore(req.auth!, routeParam(req.params.id, "id"), input);
    res.json(store);
  }),
);

storeRouter.post(
  "/:id/activate",
  requireRoles("business_admin"),
  asyncHandler(async (req, res) => {
    const store = await storeService.activateStore(req.auth!, routeParam(req.params.id, "id"));
    res.json(store);
  }),
);

// ---------------------------------------------------------------------------
// Step 3 — SKU mappings
//
// Route order matters: `/sku-mappings/bulk` must be registered BEFORE
// `/:skuId`, otherwise Express treats "bulk" as a skuId param.
// ---------------------------------------------------------------------------

storeRouter.post(
  "/:id/sku-mappings",
  requireRoles("business_admin"),
  requireStoreAccess("id"),
  asyncHandler(async (req, res) => {
    const parsed = createSkuMappingSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const mapping = await storeService.assignSku(
      req.auth!,
      routeParam(req.params.id, "id"),
      parsed.data,
    );
    res.status(201).json(mapping);
  }),
);

storeRouter.get(
  "/:id/sku-mappings",
  requireStoreAccess("id"),
  asyncHandler(async (req, res) => {
    const data = await storeService.listSkuMappings(req.auth!, routeParam(req.params.id, "id"));
    res.json({ data });
  }),
);

storeRouter.post(
  "/:id/sku-mappings/bulk",
  requireRoles("business_admin"),
  requireStoreAccess("id"),
  asyncHandler(async (req, res) => {
    const parsed = bulkSkuMappingSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const result = await storeService.bulkAssignSkus(
      req.auth!,
      routeParam(req.params.id, "id"),
      parsed.data,
    );
    res.status(201).json(result);
  }),
);

storeRouter.patch(
  "/:id/sku-mappings/:skuId",
  requireRoles("business_admin", "store_manager"),
  requireStoreAccess("id"),
  asyncHandler(async (req, res) => {
    const parsed = updateSkuMappingSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const mapping = await storeService.updateSkuMapping(
      req.auth!,
      routeParam(req.params.id, "id"),
      routeParam(req.params.skuId, "skuId"),
      parsed.data,
    );
    res.json(mapping);
  }),
);

storeRouter.delete(
  "/:id/sku-mappings/:skuId",
  requireRoles("business_admin"),
  requireStoreAccess("id"),
  asyncHandler(async (req, res) => {
    const result = await storeService.removeSkuMapping(
      req.auth!,
      routeParam(req.params.id, "id"),
      routeParam(req.params.skuId, "skuId"),
    );
    res.json(result);
  }),
);
