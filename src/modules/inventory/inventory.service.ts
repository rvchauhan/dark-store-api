import { and, asc, count, desc, eq, gte, lte, sql, sum } from "drizzle-orm";
import { db } from "../../db/client.js";
import { inventoryLedger, inventorySnapshot } from "../../db/schema/inventory.js";
import { storeSkuMapping } from "../../db/schema/store.js";
import { masterCatalog } from "../../db/schema/catalog.js";
import { users } from "../../db/schema/tenant.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { AuthUser } from "../../shared/types/auth.js";
import type {
  InventoryMovementInput,
  LedgerQuery,
  SkuInventoryQuery,
  StockInInput,
} from "./inventory.schemas.js";

/**
 * Inventory module service — ledger writes + snapshot reads.
 *
 * Critical invariant (HLD §4):
 *   Every ledger INSERT updates inventory_snapshot in the SAME transaction.
 *   available_qty is a cache; SUM(ledger.quantity) is the source of truth.
 *
 * No Redis: reads hit Postgres directly.
 *
 * Future split: `inventory-service` owns ledger + snapshot + notifications.
 */
export class InventoryService {
  // -----------------------------------------------------------------------
  // Step 4 — Opening stock / restock
  // -----------------------------------------------------------------------

  /**
   * HLD Step 4: Log opening stock or a restock.
   * Uses a transaction so ledger + snapshot stay consistent.
   */
  async stockIn(auth: AuthUser, storeId: string, input: StockInInput) {
    return this.recordMovement(auth, storeId, {
      skuId: input.skuId,
      type: "stock_in",
      quantity: input.quantity,
      source: input.source ?? "manual_stock_in",
      referenceId: input.referenceId,
    });
  }

  // -----------------------------------------------------------------------
  // Step 5 — Reads (manager Inventory + Ledger screens)
  // -----------------------------------------------------------------------

  /**
   * Live SKU table for manager inventory UI.
   * Joins snapshot ↔ mapping ↔ catalog so the frontend gets name/category/status.
   */
  async listInventory(auth: AuthUser, storeId: string) {
    void auth;

    return db
      .select({
        storeId: inventorySnapshot.storeId,
        skuId: inventorySnapshot.skuId,
        availableQty: inventorySnapshot.availableQty,
        lastLedgerId: inventorySnapshot.lastLedgerId,
        updatedAt: inventorySnapshot.updatedAt,
        // Mapping / listing
        isListed: storeSkuMapping.isListed,
        priceOverride: storeSkuMapping.priceOverride,
        reorderThreshold: storeSkuMapping.reorderThreshold,
        // Catalog display fields
        skuName: masterCatalog.name,
        brand: masterCatalog.brand,
        category: masterCatalog.category,
        barcode: masterCatalog.barcode,
        basePrice: masterCatalog.basePrice,
      })
      .from(inventorySnapshot)
      .innerJoin(
        storeSkuMapping,
        and(
          eq(storeSkuMapping.storeId, inventorySnapshot.storeId),
          eq(storeSkuMapping.skuId, inventorySnapshot.skuId),
        ),
      )
      .innerJoin(masterCatalog, eq(masterCatalog.id, inventorySnapshot.skuId))
      .where(eq(inventorySnapshot.storeId, storeId))
      .orderBy(asc(masterCatalog.name));
  }

  /**
   * HLD: GET /stores/:id/inventory/:sku_id
   * Current available_qty + recent ledger history for one SKU.
   */
  async getSkuInventory(auth: AuthUser, storeId: string, skuId: string, query: SkuInventoryQuery) {
    void auth;

    const [snapshot] = await db
      .select({
        storeId: inventorySnapshot.storeId,
        skuId: inventorySnapshot.skuId,
        availableQty: inventorySnapshot.availableQty,
        lastLedgerId: inventorySnapshot.lastLedgerId,
        updatedAt: inventorySnapshot.updatedAt,
        isListed: storeSkuMapping.isListed,
        priceOverride: storeSkuMapping.priceOverride,
        reorderThreshold: storeSkuMapping.reorderThreshold,
        skuName: masterCatalog.name,
        brand: masterCatalog.brand,
        category: masterCatalog.category,
        barcode: masterCatalog.barcode,
        basePrice: masterCatalog.basePrice,
      })
      .from(inventorySnapshot)
      .innerJoin(
        storeSkuMapping,
        and(
          eq(storeSkuMapping.storeId, inventorySnapshot.storeId),
          eq(storeSkuMapping.skuId, inventorySnapshot.skuId),
        ),
      )
      .innerJoin(masterCatalog, eq(masterCatalog.id, inventorySnapshot.skuId))
      .where(and(eq(inventorySnapshot.storeId, storeId), eq(inventorySnapshot.skuId, skuId)))
      .limit(1);

    if (!snapshot) {
      // Mapping may exist with no snapshot yet (shouldn't happen after Step 3, but be safe)
      const [mapping] = await db
        .select()
        .from(storeSkuMapping)
        .where(and(eq(storeSkuMapping.storeId, storeId), eq(storeSkuMapping.skuId, skuId)))
        .limit(1);

      if (!mapping) {
        throw new AppError(404, "SKU is not assigned to this store", "SKU_NOT_MAPPED");
      }

      throw new AppError(404, "No inventory snapshot for this SKU yet — run a stock-in first", "NO_SNAPSHOT");
    }

    const history = await db
      .select({
        id: inventoryLedger.id,
        type: inventoryLedger.type,
        quantity: inventoryLedger.quantity,
        referenceId: inventoryLedger.referenceId,
        source: inventoryLedger.source,
        createdAt: inventoryLedger.createdAt,
        employeeId: inventoryLedger.employeeId,
        employeeName: users.name,
      })
      .from(inventoryLedger)
      .leftJoin(users, eq(users.id, inventoryLedger.employeeId))
      .where(and(eq(inventoryLedger.storeId, storeId), eq(inventoryLedger.skuId, skuId)))
      .orderBy(desc(inventoryLedger.createdAt))
      .limit(query.historyLimit);

    return { snapshot, history };
  }

  /**
   * Paginated ledger for the manager Ledger screen.
   * Filters: from / to / skuId / type — matches the filter bar in the UI mock.
   *
   * Also returns a running balance per row (sum of qty for that store+sku up to
   * and including the row's created_at), which maps to the BALANCE column.
   */
  async getLedgerHistory(auth: AuthUser, storeId: string, query: LedgerQuery) {
    void auth;

    const conditions = [eq(inventoryLedger.storeId, storeId)];

    if (query.from) conditions.push(gte(inventoryLedger.createdAt, query.from));
    if (query.to) conditions.push(lte(inventoryLedger.createdAt, query.to));
    if (query.skuId) conditions.push(eq(inventoryLedger.skuId, query.skuId));
    if (query.type) conditions.push(eq(inventoryLedger.type, query.type));

    const whereClause = and(...conditions);

    // Total for pagination footer: "Showing 1–25 of 1,244 entries"
    const [totalRow] = await db.select({ total: count() }).from(inventoryLedger).where(whereClause);
    const total = Number(totalRow?.total ?? 0);

    const offset = (query.page - 1) * query.pageSize;

    // Window function: running balance for this store+sku ordered by time.
    // Uses the idx_ledger_store_sku_time index for the partition.
    const rows = await db
      .select({
        id: inventoryLedger.id,
        storeId: inventoryLedger.storeId,
        skuId: inventoryLedger.skuId,
        type: inventoryLedger.type,
        quantity: inventoryLedger.quantity,
        referenceId: inventoryLedger.referenceId,
        source: inventoryLedger.source,
        createdAt: inventoryLedger.createdAt,
        employeeId: inventoryLedger.employeeId,
        employeeName: users.name,
        skuName: masterCatalog.name,
        barcode: masterCatalog.barcode,
        category: masterCatalog.category,
        // Running balance after this event for (store, sku)
        balance: sql<number>`
          sum(${inventoryLedger.quantity}) over (
            partition by ${inventoryLedger.storeId}, ${inventoryLedger.skuId}
            order by ${inventoryLedger.createdAt} asc, ${inventoryLedger.id} asc
            rows between unbounded preceding and current row
          )
        `.mapWith(Number),
      })
      .from(inventoryLedger)
      .leftJoin(users, eq(users.id, inventoryLedger.employeeId))
      .innerJoin(masterCatalog, eq(masterCatalog.id, inventoryLedger.skuId))
      .where(whereClause)
      .orderBy(desc(inventoryLedger.createdAt))
      .limit(query.pageSize)
      .offset(offset);

    return {
      data: rows,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  /**
   * 24h summary cards on the Ledger page:
   *   Total Restock / Total Picked / Damage
   */
  async getLedgerSummary24h(auth: AuthUser, storeId: string) {
    void auth;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        type: inventoryLedger.type,
        totalQty: sum(inventoryLedger.quantity),
      })
      .from(inventoryLedger)
      .where(and(eq(inventoryLedger.storeId, storeId), gte(inventoryLedger.createdAt, since)))
      .groupBy(inventoryLedger.type);

    const byType = Object.fromEntries(rows.map((r) => [r.type, Number(r.totalQty ?? 0)]));

    return {
      since: since.toISOString(),
      restockUnits: byType.stock_in ?? 0, // positive
      pickedUnits: Math.abs(byType.sale ?? 0), // shown as negative outflow in UI
      damageUnits: Math.abs(byType.damage ?? 0),
      returnUnits: byType.return ?? 0,
      adjustmentUnits: byType.adjustment ?? 0,
    };
  }

  // -----------------------------------------------------------------------
  // Step 5 — Continuous writes (damage / sale / return / adjustment)
  // -----------------------------------------------------------------------

  /**
   * Generic movement writer used by stock-in and adjustment endpoints.
   * Always: INSERT ledger + UPDATE snapshot in one transaction.
   * Append-only: never UPDATE/DELETE ledger rows.
   */
  async recordMovement(auth: AuthUser, storeId: string, input: InventoryMovementInput) {
    // Verify the SKU is assigned to this store before accepting stock movement
    const [mapping] = await db
      .select()
      .from(storeSkuMapping)
      .where(and(eq(storeSkuMapping.storeId, storeId), eq(storeSkuMapping.skuId, input.skuId)))
      .limit(1);

    if (!mapping) {
      throw new AppError(400, "SKU is not assigned to this store", "SKU_NOT_MAPPED");
    }

    const delta = this.resolveSignedQuantity(input);
    if (delta === 0) {
      throw new AppError(400, "Quantity delta cannot be zero", "INVALID_QUANTITY");
    }

    return db.transaction(async (tx) => {
      const [ledgerRow] = await tx
        .insert(inventoryLedger)
        .values({
          storeId,
          skuId: input.skuId,
          type: input.type,
          quantity: delta,
          referenceId: input.referenceId,
          employeeId: auth.userId,
          source: input.source ?? `manual_${input.type}`,
        })
        .returning();

      // Snapshot must already exist after Step 3 assignment; upsert covers edge cases
      await tx
        .insert(inventorySnapshot)
        .values({
          storeId,
          skuId: input.skuId,
          availableQty: Math.max(0, delta), // opening from zero if somehow missing
          lastLedgerId: ledgerRow.id,
        })
        .onConflictDoUpdate({
          target: [inventorySnapshot.storeId, inventorySnapshot.skuId],
          set: {
            availableQty: sql`${inventorySnapshot.availableQty} + ${delta}`,
            lastLedgerId: ledgerRow.id,
            updatedAt: new Date(),
          },
        });

      // MVP "event": stock.updated
      return ledgerRow;
    });
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /**
   * Apply sign convention from HLD:
   *   stock_in / return  → positive
   *   sale / damage      → negative
   *   adjustment/correction → use signedQuantity if provided, else quantity as-is
   */
  private resolveSignedQuantity(input: InventoryMovementInput): number {
    if (input.type === "adjustment" || input.type === "correction") {
      if (input.signedQuantity !== undefined) return input.signedQuantity;
      if (input.quantity === undefined) {
        throw new AppError(400, "adjustment/correction requires quantity or signedQuantity", "VALIDATION_ERROR");
      }
      return input.quantity;
    }

    const abs = Math.abs(input.quantity ?? input.signedQuantity ?? 0);
    if (input.type === "stock_in" || input.type === "return") return abs;
    // sale, damage
    return -abs;
  }
}

export const inventoryService = new InventoryService();
