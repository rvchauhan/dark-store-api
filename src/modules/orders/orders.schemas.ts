import { z } from "zod";

export const deliveryAddressSchema = z.object({
  line1: z.string().min(1, "Address is required"),
  line2: z.string().optional(),
  city: z.string().min(1, "City is required"),
  postalCode: z.string().min(1, "Postal code is required"),
  phone: z.string().min(5, "Phone number is required"),
});

export const checkoutSchema = z.object({
  deliveryAddress: deliveryAddressSchema,
  paymentMethod: z.enum(["upi", "card"]),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
