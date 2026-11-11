// Live PayPal sandbox smoke test using the app's own server code (no Supabase needed: in-memory store).
// Usage: bun scripts/paypal-sandbox-smoke.ts            -> creates orders, prints approve links
//        bun scripts/paypal-sandbox-smoke.ts capture ID -> captures an order you approved in the browser
// Reads PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_ENV from .env (Bun loads it). Never prints secrets.
import { createPayPalClient, readPayPalConfig, completedCapture } from "../src/lib/paypal.server";
import { startCheckout, type OrderStore, type StoredOrder } from "../src/lib/checkout.server";
import type { CheckoutInput } from "../src/lib/checkout.schema";

const cfg = readPayPalConfig();
if (!cfg) throw new Error("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env");
if (cfg.env !== "sandbox") throw new Error("Refusing to run against live PayPal");
const paypal = createPayPalClient(cfg);

if (process.argv[2] === "capture") {
  const id = process.argv[3];
  if (!id) throw new Error("usage: capture <paypalOrderId>");
  const res = await paypal.captureOrder(id);
  const c = completedCapture(res);
  console.log(
    JSON.stringify(
      { id: res.id, status: res.status, capture: c, payer: res.payer?.email_address },
      null,
      2,
    ),
  );
  process.exit(0);
}

const rows: Array<StoredOrder & Record<string, unknown>> = [];
const history: StoredOrder[] = Array.from({ length: 10 }, (_, i) => ({
  id: `h${i}`,
  user_id: "reward-user",
  status: "completed",
  used_reward: false,
  payment_status: "paid",
  total: 9,
}));
let n = 0;
const store: OrderStore = {
  listUserOrders: async (uid) => [...history, ...rows].filter((r) => r.user_id === uid),
  insertOrder: async (row) => {
    const id = crypto.randomUUID();
    n++;
    rows.push({ ...(row as StoredOrder), id });
    return { id };
  },
  updateOrder: async (id, patch) => {
    Object.assign(
      rows.find((r) => r.id === id)!,
      patch,
    );
  },
  findByPayPalId: async () => null,
};
const names: Record<string, string> = {
  flavor_1: "Honey Drip",
  flavor_8: "Buffalo Bounce",
  flavor_9: "Nashville Fire",
  flavor_4: "Sweet Heat Swirl",
};
const flavorName = (id: string) => names[id] ?? id;

const base = {
  customer_name: "Sandbox Tester",
  phone: "410-555-0100",
  event_date: "2026-11-20",
  notes: "sandbox smoke test",
};
const cart: CheckoutInput["items"] = [
  { product: "mini6", flavor: "flavor_8", dip: "flavor_8", side: "fries", qty: 20 },
  { product: "mini6", flavor: "flavor_1", dip: "flavor_1", side: "coleslaw", qty: 20 },
  { product: "mini1", flavor: "flavor_9", dip: "flavor_9", qty: 7 },
  { product: "dip", flavor: "flavor_4", qty: 3 },
  { product: "sandwich", flavor: "flavor_8", dip: "flavor_8", slaw: true, qty: 2 },
  { product: "soda", drink: "Dr Pepper", qty: 25 },
  { product: "juice", drink: "Apple Juice", qty: 3 },
];
const cases: Array<[string, string, CheckoutInput]> = [
  ["catering cart", "sample-user", { ...base, use_reward: false, items: cart }],
  [
    "with $15 reward",
    "reward-user",
    { ...base, use_reward: true, items: cart.slice(0, 1).map((l) => ({ ...l, qty: 4 })) },
  ],
];
for (const [label, userId, input] of cases) {
  const res = await startCheckout(input, { userId, store, paypal, flavorName });
  if (res.mode !== "paypal") throw new Error("expected paypal");
  const order = await paypal.getOrder(res.paypalOrderId);
  const pu = order.purchase_units?.[0] as any;
  const approve = (order as any).links?.find(
    (l: any) => l.rel === "payer-action" || l.rel === "approve",
  )?.href;
  const itemSum = (pu.items ?? []).reduce(
    (s: number, i: any) => s + Number(i.unit_amount.value) * Number(i.quantity),
    0,
  );
  console.log(
    JSON.stringify(
      {
        case: label,
        server: { subtotal: res.subtotal, discount: res.discount, total: res.total },
        paypal: {
          id: order.id,
          status: order.status,
          amount: pu.amount,
          items: pu.items?.length,
          itemSum: itemSum.toFixed(2),
          custom_id: pu.custom_id,
        },
        approve,
        ok:
          pu.amount.value === res.total.toFixed(2) &&
          itemSum.toFixed(2) === res.subtotal.toFixed(2),
      },
      null,
      2,
    ),
  );
}
