/**
 * Idempotent: ensure admin@yopmail.com + ravi@yopmail.com on the live API DB
 * without wiping/restoring. Safe to re-run.
 *
 * Run: npx tsx src/db/ensure-yopmail-accounts.ts
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "./client.js";

const ADMIN_EMAIL = "admin@yopmail.com";
const RAVI_EMAIL = "ravi@yopmail.com";
const DEFAULT_PASSWORD = "abcd123";
const PRIMARY_BUSINESS_ID = "8140ecaf-e404-4512-9cef-c25208f7be31";
const KORAMANGALA_STORE_ID = "1212dce6-3bcc-4800-9de8-80301d9c19b0";

async function main() {
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  // Remove empty Q-Commerce demo tenant if present
  const demoBusiness = await prisma.business.findFirst({ where: { name: "Q-Commerce" } });
  if (demoBusiness) {
    const demoUsers = await prisma.user.count({ where: { businessId: demoBusiness.id } });
    const demoStores = await prisma.store.count({ where: { businessId: demoBusiness.id } });
    const demoCatalog = await prisma.masterCatalog.count({ where: { businessId: demoBusiness.id } });
    if (demoUsers > 0 && demoStores === 0 && demoCatalog === 0) {
      await prisma.user.deleteMany({ where: { businessId: demoBusiness.id } });
      await prisma.business.delete({ where: { id: demoBusiness.id } });
      console.log("Removed empty Q-Commerce demo tenant");
    }
  }

  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    create: {
      businessId: PRIMARY_BUSINESS_ID,
      name: "Ravi Admin",
      email: ADMIN_EMAIL,
      passwordHash,
      role: "business_admin",
      status: "active",
    },
    update: {
      businessId: PRIMARY_BUSINESS_ID,
      name: "Ravi Admin",
      passwordHash,
      role: "business_admin",
      status: "active",
      storeId: null,
    },
  });
  console.log("Ensured", ADMIN_EMAIL);

  const manager = await prisma.user.upsert({
    where: { email: RAVI_EMAIL },
    create: {
      businessId: PRIMARY_BUSINESS_ID,
      storeId: KORAMANGALA_STORE_ID,
      name: "Ravi",
      email: RAVI_EMAIL,
      passwordHash,
      role: "store_manager",
      status: "active",
    },
    update: {
      businessId: PRIMARY_BUSINESS_ID,
      storeId: KORAMANGALA_STORE_ID,
      name: "Ravi",
      passwordHash,
      role: "store_manager",
      status: "active",
    },
  });

  await prisma.store.update({
    where: { id: KORAMANGALA_STORE_ID },
    data: { managerUserId: manager.id },
  });
  console.log("Ensured", RAVI_EMAIL);

  console.log(`Admin login:   ${ADMIN_EMAIL} / ${DEFAULT_PASSWORD}`);
  console.log(`Manager login: ${RAVI_EMAIL} / ${DEFAULT_PASSWORD}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
