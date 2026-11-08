import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { DEFAULT_CONTENT, contentQuery } from "@/lib/content";
import { PRODUCTS, lineOptions, type OrderLine } from "@/lib/menu";

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
  const [tab, setTab] = useState<"orders" | "words">("orders");
  if (loading) return null;
  if (!isAdmin) return <main className="mx-auto max-w-xl px-4 py-16 text-center text-muted-foreground">Admins only.</main>;
  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="text-fire text-6xl">Admin</h1>
      <div className="mt-6 flex gap-2">
        {(["orders", "words"] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-full px-5 py-1 font-display text-xl ${tab === k ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
            {k === "orders" ? "Orders" : "Edit Words"}
          </button>
        ))}
      </div>
      {tab === "orders" ? <Orders /> : <Words />}
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
  const setStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("orders").update({ status }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["all_orders"] });
  };
  return (
    <div className="mt-6 space-y-4">
      {(data ?? []).length === 0 && <p className="text-muted-foreground">No orders yet.</p>}
      {(data ?? []).map((o) => (
        <div key={o.id} className="rounded-2xl border-2 border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="font-display text-2xl">{o.customer_name} · {o.phone}</div>
              <div className="text-sm text-muted-foreground">Placed {new Date(o.created_at).toLocaleString()}{o.event_date && ` · Event ${o.event_date}`}</div>
            </div>
            <div className="text-right">
              <div className="font-display text-3xl text-drip">${Number(o.total).toFixed(2)}</div>
              {o.used_reward && <div className="text-xs text-drip">Free meal used</div>}
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
