/**
 * Dark Store API — modular monolith entry point.
 *
 * Architecture:
 *   dark-store-portal (frontend)  →  HTTP  →  dark-store-api (this service)
 *
 * Domain modules (catalog, store, inventory) live in src/modules/.
 * Shared concerns (auth, RBAC, errors) live in src/shared/.
 * Database schema is split by domain in src/db/schema/.
 *
 * Postgres only — no Redis. Snapshot reads come from inventory_snapshot table.
 */
import "dotenv/config";
import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { registerModules } from "./modules/index.js";
import { UPLOADS_DIR } from "./modules/catalog/catalog.routes.js";
import { errorHandler } from "./shared/middleware/error-handler.js";
import { pool } from "./db/client.js";

const app = express();

// Parse JSON bodies from the React frontend.
// 8mb accommodates base64-encoded product images (5MB raw) sent to /api/catalog/uploads.
app.use(express.json({ limit: "8mb" }));

// Allow the separate frontend dev servers (portal + customer-app) to call this API
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  }),
);

// Health check for Docker / load balancers
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "dark-store-api" });
});

// Product images uploaded via POST /api/catalog/uploads
app.use("/uploads", express.static(UPLOADS_DIR));

// Mount all domain modules under /api/*
registerModules(app);

// Must be registered after routes
app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  console.log(`dark-store-api listening on http://localhost:${env.PORT}`);
  console.log(`  Health:  http://localhost:${env.PORT}/health`);
  console.log(`  Auth:    POST http://localhost:${env.PORT}/api/auth/login`);
  console.log(`  Catalog: POST http://localhost:${env.PORT}/api/catalog/skus`);
});

// Graceful shutdown — drain Postgres pool before exit
async function shutdown() {
  console.log("Shutting down...");
  server.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
