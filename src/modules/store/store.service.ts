import { Prisma } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { asUniqueViolation } from "../../db/prisma-helpers.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { AuthUser } from "../../shared/types/auth.js";
import type {
  BulkSkuMappingInput,
  CreateStoreInput,
  CreateSkuMappingInput,
  SkuMappingItemInput,
  UpdateSkuMappingInput,
  UpdateStoreInput,
} from "./store.schemas.js";
import { parseSkuMappingCsv } from "./store.schemas.js";

/**
 * Store module service — owns stores + store_sku_mapping.
 *
 * Module boundary:
 * - Primary writes: stores, store_sku_mapping
 * - Side-effect on assign (HLD Step 3):
 *     1. Flip master_catalog.status draft → active (first assignment)
 *     2. Create inventory_snapshot (store_id, sku_id, available_qty = 0)
 *   These are in-process "sku.assigned" side-effects. When inventory becomes
 *   its own microservice, replace (2) with an event publish and let
 *   inventory-service create the snapshot.
 *
 * Future split: `store-service` with POST /stores/:id/sku-mappings etc.
 */
export class StoreService {
  // -----------------------------------------------------------------------
  // Step 2 — Store registration
  // -----------------------------------------------------------------------

  async createStore(auth: AuthUser, input: CreateStoreInput) {
    const store = await prisma.store.create({
      data: {
        businessId: auth.businessId,
        name: input.name,
        code: input.code,
        address: input.address,
        geofence: input.geofence as Prisma.InputJsonValue,
        operatingHours: input.operatingHours as Prisma.InputJsonValue,
        ...(input.facility !== undefined
          ? { facility: input.facility as Prisma.InputJsonValue }
          : {}),
        status: "onboarding",
      },
    });

    // MVP "event": store.onboarding_started
    return store;
  }

  async listStores(auth: AuthUser) {
    // Store managers only see their own store; admins see all in the business
    if (auth.role !== "business_admin" && auth.storeId) {
      const store = await this.findStoreWithManager({ id: auth.storeId });
      return store ? [store] : [];
    }

    return this.findStoresWithManager({ businessId: auth.businessId });
  }

  async getStore(auth: AuthUser, storeId: string) {
    const store = await this.findStoreWithManager({ id: storeId });

    if (!store || store.businessId !== auth.businessId) {
      throw new AppError(404, "Store not found", "NOT_FOUND");
    }

    // Store-scoped roles cannot read other stores
    if (auth.role !== "business_admin" && auth.storeId !== store.id) {
      throw new AppError(403, "Cannot access another store", "FORBIDDEN");
    }

    return store;
  }

  /**
   * Business-wide admin Dashboard stats — everything computed in a handful of
   * SQL aggregations scoped to the caller's business, instead of the portal
   * fanning out one ledger-summary + one inventory call per store client-side.
   */
  async getDashboardStats(auth: AuthUser) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const storeRows = await prisma.store.findMany({
      where: { businessId: auth.businessId },
      select: { id: true, name: true, code: true, status: true },
    });

    const skusInCatalog = await prisma.masterCatalog.count({
      where: { businessId: auth.businessId },
    });

    const pickedRows =
      storeRows.length === 0
        ? []
        : await prisma.inventoryLedger.groupBy({
            by: ["storeId"],
            where: {
              type: "sale",
              createdAt: { gte: since },
              mapping: { store: { businessId: auth.businessId } },
            },
            _sum: { quantity: true },
          });

    const pickedByStore = new Map(
      pickedRows.map((r) => [r.storeId, Math.abs(Number(r._sum.quantity ?? 0))]),
    );

    const lowStockAlerts =
      storeRows.length === 0
        ? 0
        : (
            await prisma.$queryRaw<[{ value: bigint }]>`
              SELECT COUNT(*)::bigint AS value
              FROM inventory_snapshot s
              INNER JOIN store_sku_mapping m
                ON m.store_id = s.store_id AND m.sku_id = s.sku_id
              INNER JOIN stores st ON st.id = s.store_id
              WHERE st.business_id = ${auth.businessId}::uuid
                AND m.is_listed = true
                AND s.available_qty <= m.reorder_threshold
            `
          )[0]?.value ?? 0n;

    const perStorePicked = storeRows
      .map((s) => ({
        storeId: s.id,
        storeName: s.name,
        storeCode: s.code,
        pickedUnits: pickedByStore.get(s.id) ?? 0,
      }))
      .sort((a, b) => b.pickedUnits - a.pickedUnits);

    return {
      since: since.toISOString(),
      activeStores: storeRows.filter((s) => s.status === "active").length,
      totalStores: storeRows.length,
      skusInCatalog,
      totalPickedUnits24h: perStorePicked.reduce((sum, r) => sum + r.pickedUnits, 0),
      lowStockAlerts: Number(lowStockAlerts),
      perStorePicked,
    };
  }

  /**
   * Partial update for the "Edit Dark Store" flow — only touches provided fields.
   * `facility`/`geofence`/`operatingHours` are replaced wholesale (not deep-merged);
   * the wizard always sends the full object it built, so this matches its intent.
   */
  async updateStore(auth: AuthUser, storeId: string, input: UpdateStoreInput) {
    await this.getStore(auth, storeId);

    return prisma.store.update({
      where: { id: storeId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.geofence !== undefined ? { geofence: input.geofence as Prisma.InputJsonValue } : {}),
        ...(input.operatingHours !== undefined
          ? { operatingHours: input.operatingHours as Prisma.InputJsonValue }
          : {}),
        ...(input.facility !== undefined
          ? { facility: (input.facility ?? Prisma.JsonNull) as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  async activateStore(auth: AuthUser, storeId: string) {
    const store = await this.getStore(auth, storeId);

    if (store.status === "active") {
      return store;
    }

    const updated = await prisma.store.update({
      where: { id: storeId },
      data: { status: "active" },
    });

    // MVP "event": store.activated
    return updated;
  }

  // -----------------------------------------------------------------------
  // Step 3 — Store ↔ SKU assignment
  // -----------------------------------------------------------------------

  /**
   * Assign a single SKU to a store (wizard "Enable for Store" / pricing card).
   * Allowed while store is `onboarding` (wizard) or `active` (live edits).
   */
  async assignSku(auth: AuthUser, storeId: string, input: CreateSkuMappingInput) {
    const store = await this.getStore(auth, storeId);
    this.assertStoreAcceptsMappings(store.status);

    const sku = await this.resolveSku(auth.businessId, input);
    return this.assignSkuInTransaction(storeId, sku.id, input);
  }

  /**
   * List mappings for a store, joined with catalog fields for the UI table.
   */
  async listSkuMappings(auth: AuthUser, storeId: string) {
    await this.getStore(auth, storeId);

    const rows = await prisma.storeSkuMapping.findMany({
      where: { storeId },
      include: {
        sku: {
          select: {
            name: true,
            brand: true,
            category: true,
            barcode: true,
            basePrice: true,
            status: true,
          },
        },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      storeId: row.storeId,
      skuId: row.skuId,
      priceOverride: row.priceOverride,
      isListed: row.isListed,
      reorderThreshold: row.reorderThreshold,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      skuName: row.sku.name,
      brand: row.sku.brand,
      category: row.sku.category,
      barcode: row.sku.barcode,
      basePrice: row.sku.basePrice,
      catalogStatus: row.sku.status,
    }));
  }

  /**
   * Update listing / price / threshold for an existing mapping.
   * Does not recreate the snapshot — stock levels stay untouched.
   */
  async updateSkuMapping(auth: AuthUser, storeId: string, skuId: string, input: UpdateSkuMappingInput) {
    await this.getStore(auth, storeId);

    const existing = await prisma.storeSkuMapping.findUnique({
      where: { storeId_skuId: { storeId, skuId } },
    });

    if (!existing) {
      throw new AppError(404, "SKU mapping not found for this store", "NOT_FOUND");
    }

    return prisma.storeSkuMapping.update({
      where: { storeId_skuId: { storeId, skuId } },
      data: {
        ...(input.priceOverride !== undefined
          ? { priceOverride: input.priceOverride === null ? null : input.priceOverride.toFixed(2) }
          : {}),
        ...(input.isListed !== undefined ? { isListed: input.isListed } : {}),
        ...(input.reorderThreshold !== undefined ? { reorderThreshold: input.reorderThreshold } : {}),
      },
    });
  }

  /**
   * Unassign a SKU from a store.
   * Blocked if any ledger rows exist for the pair (would break inventory history).
   */
  async removeSkuMapping(auth: AuthUser, storeId: string, skuId: string) {
    await this.getStore(auth, storeId);

    const existing = await prisma.storeSkuMapping.findUnique({
      where: { storeId_skuId: { storeId, skuId } },
    });

    if (!existing) {
      throw new AppError(404, "SKU mapping not found for this store", "NOT_FOUND");
    }

    // Guard: ledger FK targets (store_id, sku_id) — deleting the mapping would violate integrity.
    const ledgerHit = await prisma.inventoryLedger.findFirst({
      where: { storeId, skuId },
      select: { id: true },
    });

    if (ledgerHit) {
      throw new AppError(
        409,
        "Cannot unassign SKU with existing ledger history — archive/unlist instead",
        "HAS_LEDGER_HISTORY",
      );
    }

    return prisma.$transaction(async (tx) => {
      // Snapshot FK also points at the mapping pair — remove it first.
      await tx.inventorySnapshot.deleteMany({ where: { storeId, skuId } });
      await tx.storeSkuMapping.delete({ where: { storeId_skuId: { storeId, skuId } } });
      return { storeId, skuId, removed: true };
    });
  }

  /**
   * Bulk assign — powers the "Import Batch" CSV upload on Inventory Mapping.
   * Processes row-by-row inside one transaction so a bad row rolls everything back.
   * Already-mapped SKUs are upserted (price/listing/threshold updated).
   */
  async bulkAssignSkus(auth: AuthUser, storeId: string, input: BulkSkuMappingInput) {
    const store = await this.getStore(auth, storeId);
    this.assertStoreAcceptsMappings(store.status);

    // Normalize JSON array or CSV string into the same item shape
    let items: SkuMappingItemInput[];
    try {
      items = input.mappings?.length ? input.mappings : parseSkuMappingCsv(input.csv!);
    } catch (err) {
      throw new AppError(400, err instanceof Error ? err.message : "Invalid CSV", "VALIDATION_ERROR");
    }

    if (items.length === 0) {
      throw new AppError(400, "No mapping rows to process", "VALIDATION_ERROR");
    }

    // Resolve all barcodes/skuIds up front so we fail fast before any writes
    const resolved: { skuId: string; item: SkuMappingItemInput }[] = [];
    for (const item of items) {
      const sku = await this.resolveSku(auth.businessId, item);
      resolved.push({ skuId: sku.id, item });
    }

    // Detect duplicate skuIds within the same bulk payload
    const seen = new Set<string>();
    for (const r of resolved) {
      if (seen.has(r.skuId)) {
        throw new AppError(400, `Duplicate SKU in bulk payload: ${r.skuId}`, "DUPLICATE_IN_PAYLOAD");
      }
      seen.add(r.skuId);
    }

    return prisma.$transaction(async (tx) => {
      const results = [];

      for (const { skuId, item } of resolved) {
        const mapping = await tx.storeSkuMapping.upsert({
          where: { storeId_skuId: { storeId, skuId } },
          create: {
            storeId,
            skuId,
            priceOverride: item.priceOverride == null ? null : item.priceOverride.toFixed(2),
            isListed: item.isListed,
            reorderThreshold: item.reorderThreshold,
          },
          update: {
            priceOverride: item.priceOverride == null ? null : item.priceOverride.toFixed(2),
            isListed: item.isListed,
            reorderThreshold: item.reorderThreshold,
          },
        });

        // Ensure snapshot exists (idempotent — do nothing if already present)
        await tx.inventorySnapshot.createMany({
          data: [{ storeId, skuId, availableQty: 0 }],
          skipDuplicates: true,
        });

        // Activate catalog SKU if it was still draft
        await tx.masterCatalog.updateMany({
          where: { id: skuId, status: "draft" },
          data: { status: "active" },
        });

        results.push(mapping);
      }

      // MVP "event": sku.assigned (bulk)
      return { assigned: results.length, data: results };
    });
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private async findStoreWithManager(where: { id?: string; businessId?: string }) {
    const stores = await this.findStoresWithManager(where);
    return stores[0] ?? null;
  }

  private async findStoresWithManager(where: { id?: string; businessId?: string }) {
    const rows = await prisma.store.findMany({
      where,
      include: {
        manager: { select: { name: true, email: true, status: true } },
      },
    });

    return rows.map((store) => ({
      id: store.id,
      businessId: store.businessId,
      name: store.name,
      code: store.code,
      address: store.address,
      geofence: store.geofence,
      operatingHours: store.operatingHours,
      facility: store.facility,
      status: store.status,
      managerUserId: store.managerUserId,
      createdAt: store.createdAt,
      updatedAt: store.updatedAt,
      managerName: store.manager?.name ?? null,
      managerEmail: store.manager?.email ?? null,
      managerStatus: store.manager?.status ?? null,
    }));
  }

  /** Wizard (onboarding) and live stores can receive mappings; closed/inactive cannot. */
  private assertStoreAcceptsMappings(status: string) {
    if (status !== "onboarding" && status !== "active") {
      throw new AppError(
        400,
        `Store status '${status}' cannot receive SKU assignments`,
        "STORE_NOT_ASSIGNABLE",
      );
    }
  }

  /** Resolve skuId or barcode → catalog row, scoped to the tenant. */
  private async resolveSku(businessId: string, input: { skuId?: string; barcode?: string }) {
    if (input.skuId) {
      const sku = await prisma.masterCatalog.findFirst({
        where: { id: input.skuId, businessId },
      });

      if (!sku) {
        throw new AppError(404, `SKU not found: ${input.skuId}`, "SKU_NOT_FOUND");
      }
      if (sku.status === "archived") {
        throw new AppError(400, "Cannot assign an archived SKU", "SKU_ARCHIVED");
      }
      return sku;
    }

    // barcode path — used by CSV imports from floor scanners / supplier sheets
    const sku = await prisma.masterCatalog.findFirst({
      where: { barcode: input.barcode!, businessId },
    });

    if (!sku) {
      throw new AppError(404, `No SKU with barcode: ${input.barcode}`, "SKU_NOT_FOUND");
    }
    if (sku.status === "archived") {
      throw new AppError(400, "Cannot assign an archived SKU", "SKU_ARCHIVED");
    }
    return sku;
  }

  /**
   * Single-SKU assign inside a transaction:
   *   mapping insert → snapshot (qty 0) → activate catalog if draft
   */
  private async assignSkuInTransaction(storeId: string, skuId: string, input: CreateSkuMappingInput) {
    try {
      return await prisma.$transaction(async (tx) => {
        const mapping = await tx.storeSkuMapping.create({
          data: {
            storeId,
            skuId,
            priceOverride: input.priceOverride == null ? null : input.priceOverride.toFixed(2),
            isListed: input.isListed,
            reorderThreshold: input.reorderThreshold,
          },
        });

        // Opening snapshot so stock-in (Step 4) has a row to update
        await tx.inventorySnapshot.create({
          data: { storeId, skuId, availableQty: 0 },
        });

        // HLD: status stays 'draft' until at least one store assignment exists
        await tx.masterCatalog.updateMany({
          where: { id: skuId, status: "draft" },
          data: { status: "active" },
        });

        // MVP "event": sku.assigned
        return mapping;
      });
    } catch (err: unknown) {
      // Unique violation on (store_id, sku_id)
      if (asUniqueViolation(err)) {
        throw new AppError(409, "SKU is already assigned to this store", "ALREADY_MAPPED");
      }
      throw err;
    }
  }
}

export const storeService = new StoreService();
