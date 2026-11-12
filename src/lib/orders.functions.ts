import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canCustomerCancel } from "./menu";

// Order placement now goes through PayPal checkout: see checkout.functions.ts (createPayPalOrder /
// capturePayPalOrder). The old unpaid "placeOrder" request flow was replaced in the hackathon update.

export const cancelOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: order, error } = await context.supabase.from("orders")
      .select("id,user_id,status,payment_status").eq("id", data.id).eq("user_id", context.userId).maybeSingle();
    if (error || !order) throw new Error("Order not found");
    if (order.payment_status === "paid") throw new Error("This order is paid. Please contact Chicky Drip to cancel and get a refund.");
    if (!canCustomerCancel(order)) throw new Error("This order can no longer be cancelled");
    // Customers cannot update totals or items; this authorized operation changes only status.
    const { getServerDb } = await import("@/integrations/supabase/server-db.server");
    const updated = await (await getServerDb())
      .cancelOrder(data.id, context.userId)
      .catch(() => null);
    if (!updated) throw new Error("Could not cancel this order. Please refresh and try again.");
    return { id: updated.id, status: "cancelled" };
  });
