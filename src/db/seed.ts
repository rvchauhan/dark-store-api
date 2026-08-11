/**
 * Seeds demo data aligned with the dark-store-portal UI personas.
 * Run via: npm run db:seed (after migrations)
 *
 * Idempotent: safe to re-run — looks up existing rows by email/code before inserting.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { db, pool } from "./client.js";
import { businesses, users } from "./schema/tenant.js";
import { stores, storeSkuMapping } from "./schema/store.js";
import { masterCatalog } from "./schema/catalog.js";
import { inventoryLedger, inventorySnapshot } from "./schema/inventory.js";
import { customers } from "./schema/customer.js";

const DEMO_PASSWORD = "abcd123";

// Demo storefront catalog — gives the customer-app real data to browse on first run.
const DEMO_PRODUCTS = [
  {
    skuCode: "DEMO-BANANA",
    name: "Organic Bananas",
    brand: "Nature's Best",
    category: "Fruits",
    basePrice: "45.00",
    compareAtPrice: "52.00",
    unitOfMeasure: "6-pack",
    description: "Premium 500g bunch, sustainably sourced and ripened naturally.",
    initialStock: 60,
  },
  {
    skuCode: "DEMO-BERRYBOX",
    name: "Mixed Berry Box",
    brand: "Nature's Best",
    category: "Fruits",
    basePrice: "249.00",
    compareAtPrice: "299.00",
    unitOfMeasure: "250g box",
    description: "Hand-picked 250g box of blueberries, raspberries and strawberries.",
    initialStock: 25,
  },
  {
    skuCode: "DEMO-MILK",
    name: "Whole Milk",
    brand: "Dairy Farm",
    category: "Dairy",
    basePrice: "68.00",
    compareAtPrice: "75.00",
    unitOfMeasure: "1L",
    description: "1L tetra pack, farm fresh and nutrient-dense with zero additives.",
    initialStock: 80,
  },
  {
    skuCode: "DEMO-CHEDDAR",
    name: "Aged Cheddar",
    brand: "Dairy Farm",
    category: "Dairy",
    basePrice: "310.00",
    compareAtPrice: "380.00",
    unitOfMeasure: "200g",
    description: "200g artisanal block, sharp and savory, aged for 12 months.",
    initialStock: 30,
  },
  {
    skuCode: "DEMO-YOGURT",
    name: "Greek Yogurt",
    brand: "Dairy Farm",
    category: "Dairy",
    basePrice: "89.00",
    compareAtPrice: null,
    unitOfMeasure: "400g cup",
    description: "Thick and creamy strained yogurt, high in protein.",
    initialStock: 40,
  },
  {
    skuCode: "DEMO-RICE",
    name: "Basmati Rice",
    brand: "Golden Harvest",
    category: "Grocery",
    basePrice: "210.00",
    compareAtPrice: null,
    unitOfMeasure: "5kg bag",
    description: "Aged, long-grain basmati rice with a naturally fragrant aroma.",
    initialStock: 35,
  },
  {
    skuCode: "DEMO-COFFEE",
    name: "Organic Coffee",
    brand: "Golden Harvest",
    category: "Grocery",
    basePrice: "199.00",
    compareAtPrice: "350.00",
    unitOfMeasure: "250g pack",
    description: "Single-origin, medium-roast organic beans, ground fresh.",
    initialStock: 45,
  },
  {
    skuCode: "DEMO-BREAD",
    name: "Whole Wheat Bread",
    brand: "Golden Harvest",
    category: "Grocery",
    basePrice: "45.00",
    compareAtPrice: null,
    unitOfMeasure: "400g loaf",
    description: "Soft, stone-ground whole wheat loaf baked fresh daily.",
    initialStock: 50,
  },
  {
    skuCode: "DEMO-CHIPS",
    name: "Potato Chips",
    brand: "Snack Co",
    category: "Snacks",
    basePrice: "35.00",
    compareAtPrice: null,
    unitOfMeasure: "150g pack",
    description: "Kettle-cooked and lightly salted, sliced from real potatoes.",
    initialStock: 70,
  },
  {
    skuCode: "DEMO-NUTS",
    name: "Mixed Nuts",
    brand: "Snack Co",
    category: "Snacks",
    basePrice: "320.00",
    compareAtPrice: null,
    unitOfMeasure: "500g pack",
    description: "Roasted almonds, cashews and pistachios, unsalted.",
    initialStock: 20,
  },
] as const;

async function main() {
  console.log("Seeding database...");

  // --- Tenant root ---
  let [businessRow] = await db.select().from(businesses).where(eq(businesses.name, "Q-Commerce")).limit(1);

  if (!businessRow) {
    [businessRow] = await db.insert(businesses).values({ name: "Q-Commerce" }).returning();
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // --- Business admin (maps to portal role "admin" / Sarah Jenkins) ---
  let [admin] = await db.select().from(users).where(eq(users.email, "admin@qcommerce.io")).limit(1);
  if (!admin) {
    [admin] = await db
      .insert(users)
      .values({
        businessId: businessRow.id,
        storeId: null,
        name: "Ravi Admin",
        email: "admin@qcommerce.io",
        passwordHash,
        role: "business_admin",
        status: "active",
      })
      .returning();
  }

  // --- Store (Dark Store #402 from manager UI) ---
  let [storeRow] = await db.select().from(stores).where(eq(stores.code, "DS04")).limit(1);

  if (!storeRow) {
    [storeRow] = await db
      .insert(stores)
      .values({
        businessId: businessRow.id,
        name: "Dark Store #402",
        code: "DS04",
        address: "14 Wharf Road, London, E15 4QF, United Kingdom",
        geofence: { type: "circle", radiusKm: 5, center: { lat: 51.543, lng: -0.022 } },
        operatingHours: { timezone: "Europe/London", open: "06:00", close: "23:00" },
        facility: { totalCapacityM3: 2500, coldStorage: true },
        status: "active",
      })
      .returning();
  }

  // --- Store manager (maps to portal role "manager" / Alex Thompson) ---
  let [managerRow] = await db.select().from(users).where(eq(users.email, "manager@qcommerce.io")).limit(1);

  if (!managerRow) {
    [managerRow] = await db
      .insert(users)
      .values({
        businessId: businessRow.id,
        storeId: storeRow.id,
        name: "Krishn Manager",
        email: "manager@qcommerce.io",
        passwordHash,
        role: "store_manager",
        status: "active",
      })
      .returning();
  }

  // Link store to its manager (resolves stores ↔ users circular reference).
  if (managerRow && !storeRow.managerUserId) {
    await db
      .update(stores)
      .set({ managerUserId: managerRow.id, updatedAt: new Date() })
      .where(eq(stores.id, storeRow.id));
  }

  // --- Demo catalog: listed + stocked at the demo store, for the customer-app to browse ---
  for (const product of DEMO_PRODUCTS) {
    let [sku] = await db
      .select()
      .from(masterCatalog)
      .where(and(eq(masterCatalog.businessId, businessRow.id), eq(masterCatalog.skuCode, product.skuCode)))
      .limit(1);

    if (!sku) {
      [sku] = await db
        .insert(masterCatalog)
        .values({
          businessId: businessRow.id,
          name: product.name,
          brand: product.brand,
          category: product.category,
          skuCode: product.skuCode,
          basePrice: product.basePrice,
          compareAtPrice: product.compareAtPrice,
          unitOfMeasure: product.unitOfMeasure,
          description: product.description,
          status: "active",
        })
        .returning();
    } else if (!sku.description) {
      // Backfill for rows seeded before `description` was added to the demo catalog.
      [sku] = await db
        .update(masterCatalog)
        .set({ description: product.description, updatedAt: new Date() })
        .where(eq(masterCatalog.id, sku.id))
        .returning();
    }

    let [mapping] = await db
      .select()
      .from(storeSkuMapping)
      .where(and(eq(storeSkuMapping.storeId, storeRow.id), eq(storeSkuMapping.skuId, sku.id)))
      .limit(1);

    if (!mapping) {
      [mapping] = await db
        .insert(storeSkuMapping)
        .values({
          storeId: storeRow.id,
          skuId: sku.id,
          isListed: true,
          reorderThreshold: 10,
        })
        .returning();
    }

    const [existingSnapshot] = await db
      .select()
      .from(inventorySnapshot)
      .where(and(eq(inventorySnapshot.storeId, storeRow.id), eq(inventorySnapshot.skuId, sku.id)))
      .limit(1);

    if (!existingSnapshot) {
      // Opening stock — a real stock_in ledger row backs the snapshot, same
      // invariant the staff portal's inventory screens rely on.
      const [ledgerRow] = await db
        .insert(inventoryLedger)
        .values({
          storeId: storeRow.id,
          skuId: sku.id,
          type: "stock_in",
          quantity: product.initialStock,
          source: "seed",
        })
        .returning();

      await db.insert(inventorySnapshot).values({
        storeId: storeRow.id,
        skuId: sku.id,
        availableQty: product.initialStock,
        lastLedgerId: ledgerRow.id,
      });
    }
  }

  // --- Demo customer (customer-app login) ---
  let [customerRow] = await db.select().from(customers).where(eq(customers.email, "customer@qcommerce.io")).limit(1);

  if (!customerRow) {
    [customerRow] = await db
      .insert(customers)
      .values({
        name: "Priya Customer",
        email: "customer@qcommerce.io",
        passwordHash,
        status: "active",
      })
      .returning();
  }

  console.log("Seed complete.");
  console.log("  Business:", businessRow.name, businessRow.id);
  console.log("  Store:   ", storeRow.name, storeRow.id);
  console.log("  Catalog: ", DEMO_PRODUCTS.length, "products listed + stocked");
  console.log("  Staff logins:    admin@qcommerce.io / manager@qcommerce.io");
  console.log("  Customer login:  customer@qcommerce.io");
  console.log("  Password:", DEMO_PASSWORD);

  await pool.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
