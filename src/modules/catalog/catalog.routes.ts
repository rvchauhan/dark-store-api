import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { catalogService } from "./catalog.service.js";
import {
  createSkuSchema,
  listSkusQuerySchema,
  updateSkuSchema,
  uploadImageSchema,
} from "./catalog.schemas.js";
import { asyncHandler } from "../../shared/middleware/error-handler.js";
import { requireAuth } from "../../shared/middleware/auth.js";
import { requireRoles } from "../../shared/middleware/rbac.js";
import { AppError } from "../../shared/errors/app-error.js";
import { routeParam } from "../../shared/utils/route-param.js";

/**
 * Catalog module routes — mounted at /api/catalog
 *
 * HLD Step 1: Master catalog creation
 *   POST  /catalog/skus
 *   GET   /catalog/skus
 *   GET   /catalog/skus/:id
 *   PATCH /catalog/skus/:id
 *   GET   /catalog/meta       — distinct brands/categories for form dropdowns
 *   POST  /catalog/uploads    — product image upload (served from /uploads)
 */
export const catalogRouter = Router();

/** Local disk storage for MVP; swap for S3/GCS behind the same endpoint later. */
export const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // keep in sync with portal's 2MB hint

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

// All catalog routes require authentication
catalogRouter.use(requireAuth);

// Only business_admin can create/edit master catalog entries
catalogRouter.post(
  "/skus",
  requireRoles("business_admin"),
  asyncHandler(async (req, res) => {
    const parsed = createSkuSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const sku = await catalogService.createSku(req.auth!, parsed.data);
    res.status(201).json(sku);
  }),
);

catalogRouter.get(
  "/skus",
  asyncHandler(async (req, res) => {
    const parsed = listSkusQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, "Invalid query parameters", "VALIDATION_ERROR");
    }

    const skus = await catalogService.listSkus(req.auth!, parsed.data);
    res.json({ data: skus });
  }),
);

catalogRouter.get(
  "/meta",
  asyncHandler(async (req, res) => {
    const meta = await catalogService.getCatalogMeta(req.auth!);
    res.json(meta);
  }),
);

catalogRouter.post(
  "/uploads",
  requireRoles("business_admin"),
  asyncHandler(async (req, res) => {
    const parsed = uploadImageSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const buffer = Buffer.from(parsed.data.data, "base64");
    if (buffer.length === 0) {
      throw new AppError(400, "Empty image payload", "VALIDATION_ERROR");
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new AppError(400, "Image exceeds the 2MB limit", "IMAGE_TOO_LARGE");
    }

    const fileName = `${randomUUID()}.${EXT_BY_MIME[parsed.data.mimeType]}`;
    await mkdir(UPLOADS_DIR, { recursive: true });
    await writeFile(path.join(UPLOADS_DIR, fileName), buffer);

    const url = `${req.protocol}://${req.get("host")}/uploads/${fileName}`;
    res.status(201).json({ url });
  }),
);

catalogRouter.get(
  "/skus/:id",
  asyncHandler(async (req, res) => {
    const sku = await catalogService.getSku(req.auth!, routeParam(req.params.id, "id"));
    res.json(sku);
  }),
);

catalogRouter.patch(
  "/skus/:id",
  requireRoles("business_admin"),
  asyncHandler(async (req, res) => {
    const parsed = updateSkuSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.errors[0]?.message ?? "Invalid input", "VALIDATION_ERROR");
    }

    const sku = await catalogService.updateSku(req.auth!, routeParam(req.params.id, "id"), parsed.data);
    res.json(sku);
  }),
);
