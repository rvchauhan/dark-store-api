import type { Express } from "express";
import { authRouter } from "./auth/auth.routes.js";
import { catalogRouter } from "./catalog/catalog.routes.js";
import { storeRouter } from "./store/store.routes.js";
import { inventoryRouter } from "./inventory/inventory.routes.js";
import { geoRouter } from "./geo/geo.routes.js";
import { customerAuthRouter } from "./customer-auth/customer-auth.routes.js";
import { storefrontRouter } from "./storefront/storefront.routes.js";
import { cartRouter } from "./cart/cart.routes.js";
import { ordersRouter } from "./orders/orders.routes.js";
import { storeOrdersRouter } from "./store-orders/store-orders.routes.js";
import { analyticsRouter } from "./analytics/analytics.routes.js";

/**
 * Module registry — the single place that wires domain modules into Express.
 *
 * Microservice migration path:
 *   1. Extract module folder + its schema into a new repo
 *   2. Replace direct service calls with HTTP/gRPC client
 *   3. Remove module from this registry; add reverse-proxy route instead
 *
 * Each module is self-contained:
 *   modules/<name>/
 *     ├── <name>.routes.ts   — HTTP layer (thin)
 *     ├── <name>.service.ts  — business logic + DB access
 *     └── <name>.schemas.ts  — Zod validation
 */
export function registerModules(app: Express) {
  app.use("/api/auth", authRouter);
  app.use("/api/catalog", catalogRouter);
  app.use("/api/stores", storeRouter);
  // Inventory routes are nested under a store: /api/stores/:storeId/inventory/*
  app.use("/api/stores/:storeId/inventory", inventoryRouter);
  // Staff-facing order fulfillment, nested the same way: /api/stores/:storeId/orders/*
  app.use("/api/stores/:storeId/orders", storeOrdersRouter);
  app.use("/api/geo", geoRouter);

  // Customer-facing storefront app — separate identity from staff auth above.
  app.use("/api/customer-auth", customerAuthRouter);
  app.use("/api/storefront", storefrontRouter);
  app.use("/api/cart", cartRouter);
  app.use("/api/orders", ordersRouter);
  app.use("/api/analytics", analyticsRouter);
}
