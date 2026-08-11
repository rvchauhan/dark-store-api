import { and, count, eq, gte, lte, sum } from "drizzle-orm";
import { db } from "../../db/client.js";
import { stores, storeSkuMapping } from "../../db/schema/store.js";
import { masterCatalog } from "../../db/schema/catalog.js";
import { users } from "../../db/schema/tenant.js";
import { inventoryLedger, inventorySnapshot } from "../../db/schema/inventory.js";
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
    const [store] = await db
      .insert(stores)
      .values({
        businessId: auth.businessId,
        name: input.name,
        code: input.code,
        address: input.address,
        geofence: input.geofence,
        operatingHours: input.operatingHours,
        facility: input.facility,
        status: "onboarding",
      })
      .returning();

    // MVP "event": store.onboarding_started
    return store;
  }

  async listStores(auth: AuthUser) {
    // Store managers only see their own store; admins see all in the business
    if (auth.role !== "business_admin" && auth.storeId) {
      const [store] = await db
        .select(this.storeWithManagerColumns())
        .from(stores)
        .leftJoin(users, eq(stores.managerUserId, users.id))
        .where(eq(stores.id, auth.storeId))
        .limit(1);
      return store ? [store] : [];
    }

    return db
      .select(this.storeWithManagerColumns())
      .from(stores)
      .leftJoin(users, eq(stores.managerUserId, users.id))
      .where(eq(stores.businessId, auth.businessId));
  }

  async getStore(auth: AuthUser, storeId: string) {
    const [store] = await db
      .select(this.storeWithManagerColumns())
      .from(stores)
      .leftJoin(users, eq(stores.managerUserId, users.id))
      .where(eq(stores.id, storeId))
      .limit(1);

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

    const storeRows = await db
      .select({ id: stores.id, name: stores.name, code: stores.code, status: stores.status })
      .from(stores)
      .where(eq(stores.businessId, auth.businessId));

    const [{ value: skusInCatalog }] = await db
      .select({ value: count() })
      .from(masterCatalog)
      .where(eq(masterCatalog.businessId, auth.businessId));

    const pickedRows =
      storeRows.length === 0
        ? []
        : await db
            .select({ storeId: inventoryLedger.storeId, totalQty: sum(inventoryLedger.quantity) })
            .from(inventoryLedger)
            .innerJoin(stores, eq(stores.id, inventoryLedger.storeId))
            .where(
              and(
                eq(stores.businessId, auth.businessId),
                eq(inventoryLedger.type, "sale"),
                gte(inventoryLedger.createdAt, since),
              ),
            )
            .groupBy(inventoryLedger.storeId);

    const pickedByStore = new Map(pickedRows.map((r) => [r.storeId, Math.abs(Number(r.totalQty ?? 0))]));

    const [{ value: lowStockAlerts }] =
      storeRows.length === 0
        ? [{ value: 0 }]
        : await db
            .select({ value: count() })
            .from(inventorySnapshot)
            .innerJoin(
              storeSkuMapping,
              and(
                eq(storeSkuMapping.storeId, inventorySnapshot.storeId),
                eq(storeSkuMapping.skuId, inventorySnapshot.skuId),
              ),
            )
            .innerJoin(stores, eq(stores.id, inventorySnapshot.storeId))
            .where(
              and(
                eq(stores.businessId, auth.businessId),
                eq(storeSkuMapping.isListed, true),
                lte(inventorySnapshot.availableQty, storeSkuMapping.reorderThreshold),
              ),
            );

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
      skusInCatalog: Number(skusInCatalog ?? 0),
      totalPickedUnits24h: perStorePicked.reduce((sum, r) => sum + r.pickedUnits, 0),
      lowStockAlerts: Number(lowStockAlerts ?? 0),
      perStorePicked,
    };
  }

  /** Store columns + the assigned manager's name/email/status (null if unassigned). */
  private storeWithManagerColumns() {
    return {
      id: stores.id,
      businessId: stores.businessId,
      name: stores.name,
      code: stores.code,
      address: stores.address,
      geofence: stores.geofence,
      operatingHours: stores.operatingHours,
      facility: stores.facility,
      status: stores.status,
      managerUserId: stores.managerUserId,
      createdAt: stores.createdAt,
      updatedAt: stores.updatedAt,
      managerName: users.name,
      managerEmail: users.email,
      managerStatus: users.status,
    };
  }

  /**
   * Partial update for the "Edit Dark Store" flow — only touches provided fields.
   * `facility`/`geofence`/`operatingHours` are replaced wholesale (not deep-merged);
   * the wizard always sends the full object it built, so this matches its intent.
   */
  async updateStore(auth: AuthUser, storeId: string, input: UpdateStoreInput) {
    await this.getStore(auth, storeId);

    const [updated] = await db
      .update(stores)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.geofence !== undefined ? { geofence: input.geofence } : {}),
        ...(input.operatingHours !== undefined ? { operatingHours: input.operatingHours } : {}),
        ...(input.facility !== undefined ? { facility: input.facility } : {}),
        updatedAt: new Date(),
      })
      .where(eq(stores.id, storeId))
      .returning();

    return updated;
  }

  async activateStore(auth: AuthUser, storeId: string) {
    const store = await this.getStore(auth, storeId);

    if (store.status === "active") {
      return store;
    }

    const [updated] = await db
      .update(stores)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(stores.id, storeId))
      .returning();

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

    return db
      .select({
        id: storeSkuMapping.id,
        storeId: storeSkuMapping.storeId,
        skuId: storeSkuMapping.skuId,
        priceOverride: storeSkuMapping.priceOverride,
        isListed: storeSkuMapping.isListed,
        reorderThreshold: storeSkuMapping.reorderThreshold,
        createdAt: storeSkuMapping.createdAt,
        updatedAt: storeSkuMapping.updatedAt,
        // Catalog fields — frontend uses these for product cards / table rows
        skuName: masterCatalog.name,
        brand: masterCatalog.brand,
        category: masterCatalog.category,
        barcode: masterCatalog.barcode,
        basePrice: masterCatalog.basePrice,
        catalogStatus: masterCatalog.status,
      })
      .from(storeSkuMapping)
      .innerJoin(masterCatalog, eq(storeSkuMapping.skuId, masterCatalog.id))
      .where(eq(storeSkuMapping.storeId, storeId));
  }

  /**
   * Update listing / price / threshold for an existing mapping.
   * Does not recreate the snapshot — stock levels stay untouched.
   */
  async updateSkuMapping(auth: AuthUser, storeId: string, skuId: string, input: UpdateSkuMappingInput) {
    await this.getStore(auth, storeId);

    const [existing] = await db
      .select()
      .from(storeSkuMapping)
      .where(and(eq(storeSkuMapping.storeId, storeId), eq(storeSkuMapping.skuId, skuId)))
      .limit(1);

    if (!existing) {
      throw new AppError(404, "SKU mapping not found for this store", "NOT_FOUND");
    }

    const [updated] = await db
      .update(storeSkuMapping)
      .set({
        ...(input.priceOverride !== undefined
          ? { priceOverride: input.priceOverride === null ? null : input.priceOverride.toFixed(2) }
          : {}),
        ...(input.isListed !== undefined ? { isListed: input.isListed } : {}),
        ...(input.reorderThreshold !== undefined ? { reorderThreshold: input.reorderThreshold } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(storeSkuMapping.storeId, storeId), eq(storeSkuMapping.skuId, skuId)))
      .returning();

    return updated;
  }

  /**
   * Unassign a SKU from a store.
   * Blocked if any ledger rows exist for the pair (would break inventory history).
   */
  async removeSkuMapping(auth: AuthUser, storeId: string, skuId: string) {
    await this.getStore(auth, storeId);

    const [existing] = await db
      .select()
      .from(storeSkuMapping)
      .where(and(eq(storeSkuMapping.storeId, storeId), eq(storeSkuMapping.skuId, skuId)))
      .limit(1);

    if (!existing) {
      throw new AppError(404, "SKU mapping not found for this store", "NOT_FOUND");
    }

    // Guard: ledger FK targets (store_id, sku_id) — deleting the mapping would violate integrity.
    const [ledgerHit] = await db
      .select({ id: inventoryLedger.id })
      .from(inventoryLedger)
      .where(and(eq(inventoryLedger.storeId, storeId), eq(inventoryLedger.skuId, skuId)))
      .limit(1);

    if (ledgerHit) {
      throw new AppError(
        409,
        "Cannot unassign SKU with existing ledger history — archive/unlist instead",
        "HAS_LEDGER_HISTORY",
      );
    }

    return db.transaction(async (tx) => {
      // Snapshot FK also points at the mapping pair — remove it first.
      await tx
        .delete(inventorySnapshot)
        .where(and(eq(inventorySnapshot.storeId, storeId), eq(inventorySnapshot.skuId, skuId)));

      await tx
        .delete(storeSkuMapping)
        .where(and(eq(storeSkuMapping.storeId, storeId), eq(storeSkuMapping.skuId, skuId)));

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
      items = input.mappings?.length
        ? input.mappings
        : parseSkuMappingCsv(input.csv!);
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

    return db.transaction(async (tx) => {
      const results = [];

      for (const { skuId, item } of resolved) {
        const [mapping] = await tx
          .insert(storeSkuMapping)
          .values({
            storeId,
            skuId,
            priceOverride: item.priceOverride == null ? null : item.priceOverride.toFixed(2),
            isListed: item.isListed,
            reorderThreshold: item.reorderThreshold,
          })
          .onConflictDoUpdate({
            // UNIQUE (store_id, sku_id) — re-import updates listing/price instead of failing
            target: [storeSkuMapping.storeId, storeSkuMapping.skuId],
            set: {
              priceOverride: item.priceOverride == null ? null : item.priceOverride.toFixed(2),
              isListed: item.isListed,
              reorderThreshold: item.reorderThreshold,
              updatedAt: new Date(),
            },
          })
          .returning();

        // Ensure snapshot exists (idempotent — do nothing if already present)
        await tx
          .insert(inventorySnapshot)
          .values({
            storeId,
            skuId,
            availableQty: 0,
          })
          .onConflictDoNothing();

        // Activate catalog SKU if it was still draft
        await tx
          .update(masterCatalog)
          .set({ status: "active", updatedAt: new Date() })
          .where(and(eq(masterCatalog.id, skuId), eq(masterCatalog.status, "draft")));

        results.push(mapping);
      }

      // MVP "event": sku.assigned (bulk)
      return { assigned: results.length, data: results };
    });
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

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
      const [sku] = await db
        .select()
        .from(masterCatalog)
        .where(and(eq(masterCatalog.id, input.skuId), eq(masterCatalog.businessId, businessId)))
        .limit(1);

      if (!sku) {
        throw new AppError(404, `SKU not found: ${input.skuId}`, "SKU_NOT_FOUND");
      }
      if (sku.status === "archived") {
        throw new AppError(400, "Cannot assign an archived SKU", "SKU_ARCHIVED");
      }
      return sku;
    }

    // barcode path — used by CSV imports from floor scanners / supplier sheets
    const [sku] = await db
      .select()
      .from(masterCatalog)
      .where(and(eq(masterCatalog.barcode, input.barcode!), eq(masterCatalog.businessId, businessId)))
      .limit(1);

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
      return await db.transaction(async (tx) => {
        const [mapping] = await tx
          .insert(storeSkuMapping)
          .values({
            storeId,
            skuId,
            priceOverride: input.priceOverride == null ? null : input.priceOverride.toFixed(2),
            isListed: input.isListed,
            reorderThreshold: input.reorderThreshold,
          })
          .returning();

        // Opening snapshot so stock-in (Step 4) has a row to update
        await tx.insert(inventorySnapshot).values({
          storeId,
          skuId,
          availableQty: 0,
        });

        // HLD: status stays 'draft' until at least one store assignment exists
        await tx
          .update(masterCatalog)
          .set({ status: "active", updatedAt: new Date() })
          .where(and(eq(masterCatalog.id, skuId), eq(masterCatalog.status, "draft")));

        // MVP "event": sku.assigned
        return mapping;
      });
    } catch (err: unknown) {
      // Unique violation on (store_id, sku_id)
      if (typeof err === "object" && err !== null && "code" in err && err.code === "23505") {
        throw new AppError(409, "SKU is already assigned to this store", "ALREADY_MAPPED");
      }
      throw err;
    }
  }
}

export const storeService = new StoreService();
