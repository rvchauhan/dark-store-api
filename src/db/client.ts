import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { schema } from "./schema/index.js";

// Single Postgres pool for the modular monolith.
// When splitting microservices, each service gets its own pool + connection string.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });

// Expose pool for graceful shutdown in index.ts
export { pool };
