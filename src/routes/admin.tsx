import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { DEFAULT_CONTENT, contentQuery } from "@/lib/content";
import { PRODUCTS, lineOptions, type OrderLine } from "@/lib/menu";
import { useServerFn } from "@tanstack/react-start";
import { adminInsights } from "@/lib/ai.functions";
import { PaymentBadge } from "@/components/PaymentBadge";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin | Chicky Drip Catering" },
      { name: "description", content: "Manage Chicky Drip site text and catering orders." },
      { property: "og:title", content: "Chicky Drip Admin" },
      { property: "og:description", content: "Owner tools." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Admin,
});

const LABELS: Record<string, string> = {
  hero_tagline: "Home: tagline", hero_title: "Home: big headline", hero_text: "Home: intro text",
  menu_intro: "Menu intro", flavors_intro: "Flavors intro", rewards_title: "Rewards headline",
  rewards_text: "Rewards text", order_note: "Order page note", footer_text: "Footer text",
};

function Admin() {
  const { isAdmin, loading } = useAuth();
  const [tab, setTab] = useState<"orders" | "insights" | "words">("orders");
  if (loading) return null;
  if (!isAdmin) return <main className="mx-auto max-w-xl px-4 py-16 text-center text-muted-foreground">Admins only.</main>;
  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="text-fire text-6xl">Admin</h1>
      <div className="mt-6 flex gap-2">
        {(["orders", "insights", "words"] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-full px-5 py-1 font-display text-xl ${tab === k ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
            {k === "orders" ? "Orders" : k === "insights" ? "AI Insights" : "Edit Words"}
          </button>
        ))}
      </div>
      {tab === "orders" ? <Orders /> : tab === "insights" ? <Insights /> : <Words />}
    </main>
  );
}

function Words() {
  const qc = useQueryClient();
  const { data } = useQuery(contentQuery);
  const [vals, setVals] = useState<Record<string, string>>(DEFAULT_CONTENT);
  useEffect(() => { if (data) setVals(data); }, [data]);
  const save = async () => {
    const rows = Object.keys(DEFAULT_CONTENT).map((key) => ({ key, value: vals[key] ?? "", updated_at: new Date().toISOString() }));
    const { error } = await supabase.from("site_content").upsert(rows);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved!");
    qc.invalidateQueries({ queryKey: ["site_content"] });
  };
  const input = "w-full rounded-lg border-2 border-border bg-background px-3 py-2 outline-none focus:border-accent";
  return (
    <div className="mt-6 space-y-4">
      {Object.keys(DEFAULT_CONTENT).map((k) => {
        const m = k.match(/^flavor_(\d+)(_desc|_heat)?$/);
        const label = LABELS[k] ?? (m ? `Flavor ${m[1]} ${m[2] === "_desc" ? "description" : m[2] === "_heat" ? "heat level" : "name"}` : k);
        const long = (vals[k] ?? "").length > 60;
        return (
          <label key={k} className="block">
            <span className="text-sm text-accent">{label}</span>
            {long ? (
              <textarea className={input} rows={2} value={vals[k] ?? ""} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />
            ) : (
              <input className={input} value={vals[k] ?? ""} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />
            )}
          </label>
        );
      })}
      <button onClick={save} className="sticky bottom-4 rounded-full bg-primary px-8 py-3 font-display text-2xl text-primary-foreground">Save Changes</button>
    </div>
  );
}

function Orders() {
  const qc = useQueryClient();
  const { data: content } = useQuery(contentQuery);
  const { data } = useQuery({
    queryKey: ["all_orders"],
    queryFn: async () => (await supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(200)).data ?? [],
  });
  const [showUnpaid, setShowUnpaid] = useState(false);
  const visible = (data ?? []).filter((o) => showUnpaid || (o.payment_status !== "pending" && o.payment_status !== "failed"));
  const setStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("orders").update({ status }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["all_orders"] });
  };
  return (
    <div className="mt-6 space-y-4">
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" checked={showUnpaid} onChange={(e) => setShowUnpaid(e.target.checked)} />
        Show unpaid / abandoned PayPal checkouts
      </label>
      {visible.length === 0 && <p className="text-muted-foreground">No orders yet.</p>}
      {visible.map((o) => (
        <div key={o.id} className="rounded-2xl border-2 border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="font-display text-2xl">{o.customer_name} · {o.phone}</div>
              <div className="text-sm text-muted-foreground">Placed {new Date(o.created_at).toLocaleString()}{o.event_date && ` · Event ${o.event_date}`}</div>
            </div>
            <div className="text-right">
              <div className="font-display text-3xl text-drip">${Number(o.total).toFixed(2)}</div>
              <PaymentBadge status={o.payment_status} />
              {o.used_reward && <div className="text-xs text-drip">Free meal used</div>}
              {o.paypal_capture_id && <div className="text-xs text-muted-foreground">PayPal capture {o.paypal_capture_id}</div>}
            </div>
          </div>
          <ul className="mt-3 text-sm">
            {(o.items as OrderLine[]).map((l, i) => (
              <li key={i}>{l.qty} × {PRODUCTS[l.product]?.name}{l.flavor ? ` — ${content?.[l.flavor] ?? l.flavor}` : ""}<div className="text-muted-foreground">{lineOptions(l)}{l.dip ? ` · Free dip: ${content?.[l.dip] ?? l.dip}` : ""}</div></li>
            ))}
          </ul>
          {o.notes && <p className="mt-2 text-sm italic text-muted-foreground">{o.notes}</p>}
          <select className="mt-3 rounded-lg border-2 border-border bg-background px-3 py-1" value={o.status} onChange={(e) => setStatus(o.id, e.target.value)}>
            {["new", "confirmed", "completed", "cancelled"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}

function Insights() {
  const insightsFn = useServerFn(adminInsights);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Awaited<ReturnType<typeof adminInsights>> | null>(null);
  const run = async () => {
    setBusy(true);
    try { setRes(await insightsFn()); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not load insights"); }
    finally { setBusy(false); }
  };
  const s = res?.stats;
  return (
    <div className="mt-6 space-y-4">
      <Button onClick={run} disabled={busy} className="font-display text-xl"><Sparkles />{busy ? "Thinking…" : "Summarize paid orders"}</Button>
      {res && s && (
        <div className="rounded-2xl border-2 border-accent bg-card p-5">
          <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">{res.source === "ai" ? "AI summary" : "Rule-based summary (AI not configured)"}</span>
          <p className="mt-3 whitespace-pre-line">{res.summary}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            {[["Paid orders", String(s.paidOrders)], ["PayPal revenue", `$${s.revenue.toFixed(2)}`], ["Avg order", `$${s.averageOrder.toFixed(2)}`], ["Events next 7 days", String(s.eventsNext7Days)]].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-secondary p-3"><div className="text-xs text-muted-foreground">{k}</div><div className="font-display text-2xl">{v}</div></div>
            ))}
          </div>
          {s.topFlavors.length > 0 && <p className="mt-3 text-sm">Top flavors: {s.topFlavors.map((f) => `${f.name} (${f.qty})`).join(", ")}</p>}
        </div>
      )}
    </div>
  );
}
