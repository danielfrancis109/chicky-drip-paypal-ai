import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PRODUCTS, FLAVOR_IDS, SIDE_IDS, SODA_CHOICES, JUICE_CHOICES, includesSide, lineOptions, validateOrderLine, computeOrder, type OrderLine, type ProductId, type SideId } from "@/lib/menu";
import { useContent } from "@/lib/content";
import { useAuth } from "@/lib/auth";
import { useMyOrders } from "@/lib/useMyOrders";
import { createPayPalOrder } from "@/lib/checkout.functions";
import { PayPalCheckout } from "@/components/PayPalCheckout";
import { CateringAssistant } from "@/components/CateringAssistant";
import { DripMeter } from "@/components/DripMeter";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/order")({
  head: () => ({
    meta: [
      { title: "Order Catering | Chicky Drip" },
      { name: "description", content: "Build your Chicky Drip catering order and earn reward points." },
      { property: "og:title", content: "Order Chicky Drip Catering" },
      { property: "og:description", content: "Pick your chicken, flavor and sides." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OrderPage,
});

function OrderPage() {
  const t = useContent();
  const { user, loading } = useAuth();
  const { status } = useMyOrders(user?.id);
  const qc = useQueryClient();
  const nav = useNavigate();
  const freeFn = useServerFn(createPayPalOrder);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [product, setProduct] = useState<ProductId>("mini6");
  const [flavor, setFlavor] = useState("flavor_1");
  const [dip, setDip] = useState("flavor_1");
  const [side, setSide] = useState<SideId>("fries");
  const [slaw, setSlaw] = useState(false);
  const [drink, setDrink] = useState("Dr Pepper");
  const [qty, setQty] = useState(1);
  const [form, setForm] = useState({ customer_name: "", phone: "", event_date: "", notes: "" });
  const [useReward, setUseReward] = useState(false);
  const [busy, setBusy] = useState(false);

  const totals = computeOrder(lines, useReward && status.available > 0);
  const input = "min-w-0 w-full rounded-lg border-2 border-border bg-background px-3 py-2 outline-none focus:border-accent";

  const add = () => {
    const needs = PRODUCTS[product].needsFlavor;
    if (!Number.isInteger(qty) || qty < 1 || qty > 500) { toast.error("Choose a quantity from 1 to 500"); return; }
    const line: OrderLine = { product, flavor: needs ? flavor : undefined, qty,
      side: includesSide(product) ? side : undefined,
      slaw: product === "sandwich" ? slaw : undefined,
      drink: PRODUCTS[product].group === "drink" ? drink : undefined,
      dip: PRODUCTS[product].group === "chicken" ? dip : undefined,
    };
    try { validateOrderLine(line); } catch (err) { toast.error(err instanceof Error ? err.message : "Check your choices"); return; }
    setLines((current) => [...current, line]);
    setQty(1);
  };

  const payload = { ...form, items: lines, use_reward: useReward && status.available > 0 };
  const validate = () => {
    if (!lines.length) return "Add something to your order first";
    if (!form.customer_name.trim()) return "Enter your name";
    if (form.phone.trim().length < 7) return "Enter a phone number we can call";
    return null;
  };
  const paid = async (msg: string) => {
    toast.success(msg);
    setLines([]); setUseReward(false);
    await qc.invalidateQueries({ queryKey: ["my_orders"] });
    await qc.invalidateQueries({ queryKey: ["all_orders"] });
    nav({ to: "/rewards" });
  };
  const redeemFree = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validate();
    if (problem) { toast.error(problem); return; }
    setBusy(true);
    try {
      await freeFn({ data: payload });
      await paid("Free meal redeemed! We'll call to confirm.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not place order");
    }
    setBusy(false);
  };

  if (!loading && !user)
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-fire text-6xl">Ready to Order?</h1>
        <p className="mt-3 text-muted-foreground">Sign in or create an account so every order earns points toward a free meal.</p>
        <Link to="/auth" className="mt-6 inline-block rounded-full bg-primary px-8 py-3 font-display text-2xl text-primary-foreground">Sign in / Join</Link>
      </main>
    );

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 py-12 lg:grid-cols-[1fr_380px]">
      <div>
        <h1 className="text-fire text-6xl">Build Your Order</h1>
        <p className="mt-2 text-muted-foreground">{t("order_note")}</p>
        <CateringAssistant onAdd={(planned) => setLines((current) => [...current, ...planned].slice(0, 50))} />
        <div className="mt-6 grid gap-3 border-y-2 border-primary py-5 sm:grid-cols-2">
          <label className="min-w-0 text-sm text-muted-foreground">Item
          <select aria-label="Item" className={input} value={product} onChange={(e) => {
            const next = e.target.value as ProductId;
            setProduct(next); setDrink(next === "juice" ? "Apple Juice" : "Dr Pepper");
          }}>
            {Object.entries(PRODUCTS).map(([id, p]) => <option key={id} value={id}>{p.name} — ${p.price.toFixed(2)}</option>)}
          </select></label>
          {PRODUCTS[product].needsFlavor && <label className="min-w-0 text-sm text-muted-foreground">{product === "dip" ? "Extra dip · $0.75" : "Chicken flavor"}
          <select aria-label={product === "dip" ? "Extra dip flavor" : "Chicken flavor"} className={input} value={flavor} onChange={(e) => setFlavor(e.target.value)}>
            {FLAVOR_IDS.map((f) => <option key={f} value={f}>{t(f)} ({t(`${f}_heat`)})</option>)}
          </select></label>}
          {includesSide(product) && <label className="text-sm text-muted-foreground">Included side · Free
            <select aria-label="Included side" className={input} value={side} onChange={(e) => setSide(e.target.value as SideId)}>
              {SIDE_IDS.map((id) => <option key={id} value={id}>{PRODUCTS[id].name}</option>)}
            </select>
          </label>}
          {PRODUCTS[product].group === "chicken" && <label className="min-w-0 text-sm text-muted-foreground">One dip included · Free
            <select aria-label="Free dip" className={input} value={dip} onChange={(e) => setDip(e.target.value)}>
              {FLAVOR_IDS.map((id) => <option key={id} value={id}>{t(id)}</option>)}
            </select>
          </label>}
          {PRODUCTS[product].group === "drink" && <label className="text-sm text-muted-foreground">Drink choice
            <select aria-label="Drink choice" className={input} value={drink} onChange={(e) => setDrink(e.target.value)}>
              {(product === "soda" ? SODA_CHOICES : JUICE_CHOICES).map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>}
          {product === "sandwich" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={slaw} onChange={(e) => setSlaw(e.target.checked)} />Add cole slaw</label>}
          <label className="text-sm text-muted-foreground">Quantity<input aria-label="Quantity" className={input} type="number" min={1} max={500} value={qty} onChange={(e) => setQty(Number(e.target.value))} /></label>
          <Button type="button" onClick={add} className="self-end font-display text-xl"><Plus />Add item</Button>
          <Button type="button" variant="outline" onClick={() => { setProduct("dip"); setFlavor(dip); }} className="sm:col-span-2"><Plus />Extra dips · $0.75 each</Button>
        </div>

        <form onSubmit={redeemFree} className="mt-6 grid gap-3 rounded-2xl border-2 border-border bg-card p-5 sm:grid-cols-2">
          <input className={input} required maxLength={100} placeholder="Your name" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
          <input className={input} required maxLength={30} placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <label className="text-sm text-muted-foreground sm:col-span-2">Event date
            <input className={input} type="date" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} />
          </label>
          <textarea className={`${input} sm:col-span-2`} maxLength={1000} rows={3} placeholder="Notes (headcount, pickup or delivery, allergies)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          {status.available > 0 && (
            <label className="flex items-center gap-2 sm:col-span-2">
              <input type="checkbox" checked={useReward} onChange={(e) => setUseReward(e.target.checked)} />
              Use my free meal ($15 off)
            </label>
          )}
          <div className="sm:col-span-2">
            <h2 className="mb-2 text-2xl">Pay with PayPal{totals.total > 0 ? ` · $${totals.total.toFixed(2)}` : ""}</h2>
            {!lines.length ? (
              <p className="text-sm text-muted-foreground">Add items (or use the Drip Planner) to check out.</p>
            ) : totals.total <= 0 ? (
              <Button type="submit" disabled={busy || !user} className="h-12 w-full font-display text-2xl text-primary-foreground">
                {busy ? "Placing..." : "Redeem free meal"}
              </Button>
            ) : (
              <PayPalCheckout payload={payload} validate={validate} onPaid={() => paid("Paid! Your order is confirmed and your Drip Meter just filled up.")} />
            )}
          </div>
        </form>
      </div>

      <aside className="space-y-6">
        <div className="rounded-2xl border-2 border-drip bg-card p-5">
          <h2 className="text-3xl text-drip">Your Order</h2>
          {lines.length === 0 && <p className="mt-2 text-muted-foreground">Nothing yet.</p>}
          {lines.map((l, i) => (
            <div key={i} className="flex items-start justify-between border-b border-dashed border-border py-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium">{l.qty} × {PRODUCTS[l.product].name}</div>
                {l.flavor && <div className="text-accent">{t(l.flavor)}</div>}
                {lineOptions(l) && <div className="text-muted-foreground">{lineOptions(l)}</div>}
                {l.dip && <div className="text-drip">Free dip: {t(l.dip)}</div>}
              </div>
              <div className="ml-3 shrink-0 text-right">
                ${(PRODUCTS[l.product].price * l.qty).toFixed(2)}
                <Button type="button" variant="ghost" size="icon" title={`Remove ${PRODUCTS[l.product].name}`} aria-label={`Remove ${PRODUCTS[l.product].name}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            </div>
          ))}
          <div className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>${totals.subtotal.toFixed(2)}</span></div>
            {totals.discount > 0 && <div className="flex justify-between text-drip"><span>Free meal</span><span>-${totals.discount.toFixed(2)}</span></div>}
            <div className="flex justify-between font-display text-3xl"><span>Total</span><span className="text-drip">${totals.total.toFixed(2)}</span></div>
          </div>
        </div>
        <DripMeter {...status} />
      </aside>
    </main>
  );
}
