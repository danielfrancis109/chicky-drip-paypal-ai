import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONTENT } from "../content";
import { computeOrder, FLAVOR_IDS, validateOrderLine } from "../menu";
import {
  aiPlanSchema,
  fallbackPlan,
  parseRequest,
  sanitizeAiPlan,
  fitBudget,
  mergeLines,
  mergeRequest,
  servingsOf,
  topUpPlan,
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
  it("fits over-budget plans under budget, keeps everyone fed, and retries once with feedback", async () => {
    const fetchImpl = reply(
      JSON.stringify({
        summary: "",
        items: [{ product: "mini6", qty: 40, flavor: "flavor_1", side: "fries" }],
      }),
    );
    const plan = await planCateringOrder("for 40 people budget $300", flavors, {
      config: cfg,
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(
      (fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(retryBody.messages[1].content).toMatch(
      /previous plan had these problems: .*over the \$300/,
    );
    expect(plan.total).toBeLessThanOrEqual(300);
    expect(servingsOf(plan.lines)).toBeGreaterThanOrEqual(40);
    expect(plan.warnings).toContain("Adjusted portions to fit your budget.");
    expect(plan.summary).toMatch(/^Feeds 40 of 40 guests/);
  });
  it("tops up underfed plans and uses the model's headcount when the text is ambiguous", async () => {
    const fetchImpl = reply(
      JSON.stringify({
        headcount: 20,
        summary: "Mild and tasty!",
        items: [{ product: "mini6", qty: 10, flavor: "flavor_1", side: "fries" }],
      }),
    );
    const plan = await planCateringOrder("party for 15 kids and 5 adults, no spicy", flavors, {
      config: cfg,
      fetchImpl,
    });
    expect(servingsOf(plan.lines)).toBe(20);
    expect(plan.warnings.join(" ")).toMatch(/Added 10 serving/);
    expect(plan.summary).toBe(
      "Feeds 20 of 20 guests · 0 spicy / 20 mild · $180.00. Mild and tasty!",
    );
  });
  it("never repeats model-claimed prices in the summary", async () => {
    const fetchImpl = reply(
      JSON.stringify({
        summary: "Only $5 total!",
        items: [{ product: "mini6", qty: 2, flavor: "flavor_1", side: "fries" }],
      }),
    );
    const plan = await planCateringOrder("lunch for 2", flavors, { config: cfg, fetchImpl });
    expect(plan.summary).not.toMatch(/\$5/);
    expect(plan.summary).toMatch(/\$18.00/);
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

describe("deterministic repairs", () => {
  it("fitBudget downgrades meals before removing food", () => {
    const { lines } = fitBudget(
      [{ product: "mini6", flavor: "flavor_1", dip: "flavor_1", side: "fries", qty: 10 }],
      85,
    );
    expect(computeOrder(lines, false).total).toBeLessThanOrEqual(85);
    expect(servingsOf(lines)).toBe(10);
  });
  it("topUpPlan respects the spicy split and the budget", () => {
    const { lines } = topUpPlan([], { headcount: 10, spicyShare: 0.5, budget: 90 }, flavors);
    expect(servingsOf(lines)).toBe(10);
    expect(computeOrder(lines, false).total).toBeLessThanOrEqual(90);
    const spicy = lines
      .filter((l) => l.flavor && spicyIds.includes(l.flavor))
      .reduce((s, l) => s + l.qty, 0);
    expect(spicy).toBe(5);
  });
  it("mergeLines combines identical lines", () => {
    expect(
      mergeLines([
        { product: "soda", drink: "Coke", qty: 2 },
        { product: "soda", drink: "Coke", qty: 3 },
      ]),
    ).toEqual([{ product: "soda", drink: "Coke", qty: 5 }]);
  });
  it("mergeRequest takes the larger headcount", () => {
    expect(
      mergeRequest(
        { headcount: 15, spicyShare: null, budget: 200 },
        { headcount: 20, spicyShare: 0 },
      ),
    ).toEqual({ headcount: 20, spicyShare: 0, budget: 200 });
  });
});
