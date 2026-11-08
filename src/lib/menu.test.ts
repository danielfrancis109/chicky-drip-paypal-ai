import { describe, it, expect } from "vitest";
import { computeOrder, rewardStatus, PRODUCTS, SIDE_IDS, SODA_CHOICES, validateOrderLine, canCancelOrder } from "./menu";

describe("pricing", () => {
  it("mini wing/thigh is $1.50 each", () => expect(PRODUCTS.mini1.price).toBe(1.5));
  it("6 piece mini is $9", () => expect(PRODUCTS.mini6.price).toBe(9));
  it("free meal takes $15 off", () =>
    expect(computeOrder([{ product: "mini6", flavor: "flavor_1", qty: 3 }], true).total).toBe(12));
});

describe("meal options and extras", () => {
  it("six-piece with any included side stays $9", () => {
    for (const side of SIDE_IDS) {
      const line = { product: "mini6" as const, flavor: "flavor_1", dip: "flavor_1", qty: 1, side };
      expect(() => validateOrderLine(line)).not.toThrow();
      expect(computeOrder([line], false).total).toBe(9);
    }
  });
  it("three-piece with one included side stays $9", () => {
    expect(computeOrder([{ product: "large3", flavor: "flavor_1", qty: 1, side: "rice" }], false).total).toBe(9);
  });
  it("both $9 meals require a side", () => {
    for (const product of ["mini6", "large3"] as const) expect(() => validateOrderLine({ product, flavor: "flavor_1", dip: "flavor_1", qty: 1 })).toThrow("Choose your included side");
  });
  it("dips cost 75 cents each", () => expect(computeOrder([{ product: "dip", flavor: "flavor_1", qty: 2 }], false).total).toBe(1.5));
  it("sodas cost $2.50 with the requested choices", () => {
    expect(SODA_CHOICES).toEqual(["Dr Pepper", "Coke", "Pepsi", "Sprite", "Fanta"]);
    expect(PRODUCTS.soda.price).toBe(2.5);
    expect(() => validateOrderLine({ product: "soda", drink: "Sprite", qty: 1 })).not.toThrow();
    expect(() => validateOrderLine({ product: "soda", drink: "Unknown", qty: 1 })).toThrow();
  });
  it("apple juice costs $3.50", () => {
    expect(PRODUCTS.juice.price).toBe(3.5);
    expect(() => validateOrderLine({ product: "juice", drink: "Apple Juice", qty: 1 })).not.toThrow();
  });
  it("sandwich cole slaw is optional without changing its price", () => {
    for (const slaw of [true, false]) {
      const line = { product: "sandwich" as const, flavor: "flavor_1", dip: "flavor_1", slaw, qty: 1 };
      expect(() => validateOrderLine(line)).not.toThrow();
      expect(computeOrder([line], false).total).toBe(8);
    }
  });
});

describe("free dip and cancellation", () => {
  it("the preselected free dip is valid and included in the $9 meal", () => {
    const line = { product: "mini6" as const, flavor: "flavor_1", dip: "flavor_1", side: "fries" as const, qty: 1 };
    expect(() => validateOrderLine(line)).not.toThrow();
    expect(computeOrder([line], false).total).toBe(9);
    expect(() => validateOrderLine({ ...line, dip: "invalid" })).toThrow("Choose your free dip");
  });
  it("two extra dips add $1.50 beyond the included dip", () => {
    expect(computeOrder([{ product: "mini6", flavor: "flavor_1", dip: "flavor_1", side: "rice", qty: 1 }, { product: "dip", flavor: "flavor_2", qty: 2 }], false).total).toBe(10.5);
  });
  it("removing an item removes its charge", () => {
    const lines = [{ product: "soda" as const, drink: "Coke", qty: 1 }, { product: "dip" as const, flavor: "flavor_1", qty: 1 }];
    expect(computeOrder(lines.filter((_, i) => i !== 0), false).total).toBe(0.75);
  });
  it("customers can cancel active orders but not completed or already cancelled orders", () => {
    expect(canCancelOrder("new")).toBe(true);
    expect(canCancelOrder("confirmed")).toBe(true);
    expect(canCancelOrder("completed")).toBe(false);
    expect(canCancelOrder("cancelled")).toBe(false);
  });
});

describe("rewards", () => {
  it("10 orders earns one free meal", () => expect(rewardStatus(10, 0).available).toBe(1));
  it("9 orders earns none, 1 to go", () => {
    expect(rewardStatus(9, 0).available).toBe(0);
    expect(rewardStatus(9, 0).toNext).toBe(1);
  });
});
