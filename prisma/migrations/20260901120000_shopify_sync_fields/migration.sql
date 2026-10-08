-- Shopify sync: link catalog SKUs and customer orders to the merchant's Shopify store.

ALTER TABLE "master_catalog"
  ADD COLUMN "shopify_product_id" TEXT,
  ADD COLUMN "shopify_variant_id" TEXT;

ALTER TABLE "orders"
  ADD COLUMN "shopify_order_id" TEXT,
  ADD COLUMN "order_number" TEXT;

CREATE INDEX "idx_orders_order_number" ON "orders" ("order_number");
