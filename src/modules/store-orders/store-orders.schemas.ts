import { z } from "zod";
import { normalizeHttpUrl } from "../../shared/utils/http-url.js";

/** Query for GET /api/stores/:storeId/orders */
export const listOrdersQuerySchema = z.object({
  status: z.enum(["active", "all", "fulfilled"]).default("active"),
});

export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

/** Query for GET /api/stores/network-orders (business admin) */
export const listNetworkOrdersQuerySchema = z.object({
  status: z.enum(["active", "all", "fulfilled"]).default("all"),
  storeId: z.string().uuid().optional(),
});

export type ListNetworkOrdersQuery = z.infer<typeof listNetworkOrdersQuerySchema>;

const orderStatuses = [
  "placed",
  "confirmed",
  "preparing",
  "out_for_delivery",
  "fulfilled",
  "cancelled",
] as const;

/**
 * Body for PATCH /api/stores/:storeId/orders/:orderId/status
 *
 * riderName/riderPhone are required (here or already stored on the order)
 * when transitioning to out_for_delivery — enforced in the service, since
 * that's where the current status is known.
 */
export const updateOrderStatusSchema = z.object({
  status: z.enum(orderStatuses),
  riderName: z.string().min(1).optional(),
  riderPhone: z.string().min(1).optional(),
  trackingName: z.string().min(1).optional(),
  trackingNumber: z.string().min(1).optional(),
  trackingUrl: z
    .string()
    .min(1)
    .transform((value, ctx) => {
      const url = normalizeHttpUrl(value);
      if (!url) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid tracking URL" });
        return z.NEVER;
      }
      return url;
    })
    .optional(),
});

export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
