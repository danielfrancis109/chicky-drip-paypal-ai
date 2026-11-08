// Owner insights over orders. Pure; used by adminInsights and unit-tested.
import { PRODUCTS, type OrderLine } from "../menu";
import type { FlavorInfo } from "./catering-plan";

export type InsightOrder = {
  items: OrderLine[];
  total: number | string;
  payment_status?: string | null;
  status: string;
  event_date: string | null;
  created_at: string;
  used_reward: boolean;
};

export function computeInsights(orders: InsightOrder[], flavors: FlavorInfo[], now: Date) {
  const paid = orders.filter((o) => o.payment_status === "paid" && o.status !== "cancelled");
  const revenue = Math.round(paid.reduce((s, o) => s + Number(o.total), 0) * 100) / 100;
  const flavorCount = new Map<string, number>();
  const productCount = new Map<string, number>();
  for (const o of paid)
    for (const l of o.items ?? []) {
      if (!PRODUCTS[l.product]) continue;
      productCount.set(l.product, (productCount.get(l.product) ?? 0) + l.qty);
      if (l.flavor) flavorCount.set(l.flavor, (flavorCount.get(l.flavor) ?? 0) + l.qty);
    }
  const name = (id: string) => flavors.find((f) => f.id === id)?.name ?? id;
  const top = <T>(m: Map<string, number>, label: (k: string) => T) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, n]) => ({ name: label(k), qty: n }));
  const today = now.toISOString().slice(0, 10);
  const week = new Date(now.getTime() + 7 * 864e5).toISOString().slice(0, 10);
  const upcoming = paid.filter(
    (o) => o.event_date && o.event_date >= today && o.event_date <= week,
  );
  return {
    paidOrders: paid.length,
    revenue,
    averageOrder: paid.length ? Math.round((revenue / paid.length) * 100) / 100 : 0,
    pendingCheckouts: orders.filter(
      (o) => o.payment_status === "pending" && o.status !== "cancelled",
    ).length,
    rewardsRedeemed: paid.filter((o) => o.used_reward).length,
    topFlavors: top(flavorCount, name),
    topItems: top(productCount, (k) => PRODUCTS[k as keyof typeof PRODUCTS].name),
    eventsNext7Days: upcoming.length,
    revenueNext7Days: Math.round(upcoming.reduce((s, o) => s + Number(o.total), 0) * 100) / 100,
  };
}

export type Insights = ReturnType<typeof computeInsights>;

export function insightText(s: Insights) {
  if (!s.paidOrders)
    return "No paid PayPal orders yet. Once customers check out, revenue, top flavors and upcoming events show up here.";
  const parts = [
    `${s.paidOrders} paid orders brought in $${s.revenue.toFixed(2)} (avg $${s.averageOrder.toFixed(2)}).`,
    s.topFlavors.length
      ? `Top flavors: ${s.topFlavors.map((f) => `${f.name} (${f.qty})`).join(", ")}.`
      : "",
    s.eventsNext7Days
      ? `${s.eventsNext7Days} paid event(s) in the next 7 days worth $${s.revenueNext7Days.toFixed(2)}; prep sauce for the top flavors.`
      : "No paid events in the next 7 days.",
    s.pendingCheckouts
      ? `${s.pendingCheckouts} checkout(s) were started but not paid; consider a follow-up call.`
      : "",
  ];
  return parts.filter(Boolean).join(" ");
}
