import { Prisma } from "@prisma/client";
import { prisma } from "../../db/client.js";
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

    const joined = await prisma.inventorySnapshot.findMany({
      where: { storeId },
      include: {
        mapping: {
          include: {
            sku: {
              select: {
                name: true,
                brand: true,
                category: true,
                barcode: true,
                basePrice: true,
              },
            },
          },
        },
      },
    });

    return joined
      .map((row) => ({
        storeId: row.storeId,
        skuId: row.skuId,
        availableQty: row.availableQty,
        lastLedgerId: row.lastLedgerId,
        updatedAt: row.updatedAt,
        isListed: row.mapping.isListed,
        priceOverride: row.mapping.priceOverride,
        reorderThreshold: row.mapping.reorderThreshold,
        skuName: row.mapping.sku.name,
        brand: row.mapping.sku.brand,
        category: row.mapping.sku.category,
        barcode: row.mapping.sku.barcode,
        basePrice: row.mapping.sku.basePrice,
      }))
      .sort((a, b) => a.skuName.localeCompare(b.skuName));
  }

  /**
   * HLD: GET /stores/:id/inventory/:sku_id
   * Current available_qty + recent ledger history for one SKU.
   */
  async getSkuInventory(auth: AuthUser, storeId: string, skuId: string, query: SkuInventoryQuery) {
    void auth;

    const snapshotRow = await prisma.inventorySnapshot.findUnique({
      where: { storeId_skuId: { storeId, skuId } },
      include: {
        mapping: {
          include: {
            sku: {
              select: {
                name: true,
                brand: true,
                category: true,
                barcode: true,
                basePrice: true,
              },
            },
          },
        },
      },
    });

    if (!snapshotRow) {
      // Mapping may exist with no snapshot yet (shouldn't happen after Step 3, but be safe)
      const mapping = await prisma.storeSkuMapping.findUnique({
        where: { storeId_skuId: { storeId, skuId } },
      });

      if (!mapping) {
        throw new AppError(404, "SKU is not assigned to this store", "SKU_NOT_MAPPED");
      }

      throw new AppError(404, "No inventory snapshot for this SKU yet — run a stock-in first", "NO_SNAPSHOT");
    }

    const history = await prisma.inventoryLedger.findMany({
      where: { storeId, skuId },
      include: { employee: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: query.historyLimit,
    });

    return {
      snapshot: {
        storeId: snapshotRow.storeId,
        skuId: snapshotRow.skuId,
        availableQty: snapshotRow.availableQty,
        lastLedgerId: snapshotRow.lastLedgerId,
        updatedAt: snapshotRow.updatedAt,
        isListed: snapshotRow.mapping.isListed,
        priceOverride: snapshotRow.mapping.priceOverride,
        reorderThreshold: snapshotRow.mapping.reorderThreshold,
        skuName: snapshotRow.mapping.sku.name,
        brand: snapshotRow.mapping.sku.brand,
        category: snapshotRow.mapping.sku.category,
        barcode: snapshotRow.mapping.sku.barcode,
        basePrice: snapshotRow.mapping.sku.basePrice,
      },
      history: history.map((row) => ({
        id: row.id,
        type: row.type,
        quantity: row.quantity,
        referenceId: row.referenceId,
        source: row.source,
        createdAt: row.createdAt,
        employeeId: row.employeeId,
        employeeName: row.employee?.name ?? null,
      })),
    };
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

    const where: Prisma.InventoryLedgerWhereInput = {
      storeId,
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
      ...(query.skuId ? { skuId: query.skuId } : {}),
      ...(query.type ? { type: query.type } : {}),
    };

    const total = await prisma.inventoryLedger.count({ where });
    const offset = (query.page - 1) * query.pageSize;

    // Window function: running balance for this store+sku ordered by time.
    // Uses the idx_ledger_store_sku_time index for the partition.
    type LedgerRow = {
      id: string;
      store_id: string;
      sku_id: string;
      type: string;
      quantity: number;
      reference_id: string | null;
      source: string | null;
      created_at: Date;
      employee_id: string | null;
      employee_name: string | null;
      sku_name: string;
      barcode: string | null;
      category: string | null;
      balance: number;
    };

    const filters: Prisma.Sql[] = [Prisma.sql`l.store_id = ${storeId}::uuid`];
    if (query.from) filters.push(Prisma.sql`l.created_at >= ${query.from}`);
    if (query.to) filters.push(Prisma.sql`l.created_at <= ${query.to}`);
    if (query.skuId) filters.push(Prisma.sql`l.sku_id = ${query.skuId}::uuid`);
    if (query.type) filters.push(Prisma.sql`l.type = ${query.type}::ledger_entry_type`);

    const rows = await prisma.$queryRaw<LedgerRow[]>(Prisma.sql`
      SELECT
        l.id,
        l.store_id,
        l.sku_id,
        l.type::text AS type,
        l.quantity,
        l.reference_id,
        l.source,
        l.created_at,
        l.employee_id,
        u.name AS employee_name,
        c.name AS sku_name,
        c.barcode,
        c.category,
        SUM(l.quantity) OVER (
          PARTITION BY l.store_id, l.sku_id
          ORDER BY l.created_at ASC, l.id ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )::int AS balance
      FROM inventory_ledger l
      LEFT JOIN users u ON u.id = l.employee_id
      INNER JOIN master_catalog c ON c.id = l.sku_id
      WHERE ${Prisma.join(filters, " AND ")}
      ORDER BY l.created_at DESC
      LIMIT ${query.pageSize}
      OFFSET ${offset}
    `);

    return {
      data: rows.map((row) => ({
        id: row.id,
        storeId: row.store_id,
        skuId: row.sku_id,
        type: row.type,
        quantity: row.quantity,
        referenceId: row.reference_id,
        source: row.source,
        createdAt: row.created_at,
        employeeId: row.employee_id,
        employeeName: row.employee_name,
        skuName: row.sku_name,
        barcode: row.barcode,
        category: row.category,
        balance: Number(row.balance),
      })),
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

    const rows = await prisma.inventoryLedger.groupBy({
      by: ["type"],
      where: { storeId, createdAt: { gte: since } },
      _sum: { quantity: true },
    });

    const byType = Object.fromEntries(rows.map((r) => [r.type, Number(r._sum.quantity ?? 0)]));

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
    const mapping = await prisma.storeSkuMapping.findUnique({
      where: { storeId_skuId: { storeId, skuId: input.skuId } },
    });

    if (!mapping) {
      throw new AppError(400, "SKU is not assigned to this store", "SKU_NOT_MAPPED");
    }

    const delta = this.resolveSignedQuantity(input);
    if (delta === 0) {
      throw new AppError(400, "Quantity delta cannot be zero", "INVALID_QUANTITY");
    }

    return prisma.$transaction(async (tx) => {
      const ledgerRow = await tx.inventoryLedger.create({
        data: {
          storeId,
          skuId: input.skuId,
          type: input.type,
          quantity: delta,
          referenceId: input.referenceId,
          employeeId: auth.userId,
          source: input.source ?? `manual_${input.type}`,
        },
      });

      // Snapshot must already exist after Step 3 assignment; upsert covers edge cases
      await tx.inventorySnapshot.upsert({
        where: { storeId_skuId: { storeId, skuId: input.skuId } },
        create: {
          storeId,
          skuId: input.skuId,
          availableQty: Math.max(0, delta), // opening from zero if somehow missing
          lastLedgerId: ledgerRow.id,
        },
        update: {
          availableQty: { increment: delta },
          lastLedgerId: ledgerRow.id,
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
