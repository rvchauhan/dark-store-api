import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Drizzle Kit reads schema from our domain-split files and writes SQL migrations
// into src/db/migrations/. Run `npm run db:generate` after schema changes.
export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
