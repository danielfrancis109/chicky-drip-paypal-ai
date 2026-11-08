import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sparkles, ShoppingCart } from "lucide-react";
import { planCatering } from "@/lib/ai.functions";
import { PRODUCTS, lineOptions, type OrderLine } from "@/lib/menu";
import type { CateringPlan } from "@/lib/ai/catering-plan";
import { useContent } from "@/lib/content";
import { Button } from "@/components/ui/button";

const EXAMPLES = [
  "Feeding 40 people, half like spicy, budget $300",
  "Office lunch for 12, mostly mild, $150",
  "Tailgate for 25, everyone likes it hot",
];

export function CateringAssistant({ onAdd }: { onAdd: (lines: OrderLine[]) => void }) {
  const t = useContent();
  const planFn = useServerFn(planCatering);
  const [prompt, setPrompt] = useState("");
  const [plan, setPlan] = useState<CateringPlan | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = async (text = prompt) => {
    if (text.trim().length < 3) {
      toast.error("Tell me about your event first");
      return;
    }
    setPrompt(text);
    setBusy(true);
    try {
      setPlan(await planFn({ data: { prompt: text } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not plan that order");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="AI catering assistant"
      className="mt-6 rounded-2xl border-2 border-accent bg-card p-5"
    >
      <h2 className="flex items-center gap-2 text-3xl text-accent">
        <Sparkles />
        Drip Planner
      </h2>
      <p className="text-sm text-muted-foreground">
        Describe your event and get a full order from the real menu. One click adds it to your cart.
      </p>
      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <input
          aria-label="Describe your event"
          maxLength={500}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. feeding 40 people, half like spicy, budget $300"
          className="min-w-0 flex-1 rounded-lg border-2 border-border bg-background px-3 py-2 outline-none focus:border-accent"
        />
        <Button type="submit" disabled={busy} className="font-display text-xl">
          {busy ? "Planning…" : "Plan my order"}
        </Button>
      </form>
      <div className="mt-2 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={busy}
            onClick={() => ask(ex)}
            className="rounded-full bg-secondary px-3 py-1 text-xs hover:bg-accent hover:text-accent-foreground"
          >
            {ex}
          </button>
        ))}
      </div>
      {plan && (
        <div
          className="mt-4 rounded-xl border border-dashed border-border p-4"
          data-testid="catering-plan"
        >
          <span
            className={`rounded px-2 py-0.5 text-xs ${plan.source === "ai" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}
          >
            {plan.source === "ai"
              ? "AI recommendation"
              : "Built-in planner (AI not configured, rule-based fallback)"}
          </span>
          <p className="mt-2">{plan.summary}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {plan.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>
                  {l.qty} × {PRODUCTS[l.product].name}
                  {l.flavor ? ` — ${t(l.flavor)}` : ""}
                  {lineOptions(l) ? (
                    <span className="text-muted-foreground"> · {lineOptions(l)}</span>
                  ) : null}
                </span>
                <span className="shrink-0">${(PRODUCTS[l.product].price * l.qty).toFixed(2)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex justify-between font-display text-2xl">
            <span>Plan total</span>
            <span className="text-drip">${plan.total.toFixed(2)}</span>
          </div>
          {plan.warnings.map((w) => (
            <p key={w} className="text-xs text-muted-foreground">
              ⚠ {w}
            </p>
          ))}
          <Button
            type="button"
            className="mt-3 w-full font-display text-xl"
            onClick={() => {
              onAdd(plan.lines);
              toast.success("Plan added to your order");
            }}
          >
            <ShoppingCart />
            Add all to my order
          </Button>
        </div>
      )}
    </section>
  );
}
