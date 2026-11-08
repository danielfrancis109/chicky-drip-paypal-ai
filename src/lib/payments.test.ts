import { describe, expect, it } from "vitest";
import { canCustomerCancel, computeOrder, meterStatus, toPayPalAmount } from "./menu";
import { checkoutSchema } from "./checkout.schema";

const paid = (n: number, used_reward = false) =>
  Array.from({ length: n }, () => ({ status: "confirmed", used_reward, payment_status: "paid" }));

describe("Drip Meter counts only paid or legacy orders", () => {
  it("abandoned (pending) and failed checkouts don't fill the meter", () => {
    const s = meterStatus([
      ...paid(3),
      { status: "new", used_reward: false, payment_status: "pending" },
      { status: "cancelled", used_reward: false, payment_status: "failed" },
    ]);
    expect(s.progress).toBe(3);
  });
  it("legacy pay-at-pickup orders keep counting", () => {
    expect(
      meterStatus([
        ...paid(5),
        ...Array.from({ length: 5 }, () => ({
          status: "completed",
          used_reward: false,
          payment_status: "legacy",
        })),
      ]).available,
    ).toBe(1);
  });
  it("10 paid orders = 1 free meal, redeeming it uses it up", () => {
    expect(meterStatus(paid(10)).available).toBe(1);
    expect(meterStatus([...paid(10), ...paid(1, true)]).available).toBe(0);
  });
  it("a pending order that wants the reward does not consume it until paid", () => {
    expect(
      meterStatus([...paid(10), { status: "new", used_reward: true, payment_status: "pending" }])
        .available,
    ).toBe(1);
  });
  it("cancelled paid orders don't count", () => {
    expect(
      meterStatus([...paid(9), { status: "cancelled", used_reward: false, payment_status: "paid" }])
        .progress,
    ).toBe(9);
  });
});

describe("pricing for PayPal", () => {
  it("formats amounts with two decimals", () => {
    expect(toPayPalAmount(12)).toBe("12.00");
    expect(toPayPalAmount(10.5)).toBe("10.50");
    expect(toPayPalAmount(0.1 + 0.2)).toBe("0.30");
  });
  it("$15 reward is a discount capped at the subtotal", () => {
    expect(
      computeOrder(
        [{ product: "mini6", flavor: "flavor_1", dip: "flavor_1", side: "fries", qty: 4 }],
        true,
      ),
    ).toEqual({ subtotal: 36, discount: 15, total: 21 });
    expect(
      computeOrder([{ product: "sandwich", flavor: "flavor_1", dip: "flavor_1", qty: 1 }], true),
    ).toEqual({ subtotal: 8, discount: 8, total: 0 });
  });
  it("client-sent prices/totals are stripped by the checkout schema", () => {
    const parsed = checkoutSchema.parse({
      customer_name: "A",
      phone: "5555555555",
      use_reward: false,
      total: 0.01,
      items: [
        {
          product: "mini6",
          qty: 1,
          price: 0.01,
          flavor: "flavor_1",
          dip: "flavor_1",
          side: "fries",
        },
      ],
    });
    expect(parsed).not.toHaveProperty("total");
    expect(parsed.items[0]).not.toHaveProperty("price");
  });
});

describe("cancellation", () => {
  it("paid PayPal orders can't be self-cancelled (need a refund)", () => {
    expect(canCustomerCancel({ status: "confirmed", payment_status: "paid" })).toBe(false);
    expect(canCustomerCancel({ status: "new", payment_status: "pending" })).toBe(true);
    expect(canCustomerCancel({ status: "new", payment_status: "legacy" })).toBe(true);
  });
});
