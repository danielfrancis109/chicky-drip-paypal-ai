// AI catering assistant: shared types, validation against the real menu, and a deterministic
// fallback planner. Pure functions, safe on client and server, fully unit-tested.
import { z } from "zod";
import {
  computeOrder,
  FLAVOR_IDS,
  includesSide,
  PRODUCTS,
  SIDE_IDS,
  SODA_CHOICES,
  JUICE_CHOICES,
  validateOrderLine,
  type OrderLine,
  type ProductId,
  type SideId,
} from "../menu";

export type FlavorInfo = { id: string; name: string; heat: string };
export type PlanSource = "ai" | "fallback";

export type CateringPlan = {
  source: PlanSource;
  lines: OrderLine[];
  subtotal: number;
  total: number;
  summary: string;
  warnings: string[];
  request: ParsedRequest;
};

export type ParsedRequest = {
  headcount: number | null;
  spicyShare: number | null;
  budget: number | null;
};

const SPICY_WORDS = /(spicy|hot|extreme|fire)/i;
export const isSpicy = (f: FlavorInfo) => SPICY_WORDS.test(f.heat);

/** The JSON shape we ask the model for. Everything is re-validated against the menu afterwards. */
export const aiPlanSchema = z.object({
  summary: z.string().max(600).default(""),
  items: z
    .array(
      z.object({
        product: z.string(),
        qty: z.coerce.number().int().min(1).max(500),
        flavor: z.string().optional().nullable(),
        dip: z.string().optional().nullable(),
        side: z.string().optional().nullable(),
        drink: z.string().optional().nullable(),
        slaw: z.boolean().optional().nullable(),
      }),
    )
    .min(1)
    .max(30),
});
export type AiPlan = z.infer<typeof aiPlanSchema>;

/** Pull headcount / spicy share / budget out of free text ("feeding 40 people, half like spicy, budget $300"). */
export function parseRequest(text: string): ParsedRequest {
  const t = text.toLowerCase().replace(/,(?=\d{3}\b)/g, "");
  const head =
    t.match(/(?:feed(?:ing)?|for|serve|serving)\s+(\d{1,4})/) ??
    t.match(
      /(\d{1,4})\s*(?:people|persons|guests|ppl|folks|kids|adults|employees|heads|attendees|players)/,
    );
  const budgetMatch =
    t.match(/\$\s*(\d+(?:\.\d{1,2})?)/) ??
    t.match(/budget(?:\s+(?:is|of|around|about|under))?\s*(\d+(?:\.\d{1,2})?)/) ??
    t.match(/(\d+(?:\.\d{1,2})?)\s*(?:dollars|bucks)/);
  let spicy: number | null = null;
  const pct = t.match(
    /(\d{1,3})\s*%\s*(?:of\s+\w+\s+)?(?:like|want|love|prefer)?\s*(?:it\s+)?(?:spicy|hot|heat)/,
  );
  const countSpicy = t.match(
    /(\d{1,4})\s+(?:of\s+them\s+|people\s+|guests\s+)?(?:like|want|love|prefer)\s+(?:it\s+)?(?:spicy|hot)/,
  );
  if (pct) spicy = Math.min(100, Number(pct[1])) / 100;
  else if (/\bhalf\b[^.]*\b(spicy|hot|heat)/.test(t)) spicy = 0.5;
  else if (/\b(a\s+)?third\b[^.]*\b(spicy|hot|heat)/.test(t)) spicy = 1 / 3;
  else if (/\b(a\s+)?quarter\b[^.]*\b(spicy|hot|heat)/.test(t)) spicy = 0.25;
  else if (/\b(no|not|zero|nothing)\s+(\w+\s+)?(spicy|hot)|\bmild\b|\bkids?\b/.test(t)) spicy = 0;
  else if (/\b(all|everyone|everybody)\b[^.]*\b(spicy|hot)/.test(t)) spicy = 1;
  else if (countSpicy) spicy = null; // resolved below once headcount is known
  const headcount = head ? Math.min(500, Math.max(1, Number(head[1]))) : null;
  if (spicy === null && countSpicy && headcount)
    spicy = Math.min(1, Number(countSpicy[1]) / headcount);
  const budget = budgetMatch ? Number(budgetMatch[1]) : null;
  return { headcount, spicyShare: spicy, budget: budget && budget > 0 ? budget : null };
}

/**
 * Turn raw model output into menu-valid order lines. Unknown products are dropped, flavor/side/dip
 * names are mapped to ids, missing required choices are filled with safe defaults, and every line
 * must pass the same validateOrderLine the checkout uses. Returns warnings for anything changed.
 */
export function sanitizeAiPlan(
  plan: AiPlan,
  flavors: FlavorInfo[],
): { lines: OrderLine[]; warnings: string[] } {
  const warnings: string[] = [];
  const lines: OrderLine[] = [];
  const productByName = new Map<string, ProductId>();
  for (const [id, p] of Object.entries(PRODUCTS)) {
    productByName.set(id.toLowerCase(), id as ProductId);
    productByName.set(p.name.toLowerCase(), id as ProductId);
  }
  const flavorId = (v?: string | null) => {
    if (!v) return undefined;
    const k = v.trim().toLowerCase();
    return flavors.find((f) => f.id === k || f.name.toLowerCase() === k)?.id;
  };
  const sideId = (v?: string | null): SideId | undefined => {
    if (!v) return undefined;
    const k = v.trim().toLowerCase().replace(/\s+/g, "");
    return SIDE_IDS.find(
      (s) => s === k || PRODUCTS[s].name.toLowerCase().replace(/\s+/g, "") === k,
    );
  };
  for (const raw of plan.items) {
    const product = productByName.get(raw.product.trim().toLowerCase());
    if (!product) {
      warnings.push(`Skipped "${raw.product}" (not on the menu)`);
      continue;
    }
    const p = PRODUCTS[product];
    let flavor = p.needsFlavor ? flavorId(raw.flavor) : undefined;
    if (p.needsFlavor && !flavor) {
      flavor = FLAVOR_IDS[0];
      warnings.push(`Picked ${flavors[0]?.name ?? FLAVOR_IDS[0]} for ${p.name} (flavor missing)`);
    }
    let dip = p.group === "chicken" ? (flavorId(raw.dip) ?? flavor) : undefined;
    if (p.group === "chicken" && !dip) dip = FLAVOR_IDS[0];
    let side = includesSide(product) ? sideId(raw.side) : undefined;
    if (includesSide(product) && !side) side = "fries";
    const choices = product === "soda" ? SODA_CHOICES : product === "juice" ? JUICE_CHOICES : [];
    let drink = choices.length
      ? choices.find((c) => c.toLowerCase() === (raw.drink ?? "").trim().toLowerCase())
      : undefined;
    if (choices.length && !drink) drink = choices[0];
    const line: OrderLine = {
      product,
      qty: raw.qty,
      flavor,
      dip,
      side,
      drink,
      slaw: product === "sandwich" ? !!raw.slaw : undefined,
    };
    for (const k of Object.keys(line) as (keyof OrderLine)[])
      if (line[k] === undefined) delete line[k];
    try {
      validateOrderLine(line);
      lines.push(line);
    } catch (e) {
      warnings.push(`Skipped ${p.name}: ${(e as Error).message}`);
    }
  }
  return { lines: lines.slice(0, 50), warnings };
}

function pickFlavors(flavors: FlavorInfo[]) {
  const spicy = flavors.filter(isSpicy);
  const mild = flavors.filter((f) => !isSpicy(f));
  // Prefer crowd-pleasers: "Spicy" before "Hot"/"Extreme"; keep extremes out of default catering.
  spicy.sort((a, b) => rank(a.heat) - rank(b.heat));
  return { spicy: spicy.length ? spicy : flavors, mild: mild.length ? mild : flavors };
}
// Crowd-pleasing heat first: Spicy, then Hot, then Sweet & Spicy; Extreme only if nothing else.
const rank = (heat: string) =>
  /extreme/i.test(heat) ? 4 : /sweet/i.test(heat) ? 3 : /hot/i.test(heat) ? 2 : 1;

const fid = (pool: FlavorInfo[], i: number) =>
  pool[i % Math.max(1, pool.length)]?.id ?? FLAVOR_IDS[0]!;

function split(n: number, parts: number) {
  const base = Math.floor(n / parts);
  return Array.from({ length: parts }, (_, i) => base + (i < n % parts ? 1 : 0)).filter(
    (x) => x > 0,
  );
}

/**
 * Deterministic planner used when no AI key is configured or the model fails validation.
 * Rule of thumb: one $9 meal (chicken + side + dip) per guest, sandwiches if budget is tighter,
 * by-the-piece minis if tighter still, then sodas if the budget leaves room.
 */
export function fallbackPlan(
  text: string,
  flavors: FlavorInfo[],
): { lines: OrderLine[]; summary: string; warnings: string[]; request: ParsedRequest } {
  const request = parseRequest(text);
  const warnings: string[] = [];
  const people = request.headcount ?? 10;
  if (!request.headcount) warnings.push("No headcount found, planned for 10 people.");
  const share = request.spicyShare ?? 0.5;
  const spicyPeople = Math.round(people * share);
  const mildPeople = people - spicyPeople;
  const { spicy, mild } = pickFlavors(flavors);
  const budget = request.budget;
  const lines: OrderLine[] = [];
  const sides: SideId[] = ["fries", "coleslaw", "rice"];
  const addGroup = (
    count: number,
    pool: FlavorInfo[],
    mk: (flavor: string, qty: number, i: number) => OrderLine,
  ) => {
    const chunks = split(count, Math.min(2, Math.max(1, count >= 8 ? 2 : 1)));
    chunks.forEach((qty, i) => lines.push(mk(fid(pool, i), qty, i)));
  };
  let style: string;
  if (budget === null || budget >= people * PRODUCTS.mini6.price) {
    style = "one 6-piece mini meal (with a side and dip) per guest";
    addGroup(spicyPeople, spicy, (flavor, qty, i) => ({
      product: "mini6",
      flavor,
      dip: flavor,
      side: sides[i % 3],
      qty,
    }));
    addGroup(mildPeople, mild, (flavor, qty, i) => ({
      product: "mini6",
      flavor,
      dip: flavor,
      side: sides[(i + 1) % 3],
      qty,
    }));
  } else if (budget >= people * PRODUCTS.sandwich.price) {
    style = "one chicken sandwich per guest to fit the budget";
    addGroup(spicyPeople, spicy, (flavor, qty) => ({
      product: "sandwich",
      flavor,
      dip: flavor,
      slaw: true,
      qty,
    }));
    addGroup(mildPeople, mild, (flavor, qty) => ({
      product: "sandwich",
      flavor,
      dip: flavor,
      slaw: false,
      qty,
    }));
  } else {
    const pieces = Math.max(1, Math.floor(budget / PRODUCTS.mini1.price));
    const spicyPieces = Math.round(pieces * share);
    style = `${pieces} mini wings/thighs by the piece (about ${(pieces / people).toFixed(1)} per guest) to stay under budget`;
    warnings.push(
      `$${budget} is under $${PRODUCTS.sandwich.price}/person, so this plan uses pieces instead of full meals.`,
    );
    if (spicyPieces)
      lines.push({
        product: "mini1",
        flavor: fid(spicy, 0),
        dip: fid(spicy, 0),
        qty: Math.min(500, spicyPieces),
      });
    if (pieces - spicyPieces)
      lines.push({
        product: "mini1",
        flavor: fid(mild, 0),
        dip: fid(mild, 0),
        qty: Math.min(500, pieces - spicyPieces),
      });
  }
  let { subtotal } = computeOrder(lines, false);
  const sodaCost = PRODUCTS.soda.price * people;
  if (budget !== null && budget - subtotal >= sodaCost) {
    split(people, Math.min(2, people)).forEach((qty, i) =>
      lines.push({ product: "soda", drink: SODA_CHOICES[i] ?? "Coke", qty }),
    );
    subtotal = computeOrder(lines, false).subtotal;
    style += ", plus a soda each";
  }
  const spicyNote =
    spicyPeople && mildPeople
      ? ` ${spicyPeople} spicy / ${mildPeople} mild.`
      : spicyPeople
        ? " All spicy."
        : " All mild.";
  const budgetNote =
    budget !== null
      ? ` Total $${subtotal.toFixed(2)} of your $${budget.toFixed(2)} budget.`
      : ` Total $${subtotal.toFixed(2)}.`;
  return {
    lines,
    summary: `For ${people} guests: ${style}.${spicyNote}${budgetNote}`,
    warnings,
    request,
  };
}

export function finalizePlan(
  source: PlanSource,
  lines: OrderLine[],
  summary: string,
  warnings: string[],
  request: ParsedRequest,
): CateringPlan {
  const { subtotal, total } = computeOrder(lines, false);
  const w = [...warnings];
  if (request.budget !== null && total > request.budget + 0.005)
    w.push(
      `This plan is $${(total - request.budget).toFixed(2)} over your $${request.budget.toFixed(2)} budget.`,
    );
  return { source, lines, subtotal, total, summary, warnings: w, request };
}

/** System prompt for the model: the full real menu, and the exact JSON contract. */
export function buildSystemPrompt(flavors: FlavorInfo[]) {
  const menu = Object.entries(PRODUCTS).map(([id, p]) => ({
    id,
    name: p.name,
    price: p.price,
    needsFlavor: p.needsFlavor,
    group: p.group,
    includesSide: includesSide(id as ProductId),
  }));
  return [
    "You are the catering assistant for Chicky Drip, a saucy chicken catering business.",
    "Recommend a catering order using ONLY the products and flavors below. Never invent items or prices.",
    `MENU (USD): ${JSON.stringify(menu)}`,
    `FLAVORS: ${JSON.stringify(flavors)}`,
    `SIDES (for mini6/large3, included free): ${JSON.stringify(SIDE_IDS)}. SODA choices: ${JSON.stringify(SODA_CHOICES)}. JUICE choices: ${JSON.stringify(JUICE_CHOICES)}.`,
    "Rules: every chicken item (group chicken) needs a flavor id and one free dip flavor id; mini6 and large3 need a side; sandwich may set slaw true/false; soda/juice need a drink choice; extra dips use product 'dip' with a flavor.",
    "Plan roughly one meal per guest when budget allows. Respect the spicy/mild split (Spicy/Hot/Extreme heat = spicy). Stay at or under the budget when one is given.",
    'Reply with JSON only: {"summary": string (1-2 friendly sentences), "items": [{"product": id, "qty": int, "flavor"?: flavorId, "dip"?: flavorId, "side"?: sideId, "drink"?: string, "slaw"?: boolean}]}',
  ].join("\n");
}
