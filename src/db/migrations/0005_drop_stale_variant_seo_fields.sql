-- Corrective migration: 0004 applied a full per-row variant model (parent_sku_id,
-- option1/2 name+value) plus unrelated SEO fields (slug, meta_title, meta_description,
-- search_tags) that were never wired into any service/route code and predate this
-- session's schema.ts (no matching declarations exist). Confirmed with the project
-- owner as stale/abandoned — removing them here rather than editing 0004's history.
-- `currency` from 0004 is kept as-is; it already matches the lightweight variants design.
ALTER TABLE "master_catalog" DROP CONSTRAINT IF EXISTS "master_catalog_parent_sku_id_master_catalog_id_fk";--> statement-breakpoint
ALTER TABLE "master_catalog" DROP CONSTRAINT IF EXISTS "master_catalog_business_slug_unique";--> statement-breakpoint
ALTER TABLE "master_catalog" DROP COLUMN IF EXISTS "parent_sku_id";--> statement-breakpoint
ALTER TABLE "master_catalog" DROP COLUMN IF EXISTS "option1_name";--> statement-breakpoint
ALTER TABLE "master_catalog" DROP COLUMN IF EXISTS "option1_value";--> statement-breakpoint
ALTER TABLE "master_catalog" DROP COLUMN IF EXISTS "option2_name";--> statement-breakpoint
ALTER TABLE "master_catalog" DROP COLUMN IF EXISTS "option2_value";--> statement-breakpoint
ALTER TABLE "master_catalog" DROP COLUMN IF EXISTS "search_tags";--> statement-breakpoint
ALTER TABLE "master_catalog" DROP COLUMN IF EXISTS "slug";--> statement-breakpoint
ALTER TABLE "master_catalog" DROP COLUMN IF EXISTS "meta_title";--> statement-breakpoint
ALTER TABLE "master_catalog" DROP COLUMN IF EXISTS "meta_description";--> statement-breakpoint
ALTER TABLE "master_catalog" ADD COLUMN "compare_at_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "master_catalog" ADD COLUMN "allow_backorder" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "master_catalog" ADD COLUMN "variant_options" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "master_catalog" ADD COLUMN "variants" jsonb DEFAULT '[]'::jsonb NOT NULL;
