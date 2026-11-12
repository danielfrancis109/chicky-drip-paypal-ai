// TanStack Start server functions for PayPal checkout. Server-only modules are loaded with dynamic
// import inside handlers because *.functions.ts files are also referenced from client code.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_CONTENT } from "./content-defaults";
import { checkoutSchema } from "./checkout.schema";
import type { OrderStore, StoredOrder } from "./checkout.server";

/** Public PayPal settings for the JS SDK. The client id is public by design; the secret never leaves the server. */
export const getPayPalConfig = createServerFn({ method: "GET" }).handler(async () => {
  const clientId = process.env["PAYPAL_CLIENT_ID"]?.trim() || null;
  const env = process.env["PAYPAL_ENV"] === "live" ? "live" : "sandbox";
  return {
    clientId,
    env,
    currency: "USD" as const,
    configured: !!clientId && !!process.env["PAYPAL_CLIENT_SECRET"],
  };
});

/** Turn infrastructure problems (host missing the service-role key, migration not applied yet) into one clear message. */
function friendlyCheckoutSetupError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/SUPABASE_SERVICE_ROLE_KEY|Missing Supabase environment/i.test(msg))
    return new Error(
      "Checkout is not fully configured on this server yet (the order database key is missing). The Drip Planner and menu still work.",
    );
  if (/payment_status|paypal_order_id|paypal_capture_id|paid_at|currency/i.test(msg) && /column|schema cache|does not exist/i.test(msg))
    return new Error(
      "Checkout is waiting on a database update (run supabase/migrations/20261109000000_paypal_payments.sql). The Drip Planner and menu still work.",
    );
  return e instanceof Error ? e : new Error(msg);
}

async function serverDeps(userId: string) {
  const [{ supabaseAdmin }, { createPayPalClient, readPayPalConfig }] = await Promise.all([
    import("@/integrations/supabase/client.server"),
    import("./paypal.server"),
  ]);
  const cfg = readPayPalConfig();
  const paypal = cfg ? createPayPalClient(cfg) : null;
  const columns =
    "id,user_id,status,used_reward,payment_status,total,subtotal,discount,paypal_order_id";
  const store: OrderStore = {
    async listUserOrders(uid) {
      const { data, error } = await supabaseAdmin.from("orders").select(columns).eq("user_id", uid);
      if (error) throw new Error("Could not check your rewards. Please try again.");
      return (data ?? []).map((o) => ({ ...o, total: Number(o.total) })) as StoredOrder[];
    },
    async insertOrder(row) {
      const { data, error } = await supabaseAdmin
        .from("orders")
        .insert(row as never)
        .select("id")
        .single();
      if (error || !data) throw new Error(error?.message ?? "Could not save order");
      return { id: data.id };
    },
    async updateOrder(id, patch) {
      const { error } = await supabaseAdmin
        .from("orders")
        .update(patch as never)
        .eq("id", id)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
    },
    async findByPayPalId(uid, paypalOrderId) {
      const { data, error } = await supabaseAdmin
        .from("orders")
        .select(columns)
        .eq("user_id", uid)
        .eq("paypal_order_id", paypalOrderId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data
        ? {
            ...data,
            total: Number(data.total),
            subtotal: Number(data.subtotal),
            discount: Number(data.discount),
          }
        : null;
    },
  };
  const { data: content } = await supabaseAdmin.from("site_content").select("key,value");
  const names: Record<string, string> = { ...DEFAULT_CONTENT };
  for (const r of content ?? []) names[r.key] = r.value;
  return { store, paypal, flavorName: (id: string) => names[id] ?? id };
}

/** Step 1 (PayPal button createOrder): price the cart server-side and create a PayPal order. */
export const createPayPalOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => checkoutSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { startCheckout } = await import("./checkout.server");
    const deps = await serverDeps(context.userId).catch((e) => {
      throw friendlyCheckoutSetupError(e);
    });
    return startCheckout(data, { userId: context.userId, ...deps }).catch((e) => {
      throw friendlyCheckoutSetupError(e);
    });
  });

/** Step 2 (PayPal button onApprove): capture, verify amount, mark paid, fill the Drip Meter. */
export const capturePayPalOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        paypalOrderId: z
          .string()
          .min(5)
          .max(64)
          .regex(/^[A-Z0-9-]+$/i),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { finishCheckout } = await import("./checkout.server");
    const deps = await serverDeps(context.userId).catch((e) => {
      throw friendlyCheckoutSetupError(e);
    });
    return finishCheckout(data.paypalOrderId, {
      userId: context.userId,
      store: deps.store,
      paypal: deps.paypal,
    });
  });
