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
  // What the model understood from the request (helps with phrasing our regex parser misses,
  // e.g. "15 kids and 5 adults"). Optional; validated and clamped before use.
  headcount: z.coerce.number().int().min(1).max(500).optional().nullable().catch(null),
  budget: z.coerce.number().positive().max(100000).optional().nullable().catch(null),
  spicyShare: z.coerce.number().min(0).max(1).optional().nullable().catch(null),
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
    "Portions: ONE serving = one mini6 meal (6 pieces + side), one large3 meal (3 large drums + side), one sandwich, or 5 pieces of mini1 (mini1 qty counts single pieces, NOT people). The plan must feed every guest: total servings must equal the headcount.",
    "Spicy split: apply the requested spicy share to servings (flavors whose heat is Spicy/Hot/Extreme count as spicy; prefer Spicy/Hot over Extreme). Use two or three different flavors for variety.",
    "Budget: when a budget is given, stay at or under it and use most of it (aim for 85-100%); if meals for everyone don't fit, use cheaper sandwiches or mini1 pieces rather than leaving guests without food. Add one drink per guest only if drinks are requested or the budget clearly allows.",
    "Write the summary as 1-2 friendly sentences that state the headcount covered, the spicy/mild split and the total.",
    'Reply with JSON only: {"headcount": int|null, "budget": number|null, "spicyShare": number 0-1|null, "summary": string (1-2 friendly sentences, no prices or totals), "items": [{"product": id, "qty": int, "flavor"?: flavorId, "dip"?: flavorId, "side"?: sideId, "drink"?: string, "slaw"?: boolean}]}',
  ].join("\n");
}

/** Servings a plan provides: meals/sandwiches count 1 each, mini1 pieces count 1/5. */
export function servingsOf(lines: OrderLine[]) {
  return lines.reduce(
    (s, l) =>
      s +
      (l.product === "mini6" || l.product === "large3" || l.product === "sandwich"
        ? l.qty
        : l.product === "mini1"
          ? l.qty / 5
          : 0),
    0,
  );
}

/** Problems worth one AI retry (and a user-facing warning if they persist). */
export function planIssues(
  text: string,
  lines: OrderLine[],
  flavors: FlavorInfo[],
  request?: ParsedRequest,
): string[] {
  const req = request ?? parseRequest(text);
  const issues: string[] = [];
  const servings = servingsOf(lines);
  const { total } = computeOrder(lines, false);
  if (req.headcount && servings < req.headcount * 0.9)
    issues.push(`The plan feeds about ${Math.floor(servings)} of ${req.headcount} guests.`);
  if (req.budget !== null && total > req.budget + 0.005)
    issues.push(`The plan costs $${total.toFixed(2)}, over the $${req.budget.toFixed(2)} budget.`);
  if (req.spicyShare !== null && servings > 0) {
    const spicyIds = new Set(flavors.filter(isSpicy).map((f) => f.id));
    const spicy = servingsOf(lines.filter((l) => l.flavor && spicyIds.has(l.flavor)));
    if (Math.abs(spicy / servings - req.spicyShare) > 0.2)
      issues.push(
        `About ${Math.round((spicy / servings) * 100)}% of servings are spicy but ${Math.round(req.spicyShare * 100)}% was requested.`,
      );
  }
  if (req.headcount && /\b(drink|drinks|soda|sodas|beverage|juice)\b/i.test(text)) {
    const drinks = lines
      .filter((l) => l.product === "soda" || l.product === "juice")
      .reduce((s, l) => s + l.qty, 0);
    if (drinks < req.headcount)
      issues.push(`Drinks were requested but the plan has ${drinks} for ${req.headcount} guests.`);
  }
  return issues;
}

/** Merge what the regex parser found with what the model understood (parser wins when it found something). */
export function mergeRequest(
  parsed: ParsedRequest,
  ai: {
    headcount?: number | null | undefined;
    budget?: number | null | undefined;
    spicyShare?: number | null | undefined;
  },
): ParsedRequest {
  return {
    // Take the larger headcount: the regex can catch only part of "15 kids and 5 adults".
    headcount:
      parsed.headcount && ai.headcount
        ? Math.max(parsed.headcount, ai.headcount)
        : (parsed.headcount ?? ai.headcount ?? null),
    budget: parsed.budget ?? ai.budget ?? null,
    spicyShare: parsed.spicyShare ?? ai.spicyShare ?? null,
  };
}

/**
 * Deterministic repair after the model: small models are bad at arithmetic, so if the plan feeds
 * fewer guests than requested we top it up (same style when the budget allows, otherwise mini pieces),
 * keeping the spicy/mild split. Never exceeds the budget.
 */
export function topUpPlan(
  lines: OrderLine[],
  req: ParsedRequest,
  flavors: FlavorInfo[],
): { lines: OrderLine[]; added: number } {
  if (!req.headcount) return { lines, added: 0 };
  const out = lines.map((l) => ({ ...l }));
  const spicyIds = new Set(flavors.filter(isSpicy).map((f) => f.id));
  const { spicy, mild } = pickFlavors(flavors);
  const share = req.spicyShare ?? 0.5;
  let added = 0;
  const room = () => (req.budget === null ? Infinity : req.budget - computeOrder(out, false).total);
  const add = (line: OrderLine) => {
    const same = out.find(
      (l) =>
        l.product === line.product &&
        l.flavor === line.flavor &&
        l.side === line.side &&
        l.qty + line.qty <= 500,
    );
    if (same) same.qty += line.qty;
    else out.push(line);
  };
  for (let guard = 0; guard < 500 && servingsOf(out) < req.headcount - 0.01; guard++) {
    const served = servingsOf(out);
    const spicyServed = servingsOf(out.filter((l) => l.flavor && spicyIds.has(l.flavor)));
    const wantSpicy = spicyServed < share * (served + 1) - 0.01 && share > 0;
    const f = wantSpicy ? fid(spicy, 0) : fid(mild, 0);
    if (room() >= PRODUCTS.mini6.price)
      add({ product: "mini6", flavor: f, dip: f, side: "fries", qty: 1 });
    else if (room() >= PRODUCTS.mini1.price * 5)
      add({ product: "mini1", flavor: f, dip: f, qty: 5 });
    else if (room() >= PRODUCTS.mini1.price)
      add({ product: "mini1", flavor: f, dip: f, qty: Math.floor(room() / PRODUCTS.mini1.price) });
    else break;
    added++;
  }
  return { lines: out, added };
}

/** If drinks were asked for, add sodas up to one per guest within the remaining budget. */
export function topUpDrinks(
  text: string,
  lines: OrderLine[],
  req: ParsedRequest,
): { lines: OrderLine[]; added: number } {
  if (!req.headcount || !/\b(drink|drinks|soda|sodas|beverage|beverages|juice)\b/i.test(text))
    return { lines, added: 0 };
  const have = lines
    .filter((l) => l.product === "soda" || l.product === "juice")
    .reduce((s, l) => s + l.qty, 0);
  const room = req.budget === null ? Infinity : req.budget - computeOrder(lines, false).total;
  const add = Math.max(0, Math.min(req.headcount - have, Math.floor(room / PRODUCTS.soda.price)));
  if (!add) return { lines, added: 0 };
  const sodas = split(add, Math.min(2, add)).map((qty, i): OrderLine => ({
    product: "soda",
    drink: SODA_CHOICES[i] ?? "Coke",
    qty,
  }));
  return { lines: mergeLines([...lines, ...sodas]), added: add };
}

/** Facts-only summary computed from the final lines (model text is kept only as flavor text). */
export function describePlan(lines: OrderLine[], req: ParsedRequest, flavors: FlavorInfo[]) {
  const spicyIds = new Set(flavors.filter(isSpicy).map((f) => f.id));
  const servings = servingsOf(lines);
  const spicy = Math.round(servingsOf(lines.filter((l) => l.flavor && spicyIds.has(l.flavor))));
  const { total } = computeOrder(lines, false);
  const feeds = req.headcount
    ? `Feeds ${Math.min(req.headcount, Math.floor(servings + 0.01))} of ${req.headcount} guests`
    : `About ${Math.floor(servings)} servings`;
  const split = ` · ${spicy} spicy / ${Math.max(0, Math.round(servings) - spicy)} mild`;
  const money =
    req.budget !== null
      ? ` · $${total.toFixed(2)} of $${req.budget.toFixed(2)} budget`
      : ` · $${total.toFixed(2)}`;
  return feeds + split + money + ".";
}

/** Merge identical lines (same product and options) so the cart stays tidy. */
export function mergeLines(lines: OrderLine[]): OrderLine[] {
  const out: OrderLine[] = [];
  const key = (l: OrderLine) =>
    JSON.stringify([l.product, l.flavor, l.dip, l.side, l.drink, l.slaw]);
  for (const l of lines) {
    const same = out.find((o) => key(o) === key(l) && o.qty + l.qty <= 500);
    if (same) same.qty += l.qty;
    else out.push({ ...l });
  }
  return out;
}

/**
 * Bring an over-budget plan under budget deterministically while keeping guests fed:
 * drop extras, then meal -> sandwich (-$1), then sandwich -> 5 mini pieces (-$0.50),
 * and only as a last resort remove pieces.
 */
export function fitBudget(
  lines: OrderLine[],
  budget: number | null,
): { lines: OrderLine[]; changed: boolean } {
  if (budget === null) return { lines, changed: false };
  let out = lines.map((l) => ({ ...l }));
  const over = () => computeOrder(out, false).total > budget + 0.005;
  if (!over()) return { lines, changed: false };
  const take = (pred: (l: OrderLine) => boolean, make: (l: OrderLine) => OrderLine | null) => {
    const l = out.find((x) => pred(x) && x.qty > 0);
    if (!l) return false;
    l.qty -= 1;
    const repl = make(l);
    if (repl) out.push(repl);
    out = mergeLines(out.filter((x) => x.qty > 0));
    return true;
  };
  for (let guard = 0; guard < 3000 && over(); guard++) {
    if (
      take(
        (l) => l.product === "dip",
        () => null,
      )
    )
      continue;
    if (
      take(
        (l) => l.product === "mini6" || l.product === "large3",
        (l) => ({
          product: "sandwich",
          flavor: l.flavor,
          dip: l.dip ?? l.flavor,
          slaw: false,
          qty: 1,
        }),
      )
    )
      continue;
    if (
      take(
        (l) => l.product === "sandwich",
        (l) => ({ product: "mini1", flavor: l.flavor, dip: l.dip ?? l.flavor, qty: 5 }),
      )
    )
      continue;
    if (
      take(
        (l) => l.product === "soda" || l.product === "juice",
        () => null,
      )
    )
      continue;
    if (
      take(
        (l) => l.product === "mini1",
        () => null,
      )
    )
      continue;
    break;
  }
  return { lines: out, changed: true };
}
