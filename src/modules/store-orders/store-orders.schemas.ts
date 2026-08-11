import { z } from "zod";

/** Query for GET /api/stores/:storeId/orders */
export const listOrdersQuerySchema = z.object({
  status: z.enum(["active", "all"]).default("active"),
});

export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

const orderStatuses = [
  "placed",
  "confirmed",
  "preparing",
  "out_for_delivery",
  "delivered",
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
  trackingUrl: z.string().min(1).optional(),
});

export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
