/**
 * Applies pending Prisma migrations.
 * Run via: npm run db:migrate
 */
import "dotenv/config";
import { execSync } from "node:child_process";

try {
  console.log("Running migrations...");
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
  console.log("Migrations complete.");
} catch {
  console.error("Migration failed.");
  process.exit(1);
}
