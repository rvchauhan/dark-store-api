import { z } from "zod";

const shippingAddressSchema = z
  .object({
    address1: z.string().nullish(),
    address2: z.string().nullish(),
    city: z.string().nullish(),
    zip: z.string().nullish(),
    phone: z.string().nullish(),
    name: z.string().nullish(),
    country_code: z.string().nullish(),
  })
  .nullish();

const lineItemSchema = z.object({
  variant_id: z.union([z.number(), z.string()]).nullish(),
  quantity: z.number().int().positive(),
  price: z.union([z.string(), z.number()]),
  title: z.string().optional(),
  name: z.string().optional(),
  sku: z.string().nullish(),
});

/**
 * Shopify Admin REST webhook payload for orders/create (subset we need),
 * wrapped with shop identity for the partner API.
 */
export const shopifyOrderIngestSchema = z.object({
  provider: z.string().trim().min(1).max(40).default("shopify"),
  /** Shopify shop domain, e.g. fina-gems.myshopify.com */
  externalId: z.string().trim().min(1).max(200),
  order: z.object({
    id: z.union([z.number(), z.string()]).optional(),
    admin_graphql_api_id: z.string().optional(),
    name: z.string().optional(),
    email: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      z.string().email().optional(),
    ),
    phone: z.string().nullish(),
    tags: z.string().nullish(),
    note: z.string().nullish(),
    financial_status: z.string().nullish(),
    total_price: z.union([z.string(), z.number()]).nullish(),
    total_shipping_price_set: z
      .object({
        shop_money: z
          .object({
            amount: z.union([z.string(), z.number()]).optional(),
          })
          .optional(),
      })
      .nullish(),
    shipping_address: shippingAddressSchema,
    billing_address: shippingAddressSchema,
    customer: z
      .object({
        email: z.string().nullish(),
        first_name: z.string().nullish(),
        last_name: z.string().nullish(),
        phone: z.string().nullish(),
      })
      .nullish(),
    line_items: z.array(lineItemSchema).min(1),
  }),
});

export type ShopifyOrderIngestInput = z.infer<typeof shopifyOrderIngestSchema>;
