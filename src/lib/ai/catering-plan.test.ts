import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONTENT } from "../content";
import { computeOrder, FLAVOR_IDS, validateOrderLine } from "../menu";
import {
  aiPlanSchema,
  fallbackPlan,
  parseRequest,
  sanitizeAiPlan,
  type FlavorInfo,
} from "./catering-plan";
import { planCateringOrder, readAiConfig } from "./llm.server";
import { computeInsights, insightText } from "./insights";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const flavors: FlavorInfo[] = FLAVOR_IDS.map((id) => ({
  id,
  name: DEFAULT_CONTENT[id]!,
  heat: DEFAULT_CONTENT[`${id}_heat`]!,
}));
const spicyIds = flavors.filter((f) => /spicy|hot|extreme/i.test(f.heat)).map((f) => f.id);

describe("parseRequest", () => {
  it("reads headcount, spicy share and budget", () => {
    expect(parseRequest("feeding 40 people, half like spicy, budget $300")).toEqual({
      headcount: 40,
      spicyShare: 0.5,
      budget: 300,
    });
    expect(parseRequest("Office lunch for 12, mostly mild, $150")).toMatchObject({
      headcount: 12,
      spicyShare: 0,
      budget: 150,
    });
    expect(parseRequest("tailgate for 25, everyone likes it hot")).toMatchObject({
      headcount: 25,
      spicyShare: 1,
      budget: null,
    });
    expect(parseRequest("30 guests, 10 like spicy, budget 500")).toMatchObject({
      headcount: 30,
      budget: 500,
    });
    expect(parseRequest("30 guests, 10 like spicy, budget 500").spicyShare).toBeCloseTo(1 / 3);
    expect(parseRequest("party with 20% spicy for 50 people").spicyShare).toBe(0.2);
  });
});

describe("fallback planner", () => {
  const check = (text: string) => {
    const p = fallbackPlan(text, flavors);
    for (const l of p.lines) expect(() => validateOrderLine(l)).not.toThrow();
    return { ...p, total: computeOrder(p.lines, false).total };
  };
  it("40 people, half spicy, $300 stays within budget using real menu items", () => {
    const p = check("feeding 40 people, half like spicy, budget $300");
    expect(p.total).toBeLessThanOrEqual(300);
    const spicyQty = p.lines
      .filter((l) => l.flavor && spicyIds.includes(l.flavor))
      .reduce((s, l) => s + l.qty, 0);
    const chickenQty = p.lines.filter((l) => l.flavor).reduce((s, l) => s + l.qty, 0);
    expect(spicyQty / chickenQty).toBeCloseTo(0.5, 1);
  });
  it("generous budget gets one meal each plus sodas", () => {
    const p = check("feeding 20 people, half spicy, budget $300");
    expect(p.lines.filter((l) => l.product === "mini6").reduce((s, l) => s + l.qty, 0)).toBe(20);
    expect(p.lines.filter((l) => l.product === "soda").reduce((s, l) => s + l.qty, 0)).toBe(20);
    expect(p.total).toBe(230);
  });
  it("no budget: meal per person, avoids Extreme heat by default", () => {
    const p = check("tailgate for 25, everyone likes it hot");
    expect(p.lines.every((l) => l.flavor !== "flavor_10")).toBe(true);
    expect(p.total).toBe(225);
  });
  it("missing headcount defaults to 10 with a warning", () => {
    const p = check("something spicy please");
    expect(p.warnings.join(" ")).toMatch(/10 people/);
  });
});

describe("AI output validation", () => {
  it("drops invented items and maps names to ids", () => {
    const plan = aiPlanSchema.parse({
      summary: "x",
      items: [
        {
          product: "Chicken Sandwich",
          qty: 5,
          flavor: "Buffalo Bounce",
          dip: "Honey Drip",
          slaw: true,
        },
        { product: "lobster", qty: 2 },
        { product: "mini6", qty: 3, flavor: "flavor_9", side: "Cole Slaw" },
        { product: "soda", qty: 4, drink: "coke" },
      ],
    });
    const { lines, warnings } = sanitizeAiPlan(plan, flavors);
    expect(lines).toEqual([
      { product: "sandwich", qty: 5, flavor: "flavor_8", dip: "flavor_1", slaw: true },
      { product: "mini6", qty: 3, flavor: "flavor_9", dip: "flavor_9", side: "coleslaw" },
      { product: "soda", qty: 4, drink: "Coke" },
    ]);
    expect(warnings.join(" ")).toMatch(/lobster/);
  });
  it("rejects malformed shapes", () => {
    expect(aiPlanSchema.safeParse({ items: [] }).success).toBe(false);
    expect(aiPlanSchema.safeParse({ items: [{ product: "mini6", qty: 0 }] }).success).toBe(false);
    expect(aiPlanSchema.safeParse({ items: [{ product: "mini6", qty: 9999 }] }).success).toBe(
      false,
    );
  });
});

describe("planCateringOrder (OpenAI-compatible API, mocked fetch)", () => {
  const cfg = { apiKey: "test-key", baseUrl: "https://ai.example/v1", model: "test-model" };
  const reply = (content: string, status = 200) =>
    vi.fn(
      async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }),
    );

  it("uses the model's plan when it validates, totals computed from the menu", async () => {
    const fetchImpl = reply(
      JSON.stringify({
        summary: "Spicy and sweet split.",
        items: [
          { product: "mini6", qty: 20, flavor: "flavor_8", side: "fries" },
          { product: "mini6", qty: 20, flavor: "flavor_1", side: "rice" },
        ],
      }),
    );
    const plan = await planCateringOrder(
      "feeding 40 people, half like spicy, budget $400",
      flavors,
      { config: cfg, fetchImpl },
    );
    expect(plan.source).toBe("ai");
    expect(plan.total).toBe(360);
    expect(plan.warnings).toEqual([]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ai.example/v1/chat/completions");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("test-model");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].content).toContain("Honey Drip");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-key");
  });
  it("flags plans that go over budget", async () => {
    const plan = await planCateringOrder("for 40 people budget $300", flavors, {
      config: cfg,
      fetchImpl: reply(
        JSON.stringify({
          summary: "",
          items: [{ product: "mini6", qty: 40, flavor: "flavor_1", side: "fries" }],
        }),
      ),
    });
    expect(plan.warnings.join(" ")).toMatch(/over your \$300/);
  });
  it("falls back (labeled) on invalid JSON, HTTP errors, or nothing valid", async () => {
    for (const fetchImpl of [
      reply("not json"),
      reply("{}", 500),
      reply(JSON.stringify({ items: [{ product: "pizza", qty: 3 }] })),
    ]) {
      const plan = await planCateringOrder(
        "feeding 40 people, half like spicy, budget $300",
        flavors,
        { config: cfg, fetchImpl },
      );
      expect(plan.source).toBe("fallback");
      expect(plan.lines.length).toBeGreaterThan(0);
      expect(plan.warnings[0]).toMatch(/built-in planner/);
    }
  });
  it("uses the fallback without calling anything when no key is set", async () => {
    const fetchImpl = vi.fn();
    expect(readAiConfig({})).toBeNull();
    const plan = await planCateringOrder("for 10 people", flavors, {
      config: readAiConfig({}),
      fetchImpl,
    });
    expect(plan.source).toBe("fallback");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("reads config from env with sensible defaults", () => {
    expect(readAiConfig({ AI_API_KEY: "k" })).toEqual({
      apiKey: "k",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
    });
    expect(readAiConfig({ AI_API_KEY: "k", AI_BASE_URL: "https://x/v1/", AI_MODEL: "m" })).toEqual({
      apiKey: "k",
      baseUrl: "https://x/v1",
      model: "m",
    });
  });
});

describe("owner insights", () => {
  it("summarizes paid orders only", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    const s = computeInsights(
      [
        {
          items: [{ product: "mini6", flavor: "flavor_8", qty: 10 }],
          total: 90,
          payment_status: "paid",
          status: "confirmed",
          event_date: "2026-11-12",
          created_at: "",
          used_reward: false,
        },
        {
          items: [{ product: "mini6", flavor: "flavor_1", qty: 2 }],
          total: 18,
          payment_status: "paid",
          status: "confirmed",
          event_date: null,
          created_at: "",
          used_reward: false,
        },
        {
          items: [{ product: "mini6", flavor: "flavor_1", qty: 50 }],
          total: 450,
          payment_status: "pending",
          status: "new",
          event_date: null,
          created_at: "",
          used_reward: false,
        },
      ],
      flavors,
      now,
    );
    expect(s).toMatchObject({
      paidOrders: 2,
      revenue: 108,
      averageOrder: 54,
      pendingCheckouts: 1,
      eventsNext7Days: 1,
      revenueNext7Days: 90,
    });
    expect(s.topFlavors[0]).toEqual({ name: "Buffalo Bounce", qty: 10 });
    expect(insightText(s)).toMatch(/2 paid orders brought in \$108.00/);
  });
});
