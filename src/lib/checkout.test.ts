import { describe, expect, it, vi } from "vitest";
import { createPayPalClient, paypalApiBase, readPayPalConfig } from "./paypal.server";
import {
  finishCheckout,
  startCheckout,
  type OrderStore,
  type StoredOrder,
} from "./checkout.server";
import type { CheckoutInput } from "./checkout.schema";

const cfg = { clientId: "sb-client", clientSecret: "sb-secret", env: "sandbox" as const };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Fake PayPal sandbox: routes by URL, records requests. */
function fakePayPal(
  opts: {
    captureValue?: string;
    captureError?: { status: number; issue: string };
    orderStatus?: string;
  } = {},
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    if (url.endsWith("/v1/oauth2/token"))
      return json({ access_token: "A21-token", expires_in: 32400 });
    if (url.endsWith("/v2/checkout/orders")) {
      const body = JSON.parse(String(init?.body));
      return json({
        id: "5O190127TN364715T",
        status: "CREATED",
        purchase_units: body.purchase_units,
      });
    }
    if (url.endsWith("/capture")) {
      if (opts.captureError)
        return json(
          {
            name: "UNPROCESSABLE_ENTITY",
            details: [{ issue: opts.captureError.issue, description: "nope" }],
            debug_id: "dbg",
          },
          opts.captureError.status,
        );
      return json({
        id: "5O190127TN364715T",
        status: opts.orderStatus ?? "COMPLETED",
        purchase_units: [
          {
            payments: {
              captures: [
                {
                  id: "3C679366HH908993F",
                  status: "COMPLETED",
                  amount: { currency_code: "USD", value: opts.captureValue ?? "21.00" },
                },
              ],
            },
          },
        ],
      });
    }
    if (url.includes("/v2/checkout/orders/")) {
      return json({
        id: "5O190127TN364715T",
        status: "COMPLETED",
        purchase_units: [
          {
            payments: {
              captures: [
                {
                  id: "CAPTURED-BEFORE",
                  status: "COMPLETED",
                  amount: { currency_code: "USD", value: opts.captureValue ?? "21.00" },
                },
              ],
            },
          },
        ],
      });
    }
    return json({}, 404);
  });
  return {
    fetchImpl,
    calls,
    client: createPayPalClient(cfg, fetchImpl as unknown as typeof fetch),
  };
}

function memoryStore(initial: StoredOrder[] = []) {
  const rows: Array<StoredOrder & Record<string, unknown>> = initial.map((r) => ({ ...r }));
  let n = 0;
  const store: OrderStore = {
    listUserOrders: async (uid) => rows.filter((r) => r.user_id === uid),
    insertOrder: async (row) => {
      const id = `00000000-0000-4000-8000-00000000000${++n}`;
      rows.push({ ...(row as StoredOrder), id });
      return { id };
    },
    updateOrder: async (id, patch) => {
      Object.assign(
        rows.find((r) => r.id === id)!,
        patch,
      );
    },
    findByPayPalId: async (uid, pid) => {
      const r = rows.find((x) => x.user_id === uid && x.paypal_order_id === pid);
      return r
        ? { ...r, subtotal: Number(r["subtotal"] ?? 0), discount: Number(r["discount"] ?? 0) }
        : null;
    },
  };
  return { rows, store };
}

const paidHistory = (n: number): StoredOrder[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `h${i}`,
    user_id: "u1",
    status: "completed",
    used_reward: false,
    payment_status: "paid",
    total: 9,
  }));

const cart = (over: Partial<CheckoutInput> = {}): CheckoutInput => ({
  customer_name: "Dana",
  phone: "410-555-0100",
  event_date: "2026-11-20",
  notes: "40 people",
  use_reward: false,
  items: [{ product: "mini6", flavor: "flavor_8", dip: "flavor_8", side: "fries", qty: 4 }],
  ...over,
});
const flavorName = (id: string) => ({ flavor_8: "Buffalo Bounce" })[id] ?? id;

describe("PayPal REST client", () => {
  it("defaults to sandbox and reads env", () => {
    expect(readPayPalConfig({})).toBeNull();
    expect(readPayPalConfig({ PAYPAL_CLIENT_ID: "a", PAYPAL_CLIENT_SECRET: "b" })).toEqual({
      clientId: "a",
      clientSecret: "b",
      env: "sandbox",
    });
    expect(paypalApiBase("sandbox")).toBe("https://api-m.sandbox.paypal.com");
    expect(paypalApiBase("live")).toBe("https://api-m.paypal.com");
  });
  it("gets an OAuth token with basic auth once and reuses it", async () => {
    const { client, calls } = fakePayPal();
    await client.getOrder("X1");
    await client.getOrder("X2");
    const tokenCalls = calls.filter((c) => c.url.endsWith("/v1/oauth2/token"));
    expect(tokenCalls).toHaveLength(1);
    expect((tokenCalls[0]!.init.headers as Record<string, string>)["Authorization"]).toBe(
      `Basic ${btoa("sb-client:sb-secret")}`,
    );
    expect(tokenCalls[0]!.init.body).toBe("grant_type=client_credentials");
  });
  it("surfaces PayPal error issues", async () => {
    const { client } = fakePayPal({ captureError: { status: 422, issue: "INSTRUMENT_DECLINED" } });
    await expect(client.captureOrder("X")).rejects.toMatchObject({
      name: "PayPalError",
      status: 422,
      issue: "INSTRUMENT_DECLINED",
    });
  });
});

describe("startCheckout (create order)", () => {
  it("prices the cart on the server and creates a PayPal CAPTURE order with item breakdown", async () => {
    const pp = fakePayPal();
    const { rows, store } = memoryStore();
    const res = await startCheckout(cart(), { userId: "u1", store, paypal: pp.client, flavorName });
    expect(res).toMatchObject({
      mode: "paypal",
      paypalOrderId: "5O190127TN364715T",
      subtotal: 36,
      discount: 0,
      total: 36,
    });
    const create = pp.calls.find((c) => c.url.endsWith("/v2/checkout/orders"))!;
    const body = JSON.parse(String(create.init.body));
    expect(body.intent).toBe("CAPTURE");
    expect(body.purchase_units[0].amount).toEqual({
      currency_code: "USD",
      value: "36.00",
      breakdown: { item_total: { currency_code: "USD", value: "36.00" } },
    });
    expect(body.purchase_units[0].items[0]).toMatchObject({
      name: "6 Piece Mini Drum & Thigh - Buffalo Bounce",
      quantity: "4",
      unit_amount: { value: "9.00" },
    });
    expect(body.purchase_units[0].custom_id).toBe(rows[0]!.id);
    expect((create.init.headers as Record<string, string>)["PayPal-Request-Id"]).toBe(
      `create-${rows[0]!.id}`,
    );
    expect(rows[0]).toMatchObject({
      payment_status: "pending",
      status: "new",
      paypal_order_id: "5O190127TN364715T",
      total: 36,
    });
  });
  it("applies the free $15 meal as a PayPal discount when earned", async () => {
    const pp = fakePayPal();
    const { store } = memoryStore(paidHistory(10));
    const res = await startCheckout(cart({ use_reward: true }), {
      userId: "u1",
      store,
      paypal: pp.client,
      flavorName,
    });
    expect(res).toMatchObject({ mode: "paypal", subtotal: 36, discount: 15, total: 21 });
    const body = JSON.parse(
      String(pp.calls.find((c) => c.url.endsWith("/v2/checkout/orders"))!.init.body),
    );
    expect(body.purchase_units[0].amount.value).toBe("21.00");
    expect(body.purchase_units[0].amount.breakdown.discount.value).toBe("15.00");
  });
  it("refuses a reward that hasn't been earned", async () => {
    const { store } = memoryStore(paidHistory(9));
    await expect(
      startCheckout(cart({ use_reward: true }), {
        userId: "u1",
        store,
        paypal: fakePayPal().client,
        flavorName,
      }),
    ).rejects.toThrow("No free meal available yet");
  });
  it("rejects invalid menu choices before touching PayPal", async () => {
    const pp = fakePayPal();
    const bad = cart({
      items: [{ product: "mini6", flavor: "flavor_99", dip: "flavor_1", side: "fries", qty: 1 }],
    });
    await expect(
      startCheckout(bad, {
        userId: "u1",
        store: memoryStore().store,
        paypal: pp.client,
        flavorName,
      }),
    ).rejects.toThrow("Pick a flavor");
    expect(pp.fetchImpl).not.toHaveBeenCalled();
  });
  it("confirms fully-covered reward orders without PayPal ($0 can't be charged)", async () => {
    const pp = fakePayPal();
    const { rows, store } = memoryStore(paidHistory(10));
    const res = await startCheckout(
      cart({
        use_reward: true,
        items: [{ product: "sandwich", flavor: "flavor_8", dip: "flavor_8", qty: 1 }],
      }),
      { userId: "u1", store, paypal: pp.client, flavorName },
    );
    expect(res).toMatchObject({ mode: "free", total: 0, discount: 8 });
    expect(pp.fetchImpl).not.toHaveBeenCalled();
    expect(rows.at(-1)).toMatchObject({ payment_status: "paid", used_reward: true });
  });
  it("errors clearly when PayPal isn't configured", async () => {
    await expect(
      startCheckout(cart(), { userId: "u1", store: memoryStore().store, paypal: null, flavorName }),
    ).rejects.toThrow(/PAYPAL_CLIENT_ID/);
  });
});

describe("finishCheckout (capture)", () => {
  async function started(history: StoredOrder[] = [], useReward = false, opts = {}) {
    const pp = fakePayPal(opts);
    const mem = memoryStore(history);
    const res = await startCheckout(cart({ use_reward: useReward }), {
      userId: "u1",
      store: mem.store,
      paypal: pp.client,
      flavorName,
    });
    if (res.mode !== "paypal") throw new Error("expected paypal");
    return { pp, mem, res };
  }
  it("captures, verifies the amount, marks paid and fills the Drip Meter", async () => {
    const { pp, mem, res } = await started(paidHistory(3), false, { captureValue: "36.00" });
    const out = await finishCheckout(res.paypalOrderId, {
      userId: "u1",
      store: mem.store,
      paypal: pp.client,
    });
    expect(out).toMatchObject({
      ok: true,
      captureId: "3C679366HH908993F",
      alreadyPaid: false,
      meter: { progress: 4 },
    });
    expect(mem.rows.at(-1)).toMatchObject({
      payment_status: "paid",
      status: "confirmed",
      paypal_capture_id: "3C679366HH908993F",
    });
    expect(mem.rows.at(-1)!["paid_at"]).toBeTruthy();
    const cap = pp.calls.find((c) => c.url.endsWith("/capture"))!;
    expect((cap.init.headers as Record<string, string>)["PayPal-Request-Id"]).toBe(
      `capture-${res.paypalOrderId}`,
    );
  });
  it("redeeming the reward resets available free meals", async () => {
    const { pp, mem, res } = await started(paidHistory(10), true, { captureValue: "21.00" });
    const out = await finishCheckout(res.paypalOrderId, {
      userId: "u1",
      store: mem.store,
      paypal: pp.client,
    });
    expect(out).toMatchObject({ ok: true, meter: { available: 0 } });
  });
  it("is idempotent when the order is already paid", async () => {
    const { pp, mem, res } = await started([], false, { captureValue: "36.00" });
    await finishCheckout(res.paypalOrderId, { userId: "u1", store: mem.store, paypal: pp.client });
    const again = await finishCheckout(res.paypalOrderId, {
      userId: "u1",
      store: mem.store,
      paypal: pp.client,
    });
    expect(again).toMatchObject({ ok: true, alreadyPaid: true });
    expect(pp.calls.filter((c) => c.url.endsWith("/capture"))).toHaveLength(1);
  });
  it("refuses to mark paid if PayPal captured a different amount", async () => {
    const { pp, mem, res } = await started([], false, { captureValue: "1.00" });
    await expect(
      finishCheckout(res.paypalOrderId, { userId: "u1", store: mem.store, paypal: pp.client }),
    ).rejects.toThrow(/does not match/);
    expect(mem.rows.at(-1)).toMatchObject({ payment_status: "failed" });
  });
  it("asks the buyer to retry on INSTRUMENT_DECLINED", async () => {
    const { pp, mem, res } = await started([], false, {
      captureError: { status: 422, issue: "INSTRUMENT_DECLINED" },
    });
    const out = await finishCheckout(res.paypalOrderId, {
      userId: "u1",
      store: mem.store,
      paypal: pp.client,
    });
    expect(out).toMatchObject({ ok: false, retry: true });
    expect(mem.rows.at(-1)).toMatchObject({ payment_status: "pending" });
  });
  it("recovers when PayPal says ORDER_ALREADY_CAPTURED", async () => {
    const { pp, mem, res } = await started([], false, {
      captureValue: "36.00",
      captureError: { status: 422, issue: "ORDER_ALREADY_CAPTURED" },
    });
    const out = await finishCheckout(res.paypalOrderId, {
      userId: "u1",
      store: mem.store,
      paypal: pp.client,
    });
    expect(out).toMatchObject({ ok: true, captureId: "CAPTURED-BEFORE" });
  });
  it("won't capture another user's order", async () => {
    const { pp, mem, res } = await started();
    await expect(
      finishCheckout(res.paypalOrderId, {
        userId: "intruder",
        store: mem.store,
        paypal: pp.client,
      }),
    ).rejects.toThrow("Order not found");
  });
});
