// Shared (client + server) validation for checkout input.
import { z } from "zod";
import { PRODUCTS, type ProductId } from "./menu";

export const orderLineSchema = z.object({
  product: z.enum(Object.keys(PRODUCTS) as [ProductId, ...ProductId[]]),
  flavor: z.string().max(20).optional(),
  qty: z.number().int().min(1).max(500),
  side: z.enum(["fries", "coleslaw", "rice"]).optional(),
  slaw: z.boolean().optional(),
  drink: z.string().max(40).optional(),
  dip: z.string().max(20).optional(),
});

export const checkoutSchema = z.object({
  customer_name: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(7).max(30),
  event_date: z.string().max(20).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  use_reward: z.boolean(),
  items: z.array(orderLineSchema).min(1).max(50),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;
