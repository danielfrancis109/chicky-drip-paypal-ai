import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeOrder, rewardStatus, PRODUCTS, validateOrderLine, canCancelOrder, type ProductId } from "./menu";

const schema = z.object({
  customer_name: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(7).max(30),
  event_date: z.string().max(20).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  use_reward: z.boolean(),
  items: z
    .array(
      z.object({
        product: z.enum(Object.keys(PRODUCTS) as [ProductId, ...ProductId[]]),
        flavor: z.string().optional(),
        qty: z.number().int().min(1).max(500),
        side: z.enum(["fries", "coleslaw", "rice"]).optional(),
        slaw: z.boolean().optional(),
        drink: z.string().max(40).optional(),
        dip: z.string().optional(),
      }),
    )
    .min(1)
    .max(50),
});

export const placeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => schema.parse(d))
  .handler(async ({ data, context }) => {
    for (const l of data.items) validateOrderLine(l);
    const { data: past, error: pastError } = await context.supabase
      .from("orders")
      .select("used_reward,status")
      .eq("user_id", context.userId)
      .neq("status", "cancelled");
    if (pastError) throw new Error("Could not check your rewards. Please try again.");
    const paid = (past ?? []).filter((o) => !o.used_reward).length;
    const used = (past ?? []).filter((o) => o.used_reward).length;
    if (data.use_reward && rewardStatus(paid, used).available < 1) throw new Error("No free meal available yet");
    const totals = computeOrder(data.items, data.use_reward);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("orders").insert({
      user_id: context.userId,
      customer_name: data.customer_name,
      phone: data.phone,
      event_date: data.event_date || null,
      notes: data.notes || null,
      items: data.items,
      ...totals,
      used_reward: data.use_reward,
    });
    if (error) throw new Error(error.message);
    return totals;
  });

export const cancelOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: order, error } = await context.supabase.from("orders")
      .select("id,user_id,status").eq("id", data.id).eq("user_id", context.userId).maybeSingle();
    if (error || !order) throw new Error("Order not found");
    if (!canCancelOrder(order.status)) throw new Error("This order can no longer be cancelled");
    // Customers cannot update totals or items; this authorized operation changes only status.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: updated, error: updateError } = await supabaseAdmin.from("orders")
      .update({ status: "cancelled" }).eq("id", data.id).eq("user_id", context.userId)
      .in("status", ["new", "confirmed"]).select("id").maybeSingle();
    if (updateError || !updated) throw new Error("Could not cancel this order. Please refresh and try again.");
    return { id: updated.id, status: "cancelled" };
  });
