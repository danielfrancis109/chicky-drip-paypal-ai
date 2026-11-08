// Core checkout logic (server-only). Pure-ish: all I/O comes in through `deps`, so it is unit-tested
// with a fake order store and a mocked fetch for PayPal (see src/lib/checkout.test.ts).
import type { CheckoutInput } from "./checkout.schema";
import {
  computeOrder,
  meterStatus,
  PRODUCTS,
  toPayPalAmount,
  validateOrderLine,
  type MeterOrder,
  type OrderLine,
} from "./menu";
import { completedCapture, PayPalError, type PayPalClient } from "./paypal.server";

export type StoredOrder = MeterOrder & {
  id: string;
  user_id: string;
  total: number;
  paypal_order_id?: string | null;
};

/** Minimal persistence surface; implemented with Supabase in checkout.functions.ts. */
export interface OrderStore {
  listUserOrders(userId: string): Promise<StoredOrder[]>;
  insertOrder(row: Record<string, unknown>): Promise<{ id: string }>;
  updateOrder(id: string, patch: Record<string, unknown>): Promise<void>;
  findByPayPalId(
    userId: string,
    paypalOrderId: string,
  ): Promise<(StoredOrder & { subtotal: number; discount: number }) | null>;
}

export type FlavorName = (id: string) => string;

export function paypalItems(lines: OrderLine[], flavorName: FlavorName) {
  return lines.map((l) => ({
    name: [PRODUCTS[l.product].name, l.flavor ? flavorName(l.flavor) : "", l.drink ?? ""]
      .filter(Boolean)
      .join(" - "),
    quantity: l.qty,
    unitAmount: toPayPalAmount(PRODUCTS[l.product].price),
  }));
}

export type StartResult =
  | {
      mode: "paypal";
      orderId: string;
      paypalOrderId: string;
      total: number;
      subtotal: number;
      discount: number;
    }
  | {
      mode: "free";
      orderId: string;
      total: 0;
      subtotal: number;
      discount: number;
      meter: ReturnType<typeof meterStatus>;
    };

/**
 * Validate the cart, price it from the server-side menu (client prices are never trusted),
 * check reward eligibility, store a pending order and create the matching PayPal order.
 */
export async function startCheckout(
  input: CheckoutInput,
  deps: { userId: string; store: OrderStore; paypal: PayPalClient | null; flavorName: FlavorName },
): Promise<StartResult> {
  for (const l of input.items) validateOrderLine(l);
  const past = await deps.store.listUserOrders(deps.userId);
  if (input.use_reward && meterStatus(past).available < 1)
    throw new Error("No free meal available yet");
  const totals = computeOrder(input.items, input.use_reward);

  const base = {
    user_id: deps.userId,
    customer_name: input.customer_name,
    phone: input.phone,
    event_date: input.event_date || null,
    notes: input.notes || null,
    items: input.items,
    ...totals,
    used_reward: input.use_reward,
    currency: "USD",
  };

  // A free meal can cover the whole cart; PayPal cannot charge $0, so confirm it directly.
  if (totals.total <= 0) {
    const { id } = await deps.store.insertOrder({
      ...base,
      payment_status: "paid",
      status: "confirmed",
      paid_at: new Date().toISOString(),
    });
    const meter = meterStatus([
      ...past,
      { status: "confirmed", used_reward: true, payment_status: "paid" },
    ]);
    return {
      mode: "free",
      orderId: id,
      total: 0,
      subtotal: totals.subtotal,
      discount: totals.discount,
      meter,
    };
  }

  if (!deps.paypal)
    throw new Error(
      "PayPal is not configured on this server (set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET).",
    );

  const { id } = await deps.store.insertOrder({
    ...base,
    payment_status: "pending",
    status: "new",
  });
  const items = paypalItems(input.items, deps.flavorName);
  const itemTotal = toPayPalAmount(
    items.reduce((s, i) => s + Number(i.unitAmount) * i.quantity, 0),
  );
  const breakdownOk = itemTotal === toPayPalAmount(totals.subtotal);
  try {
    const order = await deps.paypal.createOrder({
      referenceId: id,
      amount: toPayPalAmount(totals.total),
      description: `Chicky Drip catering order ${id.slice(0, 8)}`,
      ...(breakdownOk ? { items, itemTotal, discount: toPayPalAmount(totals.discount) } : {}),
    });
    await deps.store.updateOrder(id, { paypal_order_id: order.id });
    return { mode: "paypal", orderId: id, paypalOrderId: order.id, ...totals };
  } catch (err) {
    await deps.store.updateOrder(id, { payment_status: "failed", status: "cancelled" });
    throw err;
  }
}

export type FinishResult =
  | {
      ok: true;
      orderId: string;
      captureId: string;
      alreadyPaid: boolean;
      meter: ReturnType<typeof meterStatus>;
    }
  | { ok: false; retry: true; message: string };

/**
 * Capture an approved PayPal order, verify the captured amount matches what we priced, then mark
 * the order paid (which is what fills the Drip Meter).
 */
export async function finishCheckout(
  paypalOrderId: string,
  deps: { userId: string; store: OrderStore; paypal: PayPalClient | null },
): Promise<FinishResult> {
  if (!deps.paypal) throw new Error("PayPal is not configured on this server.");
  const row = await deps.store.findByPayPalId(deps.userId, paypalOrderId);
  if (!row) throw new Error("Order not found");

  const meterAfter = async () => meterStatus(await deps.store.listUserOrders(deps.userId));
  if (row.payment_status === "paid") {
    return {
      ok: true,
      orderId: row.id,
      captureId: "",
      alreadyPaid: true,
      meter: await meterAfter(),
    };
  }
  if (row.status === "cancelled") throw new Error("This order was cancelled");

  // Re-check the reward right before money moves (two tabs could try to spend one reward).
  if (row.used_reward) {
    const others = (await deps.store.listUserOrders(deps.userId)).filter((o) => o.id !== row.id);
    if (meterStatus(others).available < 1)
      throw new Error("Your free meal was already used on another order");
  }

  let captured;
  try {
    captured = await deps.paypal.captureOrder(paypalOrderId);
  } catch (err) {
    if (err instanceof PayPalError && err.issue === "INSTRUMENT_DECLINED") {
      return {
        ok: false,
        retry: true,
        message: "Your payment method was declined. Please choose another.",
      };
    }
    if (err instanceof PayPalError && err.issue === "ORDER_ALREADY_CAPTURED") {
      captured = await deps.paypal.getOrder(paypalOrderId);
    } else throw err;
  }

  const capture = completedCapture(captured);
  if (captured.status !== "COMPLETED" || !capture)
    throw new Error(`Payment not completed (PayPal status ${captured.status})`);
  if (
    capture.amount.currency_code !== "USD" ||
    capture.amount.value !== toPayPalAmount(Number(row.total))
  ) {
    await deps.store.updateOrder(row.id, {
      payment_status: "failed",
      paypal_capture_id: capture.id,
    });
    throw new Error(
      "Captured amount does not match the order total. The owner has been flagged to review it.",
    );
  }

  await deps.store.updateOrder(row.id, {
    payment_status: "paid",
    status: "confirmed",
    paypal_capture_id: capture.id,
    paid_at: new Date().toISOString(),
  });
  return {
    ok: true,
    orderId: row.id,
    captureId: capture.id,
    alreadyPaid: false,
    meter: await meterAfter(),
  };
}
