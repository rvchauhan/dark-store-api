-- Catalog: complete Add-SKU form fields (A3).
-- NOTE: drizzle-kit also emitted users-table statements here because 0001_auth_register.sql
-- was hand-written and the snapshot lagged; those statements are already applied and were
-- removed from this file. The users_store_id FK exists in the DB but not in schema files
-- (cross-domain import) — known, intentional drift.
ALTER TABLE "master_catalog" ADD COLUMN "cost_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "master_catalog" ADD COLUMN "sku_code" text;--> statement-breakpoint
ALTER TABLE "master_catalog" ADD COLUMN "is_fragile" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "master_catalog" ADD COLUMN "requires_cold_storage" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "master_catalog" ADD COLUMN "weight_kg" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "master_catalog" ADD COLUMN "dimensions_cm" jsonb;--> statement-breakpoint
ALTER TABLE "master_catalog" ADD COLUMN "default_reorder_point" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "master_catalog" ADD COLUMN "default_initial_stock" integer;--> statement-breakpoint
ALTER TABLE "master_catalog" ADD CONSTRAINT "master_catalog_business_sku_code_unique" UNIQUE("business_id","sku_code");
