// OpenAI-compatible chat completions client (server-only). Works with OpenAI, Groq, OpenRouter,
// Together, xAI, Lovable AI Gateway, a local Ollama, etc. Configure with AI_API_KEY, AI_BASE_URL, AI_MODEL.
import {
  aiPlanSchema,
  buildSystemPrompt,
  fallbackPlan,
  finalizePlan,
  parseRequest,
  planIssues,
  mergeRequest,
  topUpPlan,
  servingsOf,
  topUpDrinks,
  fitBudget,
  mergeLines,
  describePlan,
  sanitizeAiPlan,
  type CateringPlan,
  type FlavorInfo,
} from "./catering-plan";
import type { OrderLine } from "../menu";

export type AiConfig = { apiKey: string; baseUrl: string; model: string };

export function readAiConfig(
  env: Record<string, string | undefined> = process.env,
): AiConfig | null {
  const apiKey = env["AI_API_KEY"]?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env["AI_BASE_URL"]?.trim() || "https://api.openai.com/v1").replace(/\/+$/, ""),
    model: env["AI_MODEL"]?.trim() || "gpt-4o-mini",
  };
}

export async function chatJson(
  cfg: AiConfig,
  system: string,
  user: string,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<unknown> {
  const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`AI request failed (${res.status})`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content ?? "";
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("AI reply was not JSON");
  return JSON.parse(content.slice(start, end + 1));
}

/** Ask the model for a plan; validate with zod + the real menu; fall back deterministically on any failure. */
export async function planCateringOrder(
  text: string,
  flavors: FlavorInfo[],
  opts: { config: AiConfig | null; fetchImpl?: typeof fetch },
): Promise<CateringPlan> {
  const fallback = (why: string[]) => {
    const f = fallbackPlan(text, flavors);
    return finalizePlan("fallback", f.lines, f.summary, [...why, ...f.warnings], f.request);
  };
  if (!opts.config) return fallback([]);
  try {
    const system = buildSystemPrompt(flavors);
    type Understood = {
      headcount?: number | null | undefined;
      budget?: number | null | undefined;
      spicyShare?: number | null | undefined;
    };
    let best: {
      lines: OrderLine[];
      warnings: string[];
      summary: string;
      issues: string[];
      understood: Understood;
    } | null = null;
    let lastProblem = "";
    // Up to two attempts: if the first plan underfeeds, overspends or ignores the spicy split,
    // tell the model exactly what was wrong and let it fix it once.
    for (let attempt = 0; attempt < 2; attempt++) {
      const user =
        attempt === 0 || !best
          ? text
          : `${text}\n\nYour previous plan had these problems: ${best.issues.join(" ")} Return a corrected plan.`;
      const raw = await chatJson(opts.config, system, user, opts.fetchImpl);
      const parsed = aiPlanSchema.safeParse(raw);
      if (!parsed.success) {
        lastProblem = "The AI reply didn't match the menu format";
        continue;
      }
      const { lines, warnings } = sanitizeAiPlan(parsed.data, flavors);
      if (!lines.length) {
        lastProblem = "The AI suggested nothing from the menu";
        continue;
      }
      const understood: Understood = {
        headcount: parsed.data.headcount,
        budget: parsed.data.budget,
        spicyShare: parsed.data.spicyShare,
      };
      const issues = planIssues(text, lines, flavors, mergeRequest(parseRequest(text), understood));
      const cand = { lines, warnings, summary: parsed.data.summary, issues, understood };
      if (!best || issues.length < best.issues.length) best = cand;
      if (!best.issues.length) break;
    }
    if (!best)
      return fallback([
        `${lastProblem || "The AI reply was unusable"}, so the built-in planner was used.`,
      ]);
    const req = mergeRequest(parseRequest(text), best.understood);
    // Deterministic repair: never leave guests unfed when the budget allows.
    let fitted = fitBudget(mergeLines(best.lines), req.budget);
    let repaired = topUpPlan(fitted.lines, req, flavors);
    // Food first: if guests are still unfed, free up room (cheaper portions, fewer extras) and retry.
    const deficit = req.headcount ? req.headcount - servingsOf(repaired.lines) : 0;
    if (deficit > 0.01 && req.budget !== null) {
      const room = fitBudget(fitted.lines, Math.max(0, req.budget - deficit * 5 * 1.5));
      fitted = { lines: room.lines, changed: fitted.changed || room.changed };
      repaired = topUpPlan(fitted.lines, req, flavors);
    }
    repaired.lines = mergeLines(repaired.lines);
    const drinks = topUpDrinks(text, repaired.lines, req);
    repaired.lines = drinks.lines;
    const notes = [
      ...(fitted.changed ? ["Adjusted portions to fit your budget."] : []),
      ...(repaired.added ? [`Added ${repaired.added} serving(s) so every guest is fed.`] : []),
      ...(drinks.added ? [`Added ${drinks.added} soda(s) for the requested drinks.`] : []),
    ];
    const remaining = planIssues(text, repaired.lines, flavors, req).filter((i) =>
      /feeds about|Drinks were requested/.test(i),
    );
    // Numbers in the summary always come from our own math, never from the model.
    const friendly = best.summary && !/[$\d]/.test(best.summary) ? ` ${best.summary}` : "";
    return finalizePlan(
      "ai",
      repaired.lines,
      describePlan(repaired.lines, req, flavors) + friendly,
      [...best.warnings, ...notes, ...remaining],
      req,
    );
  } catch (e) {
    return fallback([
      `AI unavailable (${(e as Error).message}), so the built-in planner was used.`,
    ]);
  }
}
