import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_CONTENT } from "./content-defaults";
import { FLAVOR_IDS } from "./menu";
import type { FlavorInfo } from "./ai/catering-plan";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

async function loadFlavors(supabase: SupabaseClient<Database>): Promise<FlavorInfo[]> {
  const { data } = await supabase.from("site_content").select("key,value");
  const c: Record<string, string> = { ...DEFAULT_CONTENT };
  for (const r of data ?? []) c[r.key] = r.value;
  return FLAVOR_IDS.map((id) => ({ id, name: c[id] ?? id, heat: c[`${id}_heat`] ?? "" }));
}

/** AI catering assistant: free text in, menu-valid order out (AI if configured, deterministic fallback otherwise). */
export const planCatering = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ prompt: z.string().trim().min(3).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { planCateringOrder, readAiConfig } = await import("./ai/llm.server");
    const flavors = await loadFlavors(context.supabase);
    return planCateringOrder(data.prompt, flavors, { config: readAiConfig() });
  });

/** Owner insight: stats on paid orders plus an AI-written summary (deterministic summary without a key). */
export const adminInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Admins only");
    const [{ supabaseAdmin }, { computeInsights, insightText }, { readAiConfig, chatJson }] =
      await Promise.all([
        import("@/integrations/supabase/client.server"),
        import("./ai/insights"),
        import("./ai/llm.server"),
      ]);
    const { data: orders, error } = await supabaseAdmin
      .from("orders")
      .select("items,total,payment_status,status,event_date,created_at,used_reward")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const flavors = await loadFlavors(context.supabase);
    const stats = computeInsights((orders ?? []) as never, flavors, new Date());
    const cfg = readAiConfig();
    if (cfg) {
      try {
        const out = (await chatJson(
          cfg,
          'You are a concise business analyst for a small chicken catering company. Given JSON stats, reply with JSON {"summary": string} containing 3 short bullet-style sentences: what is selling, what to prep for upcoming events, one actionable tip. Use only the numbers given.',
          JSON.stringify(stats),
        )) as { summary?: unknown };
        if (typeof out.summary === "string" && out.summary.trim())
          return { stats, summary: out.summary.slice(0, 1200), source: "ai" as const };
      } catch {
        /* fall through */
      }
    }
    return { stats, summary: insightText(stats), source: "fallback" as const };
  });
