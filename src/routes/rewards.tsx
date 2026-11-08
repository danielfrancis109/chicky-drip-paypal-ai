import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { useMyOrders } from "@/lib/useMyOrders";
import { DripMeter } from "@/components/DripMeter";
import { useContent } from "@/lib/content";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cancelOrder } from "@/lib/orders.functions";
import { canCancelOrder, PRODUCTS, lineOptions, type OrderLine } from "@/lib/menu";

export const Route = createFileRoute("/rewards")({
  head: () => ({
    meta: [
      { title: "Rewards | Chicky Drip Catering" },
      { name: "description", content: "Every 10 orders earns a free $15 meal. Track your Drip Meter." },
      { property: "og:title", content: "Chicky Drip Rewards" },
      { property: "og:description", content: "Order 10 times, eat free." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Rewards,
});

function Rewards() {
  const t = useContent();
  const { user, loading } = useAuth();
  const { data, status } = useMyOrders(user?.id);
  const cancelFn = useServerFn(cancelOrder);
  const qc = useQueryClient();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cancel = async (id: string) => {
    setBusy(true);
    try {
      await cancelFn({ data: { id } });
      await qc.invalidateQueries({ queryKey: ["my_orders"] });
      await qc.invalidateQueries({ queryKey: ["all_orders"] });
      toast.success("Order cancelled"); setConfirmId(null);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not cancel order"); }
    finally { setBusy(false); }
  };
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-fire text-6xl">{t("rewards_title")}</h1>
      <p className="mt-2 text-muted-foreground">{t("rewards_text")}</p>
      {loading ? null : !user ? (
        <div className="mt-8 rounded-2xl border-2 border-primary bg-card p-6 text-center">
          <p className="text-lg">Sign in to see your points.</p>
          <Link to="/auth" className="mt-4 inline-block rounded-full bg-primary px-6 py-2 font-display text-xl text-primary-foreground">Sign in / Join</Link>
        </div>
      ) : (
        <>
          <div className="mt-8"><DripMeter {...status} /></div>
          <h2 className="mt-10 text-4xl text-accent">My Orders</h2>
          <div className="mt-4 space-y-3">
            {(data ?? []).length === 0 && <p className="text-muted-foreground">No orders yet. <Link to="/order" className="text-drip underline">Start one</Link></p>}
            {(data ?? []).map((o) => (
              <div key={o.id} data-order-id={o.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{new Date(o.created_at).toLocaleDateString()} {o.used_reward && <span className="ml-2 rounded bg-drip px-2 text-xs text-drip-foreground">FREE MEAL</span>}</div>
                  <div className="text-sm capitalize text-muted-foreground">{o.status}</div>
                </div>
                <div className="font-display text-2xl text-drip">${Number(o.total).toFixed(2)}</div>
                </div>
                <ul className="mt-3 space-y-2 text-sm">
                  {(o.items as OrderLine[]).map((line, i) => <li key={i}>
                    {line.qty} × {PRODUCTS[line.product]?.name} {line.flavor && `— ${t(line.flavor)}`}
                    <div className="text-muted-foreground">{lineOptions(line)}{line.dip && ` · Free dip: ${t(line.dip)}`}</div>
                  </li>)}
                </ul>
                {canCancelOrder(o.status) && <div className="mt-3">
                  {confirmId === o.id ? <div className="flex flex-wrap items-center gap-2"><span className="text-sm">Cancel this order?</span><Button disabled={busy} variant="destructive" onClick={() => cancel(o.id)}>Yes, cancel order</Button><Button disabled={busy} variant="outline" onClick={() => setConfirmId(null)}>Keep order</Button></div> : <Button variant="outline" onClick={() => setConfirmId(o.id)}>Cancel order</Button>}
                </div>}
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
