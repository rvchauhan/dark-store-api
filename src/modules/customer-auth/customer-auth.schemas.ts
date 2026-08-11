import { z } from "zod";

export const customerLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type CustomerLoginInput = z.infer<typeof customerLoginSchema>;

export const customerRegisterSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email(),
  phone: z.string().min(5, "Phone number is required").max(40).optional(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type CustomerRegisterInput = z.infer<typeof customerRegisterSchema>;

/** Google Identity Services ID token from the frontend button */
export const customerGoogleAuthSchema = z.object({
  idToken: z.string().min(1),
});

export type CustomerGoogleAuthInput = z.infer<typeof customerGoogleAuthSchema>;
