/**
 * Seeds demo data aligned with the dark-store-portal UI personas.
 * Run via: npm run db:seed (after migrations)
 *
 * Idempotent: safe to re-run — looks up existing rows by email/code before inserting.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "./client.js";

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
  let businessRow = await prisma.business.findFirst({ where: { name: "Q-Commerce" } });
  if (!businessRow) {
    businessRow = await prisma.business.create({ data: { name: "Q-Commerce" } });
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // --- Business admin (maps to portal role "admin" / Sarah Jenkins) ---
  let admin = await prisma.user.findUnique({ where: { email: "admin@qcommerce.io" } });
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        businessId: businessRow.id,
        storeId: null,
        name: "Ravi Admin",
        email: "admin@qcommerce.io",
        passwordHash,
        role: "business_admin",
        status: "active",
      },
    });
  }

  // --- Store (Dark Store #402 from manager UI) ---
  let storeRow = await prisma.store.findFirst({ where: { code: "DS04" } });
  if (!storeRow) {
    storeRow = await prisma.store.create({
      data: {
        businessId: businessRow.id,
        name: "Dark Store #402",
        code: "DS04",
        address: "14 Wharf Road, London, E15 4QF, United Kingdom",
        geofence: { type: "circle", radiusKm: 5, center: { lat: 51.543, lng: -0.022 } },
        operatingHours: { timezone: "Europe/London", open: "06:00", close: "23:00" },
        facility: { totalCapacityM3: 2500, coldStorage: true },
        status: "active",
      },
    });
  }

  // --- Store manager (maps to portal role "manager" / Alex Thompson) ---
  let managerRow = await prisma.user.findUnique({ where: { email: "manager@qcommerce.io" } });
  if (!managerRow) {
    managerRow = await prisma.user.create({
      data: {
        businessId: businessRow.id,
        storeId: storeRow.id,
        name: "Krishn Manager",
        email: "manager@qcommerce.io",
        passwordHash,
        role: "store_manager",
        status: "active",
      },
    });
  }

  // Link store to its manager (resolves stores ↔ users circular reference).
  if (managerRow && !storeRow.managerUserId) {
    storeRow = await prisma.store.update({
      where: { id: storeRow.id },
      data: { managerUserId: managerRow.id },
    });
  }

  // --- Demo catalog: listed + stocked at the demo store, for the customer-app to browse ---
  for (const product of DEMO_PRODUCTS) {
    let sku = await prisma.masterCatalog.findFirst({
      where: { businessId: businessRow.id, skuCode: product.skuCode },
    });

    if (!sku) {
      sku = await prisma.masterCatalog.create({
        data: {
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
        },
      });
    } else if (!sku.description) {
      // Backfill for rows seeded before `description` was added to the demo catalog.
      sku = await prisma.masterCatalog.update({
        where: { id: sku.id },
        data: { description: product.description },
      });
    }

    let mapping = await prisma.storeSkuMapping.findUnique({
      where: { storeId_skuId: { storeId: storeRow.id, skuId: sku.id } },
    });

    if (!mapping) {
      mapping = await prisma.storeSkuMapping.create({
        data: {
          storeId: storeRow.id,
          skuId: sku.id,
          isListed: true,
          reorderThreshold: 10,
        },
      });
    }

    const existingSnapshot = await prisma.inventorySnapshot.findUnique({
      where: { storeId_skuId: { storeId: storeRow.id, skuId: sku.id } },
    });

    if (!existingSnapshot) {
      // Opening stock — a real stock_in ledger row backs the snapshot, same
      // invariant the staff portal's inventory screens rely on.
      const ledgerRow = await prisma.inventoryLedger.create({
        data: {
          storeId: storeRow.id,
          skuId: sku.id,
          type: "stock_in",
          quantity: product.initialStock,
          source: "seed",
        },
      });

      await prisma.inventorySnapshot.create({
        data: {
          storeId: storeRow.id,
          skuId: sku.id,
          availableQty: product.initialStock,
          lastLedgerId: ledgerRow.id,
        },
      });
    }
  }

  // --- Demo customer (customer-app login) ---
  let customerRow = await prisma.customer.findUnique({ where: { email: "customer@qcommerce.io" } });
  if (!customerRow) {
    customerRow = await prisma.customer.create({
      data: {
        name: "Priya Customer",
        email: "customer@qcommerce.io",
        passwordHash,
        status: "active",
      },
    });
  }

  console.log("Seed complete.");
  console.log("  Business:", businessRow.name, businessRow.id);
  console.log("  Store:   ", storeRow.name, storeRow.id);
  console.log("  Catalog: ", DEMO_PRODUCTS.length, "products listed + stocked");
  console.log("  Staff logins:    admin@qcommerce.io / manager@qcommerce.io");
  console.log("  Customer login:  customer@qcommerce.io");
  console.log("  Password:", DEMO_PASSWORD);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Seed failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
