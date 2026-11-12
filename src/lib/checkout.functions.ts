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
  if (/SUPABASE_SERVICE_ROLE_KEY|SERVER_RPC_TOKEN|Missing Supabase environment/i.test(msg))
    return new Error(
      "Checkout is not fully configured on this server yet (the order database key is missing). The Drip Planner and menu still work.",
    );
  if (/invalid_server_token|Could not find the function .*srv_|srv_\w+.*(does not exist|schema cache)/i.test(msg))
    return new Error(
      "Checkout is waiting on a database update (run supabase/migrations/20261112000000_server_rpc.sql). The Drip Planner and menu still work.",
    );
  if (/payment_status|paypal_order_id|paypal_capture_id|paid_at|currency/i.test(msg) && /column|schema cache|does not exist/i.test(msg))
    return new Error(
      "Checkout is waiting on a database update (run supabase/migrations/20261109000000_paypal_payments.sql). The Drip Planner and menu still work.",
    );
  return e instanceof Error ? e : new Error(msg);
}

async function serverDeps(userId: string) {
  const [db, { createPayPalClient, readPayPalConfig }] = await Promise.all([
    import("@/integrations/supabase/server-db.server").then((m) => m.getServerDb()),
    import("./paypal.server"),
  ]);
  const cfg = readPayPalConfig();
  const paypal = cfg ? createPayPalClient(cfg) : null;
  const store: OrderStore = {
    listUserOrders: (uid) => db.listUserOrders(uid) as Promise<StoredOrder[]>,
    insertOrder: (row) => db.insertOrder(row),
    // Updates are always scoped to the signed-in customer's own order.
    updateOrder: (id, patch) => db.updateOrder(id, userId, patch),
    findByPayPalId: (uid, paypalOrderId) => db.findByPayPalId(uid, paypalOrderId),
  };
  const names: Record<string, string> = { ...DEFAULT_CONTENT };
  for (const r of await db.siteContent()) names[r.key] = r.value;
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
