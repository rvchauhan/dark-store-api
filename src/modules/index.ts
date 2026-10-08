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
import { adminPartnerKeysRouter } from "./partner-keys/partner-keys.routes.js";
import { partnerRouter } from "./partner/partner.routes.js";
import { blockApiKeyAuth } from "../shared/middleware/auth.js";

/**
 * Module registry — the single place that wires domain modules into Express.
 *
 * Microservice migration path:
 *   1. Extract module folder + its Prisma models into a new repo
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
  // Operator-only key issuance. Guarded by ADMIN_API_SECRET, not by staff auth,
  // so it is deliberately mounted outside both identity domains.
  app.use("/api/admin/partner-keys", adminPartnerKeysRouter);

  // Platform partner key only — Shopify install provisioning (create org + admin + JWT).
  app.use("/api/partner", partnerRouter);

  // Identity operations act on a specific person, so a partner key — which
  // belongs to an organization — must never reach them. Notably this keeps
  // POST /api/auth/invite-manager (which creates users) off the key surface.
  app.use("/api/auth", blockApiKeyAuth, authRouter);

  // Partner-reachable staff routes. requireAuth resolves either credential and
  // rejects mutations from keys that lack the "write" scope.
  app.use("/api/catalog", catalogRouter);
  app.use("/api/stores", storeRouter);
  // Inventory routes are nested under a store: /api/stores/:storeId/inventory/*
  app.use("/api/stores/:storeId/inventory", inventoryRouter);
  // Staff-facing order fulfillment, nested the same way: /api/stores/:storeId/orders/*
  app.use("/api/stores/:storeId/orders", storeOrdersRouter);
  app.use("/api/geo", geoRouter);
  app.use("/api/analytics", analyticsRouter);

  // Customer-facing storefront app — separate identity from staff auth above,
  // so partner keys are rejected here too.
  app.use("/api/customer-auth", blockApiKeyAuth, customerAuthRouter);
  app.use("/api/storefront", blockApiKeyAuth, storefrontRouter);
  app.use("/api/cart", blockApiKeyAuth, cartRouter);
  app.use("/api/orders", blockApiKeyAuth, ordersRouter);
}
