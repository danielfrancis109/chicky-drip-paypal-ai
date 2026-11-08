export const PRICE_PER_MINI = 1.5;
export const REWARD_EVERY = 10;
export const REWARD_VALUE = 15;

export type ProductId = "mini6" | "mini1" | "large3" | "sandwich" | "fries" | "coleslaw" | "rice" | "dip" | "soda" | "juice";
export type SideId = "fries" | "coleslaw" | "rice";
export const SIDE_IDS: SideId[] = ["fries", "coleslaw", "rice"];
export const SODA_CHOICES = ["Dr Pepper", "Coke", "Pepsi", "Sprite", "Fanta"];
export const JUICE_CHOICES = ["Apple Juice"];
export const includesSide = (product: ProductId) => product === "mini6" || product === "large3";

export const PRODUCTS: Record<ProductId, { name: string; price: number; needsFlavor: boolean; group: "chicken" | "side" | "extra" | "drink" }> = {
  mini6: { name: "6 Piece Mini Drum & Thigh", price: PRICE_PER_MINI * 6, needsFlavor: true, group: "chicken" },
  mini1: { name: "Mini Wing or Thigh (each)", price: PRICE_PER_MINI, needsFlavor: true, group: "chicken" },
  large3: { name: "3 Piece Large Drum", price: 9, needsFlavor: true, group: "chicken" },
  sandwich: { name: "Chicken Sandwich", price: 8, needsFlavor: true, group: "chicken" },
  fries: { name: "Fries", price: 3.5, needsFlavor: false, group: "side" },
  coleslaw: { name: "Cole Slaw", price: 3.5, needsFlavor: false, group: "side" },
  rice: { name: "Rice", price: 3.5, needsFlavor: false, group: "side" },
  dip: { name: "Extra Dip", price: 0.75, needsFlavor: true, group: "extra" },
  soda: { name: "Soda", price: 2.5, needsFlavor: false, group: "drink" },
  juice: { name: "Juice", price: 3.5, needsFlavor: false, group: "drink" },
};

export const FLAVOR_IDS = Array.from({ length: 10 }, (_, i) => `flavor_${i + 1}`);

export type OrderLine = { product: ProductId; flavor?: string | undefined; qty: number; side?: SideId | undefined; slaw?: boolean | undefined; drink?: string | undefined; dip?: string | undefined };
export const canCancelOrder = (status: string) => status === "new" || status === "confirmed";

export function validateOrderLine(line: OrderLine) {
  if (PRODUCTS[line.product].needsFlavor && !FLAVOR_IDS.includes(line.flavor ?? "")) throw new Error("Pick a flavor");
  if (PRODUCTS[line.product].group === "chicken" && !FLAVOR_IDS.includes(line.dip ?? "")) throw new Error("Choose your free dip");
  if (line.dip && PRODUCTS[line.product].group !== "chicken") throw new Error("Free dips come with chicken");
  if (includesSide(line.product) && (!line.side || !SIDE_IDS.includes(line.side))) throw new Error("Choose your included side");
  if (line.side && !includesSide(line.product)) throw new Error("This item does not include a side");
  if (line.slaw && line.product !== "sandwich") throw new Error("Cole slaw topping is only for sandwiches");
  const drinks = line.product === "soda" ? SODA_CHOICES : line.product === "juice" ? JUICE_CHOICES : [];
  if (drinks.length && !drinks.includes(line.drink ?? "")) throw new Error("Choose your drink");
  if (line.drink && !drinks.length) throw new Error("Add a drink separately");
}

export function lineOptions(line: OrderLine) {
  return [line.side ? `Side: ${PRODUCTS[line.side].name}` : "", line.product === "sandwich" ? (line.slaw ? "With cole slaw" : "No cole slaw") : "", line.drink ?? ""].filter(Boolean).join(" · ");
}

const round = (n: number) => Math.round(n * 100) / 100;

export function computeOrder(lines: OrderLine[], useReward: boolean) {
  const subtotal = round(lines.reduce((s, l) => s + PRODUCTS[l.product].price * l.qty, 0));
  const discount = useReward ? Math.min(REWARD_VALUE, subtotal) : 0;
  return { subtotal, discount: round(discount), total: round(subtotal - discount) };
}

export function rewardStatus(paidOrders: number, rewardsUsed: number) {
  const earned = Math.floor(paidOrders / REWARD_EVERY);
  return {
    progress: paidOrders % REWARD_EVERY,
    available: Math.max(0, earned - rewardsUsed),
    toNext: REWARD_EVERY - (paidOrders % REWARD_EVERY),
  };
}
