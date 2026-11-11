// Live Drip Planner smoke test against the configured OpenAI-compatible model (AI_API_KEY in .env).
// Usage: bun scripts/ai-planner-smoke.ts ["your prompt"]
import { DEFAULT_CONTENT } from "../src/lib/content-defaults";
import { FLAVOR_IDS, validateOrderLine } from "../src/lib/menu";
import { planCateringOrder, readAiConfig } from "../src/lib/ai/llm.server";

const flavors = FLAVOR_IDS.map((id) => ({
  id,
  name: DEFAULT_CONTENT[id] ?? id,
  heat: DEFAULT_CONTENT[`${id}_heat`] ?? "",
}));
const config = readAiConfig();
if (!config) throw new Error("AI_API_KEY missing");
const prompts = process.argv[2]
  ? [process.argv[2]]
  : [
      "feeding 40 people, half like spicy, budget $300",
      "Office lunch for 12, mostly mild, $150",
      "Tailgate for 25, everyone likes it hot",
      "birthday party for 15 kids and 5 adults, no spicy, around $200, need drinks",
    ];
for (const p of prompts) {
  const t = Date.now();
  const plan = await planCateringOrder(p, flavors, { config });
  for (const l of plan.lines) validateOrderLine(l);
  console.log(
    JSON.stringify({
      prompt: p,
      ms: Date.now() - t,
      source: plan.source,
      total: plan.total,
      summary: plan.summary,
      warnings: plan.warnings,
      lines: plan.lines.map(
        (l) =>
          `${l.qty}x ${l.product}${l.flavor ? " " + l.flavor : ""}${l.side ? " +" + l.side : ""}${l.drink ? " " + l.drink : ""}`,
      ),
    }),
  );
}
