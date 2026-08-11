import { z } from "zod";

export const addCartItemSchema = z.object({
  storeId: z.string().uuid(),
  skuId: z.string().uuid(),
  quantity: z.number().int().positive(),
});

export type AddCartItemInput = z.infer<typeof addCartItemSchema>;

export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(0),
});

export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;
