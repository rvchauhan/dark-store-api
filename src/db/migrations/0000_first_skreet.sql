CREATE TYPE "public"."catalog_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('stock_in', 'sale', 'damage', 'return', 'adjustment', 'correction');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('low_stock', 'qty_mismatch', 'ledger_drift', 'store_verification_pending');--> statement-breakpoint
CREATE TYPE "public"."store_status" AS ENUM('onboarding', 'active', 'inactive', 'closed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('business_admin', 'store_manager', 'store_employee');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('invited', 'active', 'disabled');--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"store_id" uuid,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"status" "user_status" DEFAULT 'invited' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"address" text NOT NULL,
	"geofence" jsonb NOT NULL,
	"operating_hours" jsonb NOT NULL,
	"facility" jsonb,
	"status" "store_status" DEFAULT 'onboarding' NOT NULL,
	"manager_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "master_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"category" text,
	"barcode" text,
	"base_price" numeric(10, 2) NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"unit_of_measure" text NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"status" "catalog_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "master_catalog_business_barcode_unique" UNIQUE("business_id","barcode")
);
--> statement-breakpoint
CREATE TABLE "store_sku_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"price_override" numeric(10, 2),
	"is_listed" boolean DEFAULT false NOT NULL,
	"reorder_threshold" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_sku_mapping_store_sku_unique" UNIQUE("store_id","sku_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"type" "ledger_entry_type" NOT NULL,
	"quantity" integer NOT NULL,
	"reference_id" uuid,
	"employee_id" uuid,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_snapshot" (
	"store_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"available_qty" integer DEFAULT 0 NOT NULL,
	"last_ledger_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_snapshot_pkey" PRIMARY KEY("store_id","sku_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"store_id" uuid,
	"sku_id" uuid,
	"type" "notification_type" NOT NULL,
	"payload" jsonb,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_catalog" ADD CONSTRAINT "master_catalog_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_sku_mapping" ADD CONSTRAINT "store_sku_mapping_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_sku_mapping" ADD CONSTRAINT "store_sku_mapping_sku_id_master_catalog_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."master_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_store_sku_mapping_fk" FOREIGN KEY ("store_id","sku_id") REFERENCES "public"."store_sku_mapping"("store_id","sku_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_snapshot" ADD CONSTRAINT "inventory_snapshot_last_ledger_id_inventory_ledger_id_fk" FOREIGN KEY ("last_ledger_id") REFERENCES "public"."inventory_ledger"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_snapshot" ADD CONSTRAINT "inventory_snapshot_store_sku_mapping_fk" FOREIGN KEY ("store_id","sku_id") REFERENCES "public"."store_sku_mapping"("store_id","sku_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_sku_id_master_catalog_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."master_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_ledger_store_sku_time" ON "inventory_ledger" USING btree ("store_id","sku_id","created_at");