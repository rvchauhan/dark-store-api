ALTER TABLE "master_catalog" ADD COLUMN "parent_sku_id" uuid;--> statement-breakpoint
ALTER TABLE "master_catalog" ADD COLUMN "option1_name" text;--> statement-breakpoint
ALTER TABLE "master_catalog" ADD COLUMN "option1_value" text;--> statement-breakpoint
ALTER TABLE "master_catalog" ADD COLUMN "option2_name" text;--> statement-breakpoint
ALTER TABLE "master_catalog" ADD COLUMN "option2_value" text;--> statement-breakpoint
ALTER TABLE "master_catalog" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "master_catalog" ADD COLUMN "search_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "master_catalog" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "master_catalog" ADD COLUMN "meta_title" text;--> statement-breakpoint
ALTER TABLE "master_catalog" ADD COLUMN "meta_description" text;--> statement-breakpoint
ALTER TABLE "master_catalog" ADD CONSTRAINT "master_catalog_parent_sku_id_master_catalog_id_fk" FOREIGN KEY ("parent_sku_id") REFERENCES "public"."master_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_catalog" ADD CONSTRAINT "master_catalog_business_slug_unique" UNIQUE("business_id","slug");