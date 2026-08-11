/**
 * Re-exports all Drizzle table definitions.
 * Drizzle Kit and the DB client import from this single entry point.
 */
export * from "./enums.js";
export * from "./tenant.js";
export * from "./catalog.js";
export * from "./store.js";
export * from "./inventory.js";
export * from "./customer.js";
export * from "./order.js";

import * as tenant from "./tenant.js";
import * as catalog from "./catalog.js";
import * as store from "./store.js";
import * as inventory from "./inventory.js";
import * as customer from "./customer.js";
import * as order from "./order.js";

// Used by Drizzle relational queries if we add them later.
export const schema = {
  ...tenant,
  ...catalog,
  ...store,
  ...inventory,
  ...customer,
  ...order,
};
