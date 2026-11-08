// OpenAI-compatible chat completions client (server-only). Works with OpenAI, Groq, OpenRouter,
// Together, xAI, Lovable AI Gateway, a local Ollama, etc. Configure with AI_API_KEY, AI_BASE_URL, AI_MODEL.
import {
  aiPlanSchema,
  buildSystemPrompt,
  fallbackPlan,
  finalizePlan,
  parseRequest,
  sanitizeAiPlan,
  type CateringPlan,
  type FlavorInfo,
} from "./catering-plan";

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
    const raw = await chatJson(opts.config, buildSystemPrompt(flavors), text, opts.fetchImpl);
    const parsed = aiPlanSchema.safeParse(raw);
    if (!parsed.success)
      return fallback([
        "The AI reply didn't match the menu format, so the built-in planner was used.",
      ]);
    const { lines, warnings } = sanitizeAiPlan(parsed.data, flavors);
    if (!lines.length)
      return fallback([
        "The AI suggested nothing from the menu, so the built-in planner was used.",
      ]);
    return finalizePlan(
      "ai",
      lines,
      parsed.data.summary || "Here's a catering plan built from the Chicky Drip menu.",
      warnings,
      parseRequest(text),
    );
  } catch (e) {
    return fallback([
      `AI unavailable (${(e as Error).message}), so the built-in planner was used.`,
    ]);
  }
}
