/**
 * One-shot: wipe Prisma demo seed data on :5433 and restore business data
 * from the older local Postgres on :5432, then ensure yopmail accounts exist:
 *   admin@yopmail.com  → business_admin (Dark Story Groceries)
 *   ravi@yopmail.com   → store_manager (Koramangala Dark Store)
 *
 * Run: npx tsx src/db/restore-from-local.ts
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import pg from "pg";

const TARGET = process.env.DATABASE_URL!; // docker :5433
const SOURCE = "postgresql://darkstore:darkstore@localhost:5432/darkstore";

const ADMIN_EMAIL = "admin@yopmail.com";
const RAVI_EMAIL = "ravi@yopmail.com";
const DEFAULT_PASSWORD = "abcd123";

async function main() {
  const src = new pg.Pool({ connectionString: SOURCE });
  const dst = new pg.Pool({ connectionString: TARGET });

  console.log("Clearing demo data on target...");
  await dst.query(`
    TRUNCATE TABLE
      order_items, orders, cart_items, carts, customers,
      invite_tokens, notifications,
      inventory_snapshot, inventory_ledger,
      store_sku_mapping, master_catalog, stores, users, businesses
    RESTART IDENTITY CASCADE
  `);

  console.log("Copying businesses...");
  const businesses = await src.query(`SELECT id, name, created_at FROM businesses`);
  for (const row of businesses.rows) {
    await dst.query(
      `INSERT INTO businesses (id, name, created_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [row.id, row.name, row.created_at],
    );
  }

  // Insert users without store_id first (circular FK with stores.manager_user_id)
  console.log("Copying users...");
  const users = await src.query(`
    SELECT id, business_id, store_id, name, email, password_hash, role, status, created_at
    FROM users
  `);
  for (const row of users.rows) {
    await dst.query(
      `INSERT INTO users (
         id, business_id, store_id, name, email, password_hash, role, status,
         notification_preferences, created_at
       ) VALUES ($1,$2,NULL,$3,$4,$5,$6::user_role,$7::user_status,'{}'::jsonb,$8)
       ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        row.business_id,
        row.name,
        row.email,
        row.password_hash,
        row.role,
        row.status,
        row.created_at,
      ],
    );
  }

  console.log("Copying stores...");
  const stores = await src.query(`
    SELECT id, business_id, name, address, geofence, operating_hours, status,
           manager_user_id, created_at, updated_at
    FROM stores
  `);
  for (const row of stores.rows) {
    await dst.query(
      `INSERT INTO stores (
         id, business_id, name, address, geofence, operating_hours, facility, status,
         manager_user_id, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,NULL,$7::store_status,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        row.business_id,
        row.name,
        row.address,
        JSON.stringify(row.geofence ?? {}),
        JSON.stringify(row.operating_hours ?? {}),
        row.status,
        row.manager_user_id,
        row.created_at,
        row.updated_at,
      ],
    );
  }

  // Wire users.store_id now that stores exist
  for (const row of users.rows) {
    if (!row.store_id) continue;
    await dst.query(`UPDATE users SET store_id = $1 WHERE id = $2`, [row.store_id, row.id]);
  }

  console.log("Copying catalog...");
  const catalog = await src.query(`
    SELECT id, business_id, name, brand, category, barcode, base_price, tax_rate,
           unit_of_measure, sku_code, images, status, created_at, updated_at
    FROM master_catalog
  `);
  for (const row of catalog.rows) {
    await dst.query(
      `INSERT INTO master_catalog (
         id, business_id, name, brand, category, barcode, base_price, currency,
         tax_rate, unit_of_measure, sku_code, images, specs, variant_options, variants,
         status, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,'USD',$8,$9,$10,$11::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
         $12::catalog_status,$13,$14
       ) ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        row.business_id,
        row.name,
        row.brand,
        row.category,
        row.barcode,
        row.base_price,
        row.tax_rate,
        row.unit_of_measure,
        row.sku_code,
        JSON.stringify(row.images ?? []),
        row.status,
        row.created_at,
        row.updated_at,
      ],
    );
  }

  console.log("Copying store_sku_mapping...");
  const mappings = await src.query(`
    SELECT id, store_id, sku_id, price_override, is_listed, reorder_threshold, created_at, updated_at
    FROM store_sku_mapping
  `);
  for (const row of mappings.rows) {
    await dst.query(
      `INSERT INTO store_sku_mapping (
         id, store_id, sku_id, price_override, is_listed, reorder_threshold, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        row.store_id,
        row.sku_id,
        row.price_override,
        row.is_listed,
        row.reorder_threshold,
        row.created_at,
        row.updated_at,
      ],
    );
  }

  console.log("Copying inventory_ledger...");
  const ledger = await src.query(`
    SELECT id, store_id, sku_id, type, quantity, reference_id, employee_id, source, created_at
    FROM inventory_ledger
  `);
  for (const row of ledger.rows) {
    await dst.query(
      `INSERT INTO inventory_ledger (
         id, store_id, sku_id, type, quantity, reference_id, employee_id, source, created_at
       ) VALUES ($1,$2,$3,$4::ledger_entry_type,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        row.store_id,
        row.sku_id,
        row.type,
        row.quantity,
        row.reference_id,
        row.employee_id,
        row.source,
        row.created_at,
      ],
    );
  }

  console.log("Copying inventory_snapshot...");
  const snapshots = await src.query(`
    SELECT store_id, sku_id, available_qty, last_ledger_id, updated_at
    FROM inventory_snapshot
  `);
  for (const row of snapshots.rows) {
    await dst.query(
      `INSERT INTO inventory_snapshot (store_id, sku_id, available_qty, last_ledger_id, updated_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (store_id, sku_id) DO UPDATE
         SET available_qty = EXCLUDED.available_qty,
             last_ledger_id = EXCLUDED.last_ledger_id,
             updated_at = EXCLUDED.updated_at`,
      [row.store_id, row.sku_id, row.available_qty, row.last_ledger_id, row.updated_at],
    );
  }

  // Primary tenant restored from local Postgres
  const koramangalaId = "1212dce6-3bcc-4800-9de8-80301d9c19b0";
  const businessId = "8140ecaf-e404-4512-9cef-c25208f7be31";
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  // Drop empty Q-Commerce demo tenant left over from seed (Sarah Jenkins / admin@qcommerce.io)
  await dst.query(
    `DELETE FROM users WHERE business_id = (SELECT id FROM businesses WHERE name = 'Q-Commerce' LIMIT 1)`,
  );
  await dst.query(`DELETE FROM businesses WHERE name = 'Q-Commerce'`);

  // admin@yopmail.com — business_admin for Dark Story Groceries
  const adminExisting = await dst.query(`SELECT id FROM users WHERE email = $1`, [ADMIN_EMAIL]);
  if (adminExisting.rows[0]) {
    await dst.query(
      `UPDATE users SET
         name = 'Ravi Admin',
         password_hash = $1,
         role = 'business_admin',
         status = 'active',
         store_id = NULL,
         business_id = $2
       WHERE id = $3`,
      [passwordHash, businessId, adminExisting.rows[0].id],
    );
    console.log("Updated existing", ADMIN_EMAIL);
  } else {
    await dst.query(
      `INSERT INTO users (
         business_id, store_id, name, email, password_hash, role, status, notification_preferences
       ) VALUES ($1,NULL,'Ravi Admin',$2,$3,'business_admin','active','{}'::jsonb)`,
      [businessId, ADMIN_EMAIL, passwordHash],
    );
    console.log("Created", ADMIN_EMAIL);
  }

  // ravi@yopmail.com — store_manager on Koramangala
  const existing = await dst.query(`SELECT id FROM users WHERE email = $1`, [RAVI_EMAIL]);
  let raviId: string;
  if (existing.rows[0]) {
    raviId = existing.rows[0].id;
    await dst.query(
      `UPDATE users SET
         name = 'Ravi',
         password_hash = $1,
         role = 'store_manager',
         status = 'active',
         store_id = $2,
         business_id = $3
       WHERE id = $4`,
      [passwordHash, koramangalaId, businessId, raviId],
    );
    console.log("Updated existing", RAVI_EMAIL);
  } else {
    const created = await dst.query(
      `INSERT INTO users (
         business_id, store_id, name, email, password_hash, role, status, notification_preferences
       ) VALUES ($1,$2,'Ravi',$3,$4,'store_manager','active','{}'::jsonb)
       RETURNING id`,
      [businessId, koramangalaId, RAVI_EMAIL, passwordHash],
    );
    raviId = created.rows[0].id;
    console.log("Created", RAVI_EMAIL);
  }

  await dst.query(`UPDATE stores SET manager_user_id = $1, updated_at = now() WHERE id = $2`, [
    raviId,
    koramangalaId,
  ]);

  const summary = await dst.query(`
    SELECT 'users' t, count(*)::text c FROM users
    UNION ALL SELECT 'stores', count(*)::text FROM stores
    UNION ALL SELECT 'catalog', count(*)::text FROM master_catalog
    UNION ALL SELECT 'mappings', count(*)::text FROM store_sku_mapping
  `);
  console.log("Restore complete:", Object.fromEntries(summary.rows.map((r) => [r.t, r.c])));
  console.log(`Admin login:   ${ADMIN_EMAIL} / ${DEFAULT_PASSWORD}`);
  console.log(`Manager login: ${RAVI_EMAIL} / ${DEFAULT_PASSWORD}`);

  await src.end();
  await dst.end();
}

main().catch(async (err) => {
  console.error("Restore failed:", err);
  process.exit(1);
});
