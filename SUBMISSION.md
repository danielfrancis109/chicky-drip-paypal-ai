# PayPal AI Hackathon: Submission Draft (Chicky Drip)

Deadline: **Thu Nov 12, 2026, 3:00 PM ET** (12:00 PM PT). Entrant: InfinityBuilds LLC (Representative: Daniel Francis).

Fill-ins before submitting: `<REPO_URL>`, `<DEMO_URL>`, `<YOUTUBE_URL>`, `<BASELINE_SHA>`, sandbox buyer login for judges.

---

## Devpost project text

**Project name:** Chicky Drip: AI-planned catering, paid with PayPal

**Tagline (≤200 chars):** Tell the AI "feeding 40, half like spicy, $300" and get a real catering order from the menu, then pay in one tap with PayPal. Payment confirms the order and fills your rewards.

### Inspiration
Chicky Drip is a real small catering business with 10 signature sauces. Its website took catering *requests*:
customers built big orders line by line, hit "Place Order", and then the owner had to call every customer to
work out quantities and collect money. Orders went unpaid, some customers disappeared, and the "10 orders = free
meal" rewards counted orders that never paid. Small caterers live and die on that back-and-forth. We wanted
ordering for a party to be as easy as describing the party, and getting paid to be automatic.

### What it does
* **Drip Planner (AI):** a customer types something like *"feeding 40 people, half like spicy, budget $300"*. The
  AI builds a full order (items, flavors, sides, dips, drinks, quantities and total) using **only real menu items
  and prices**. One click adds it to the cart, where they can tweak it.
* **PayPal checkout:** PayPal Smart Buttons right on the order page. The server re-prices the cart from the menu,
  creates a PayPal order with a full item breakdown, captures it after approval and verifies the captured amount.
* **Rewards that respect payment:** the Drip Meter only fills when PayPal capture succeeds. After 10 paid orders,
  the free $15 meal is applied as a **PayPal discount** (or confirmed instantly if it covers the whole order).
* **Owner tools:** the admin sees which orders are paid (with PayPal capture IDs), can hide abandoned checkouts,
  and gets **AI Insights**: revenue, top flavors, and paid events coming up this week, written as a quick prep
  briefing.

### How we built it
* **Stack:** TanStack Start (React 19 + TypeScript) with server functions, Tailwind, Supabase (Postgres + auth + RLS),
  deployable to Cloudflare Workers.
* **PayPal:** Orders API v2 called server-side (OAuth client credentials, create order with `intent: CAPTURE`,
  item breakdown + discount, capture, `PayPal-Request-Id` idempotency), and the PayPal JS SDK via
  `@paypal/react-paypal-js`. We handle `INSTRUMENT_DECLINED` (buyer retries with another funding source) and
  `ORDER_ALREADY_CAPTURED`, and refuse to mark an order paid if the captured amount doesn't match our server total.
* **AI:** any OpenAI-compatible chat model with JSON output. The system prompt contains the live menu, prices,
  flavor names and heat levels. The reply is validated with **zod**, every item is mapped to real product/flavor IDs
  and checked by the same validator the checkout uses, and totals are always recomputed from the menu, so the model
  can never invent an item or a price. If the model is unavailable, a deterministic planner takes over and the UI
  labels it clearly.
* **Data:** one additive SQL migration adds payment status, PayPal order/capture IDs and paid time. Existing orders
  are marked `legacy`, so no customer loses Drip Meter progress.
* **Quality:** 55 Vitest tests cover pricing, rewards, AI output validation, and the full create/capture flow
  against a mocked PayPal API.

### Challenges we ran into
* **Trusting nothing from the client or the model.** Prices come only from the server menu; AI output goes through
  schema validation *and* business-rule validation before it can reach the cart, and again at checkout.
* **Rewards vs. payments.** A $15 reward can make a cart cost $0, which PayPal can't charge, and two tabs could try
  to spend one reward. We confirm $0 orders without PayPal and re-check the reward right before capture.
* **Migrating a live business without breaking it.** Old "pay at pickup" orders had to keep counting toward rewards.

### Accomplishments that we're proud of
A real small business can now go from "I'm feeding 40 people" to a paid, confirmed order in under a minute,
and the owner stops chasing payments.

### What we learned
Structured output plus strict validation turns an LLM into a dependable sales assistant. PayPal's Orders v2
breakdown and discount fields map cleanly onto real-world reward programs.

### What's next for Chicky Drip
* Deposits for very large events (authorize now, capture on delivery) and owner-side refunds from the admin.
* Venmo and Pay Later buttons for big party orders.
* Pickup/delivery time slots and capacity limits fed into the AI planner.
* Offering the planner + PayPal checkout as a template for other local caterers we build sites for.

### Built with
`paypal-orders-api-v2` `paypal-js-sdk` `react` `typescript` `tanstack-start` `supabase` `postgresql` `tailwindcss`
`zod` `openai-compatible-llm` `vitest` `cloudflare-workers`

### Links
* Code: `<REPO_URL>` (MIT license)
* Demo: `<DEMO_URL>` (or follow README "Run it locally")
* Video: `<YOUTUBE_URL>`

### Testing instructions for judges (paste into Devpost)
1. Open `<DEMO_URL>` and create an account (any email) or use the test login `<TEST_LOGIN>`.
2. Order page > Drip Planner > pick an example prompt > **Add all to my order** > enter name/phone > **PayPal**.
3. In the PayPal sandbox popup sign in as `<SANDBOX_BUYER_EMAIL>` / `<SANDBOX_BUYER_PASSWORD>`.
4. You're redirected to Rewards: the order is **Paid via PayPal** and the Drip Meter went up.
The demo stays free and available through Dec 15, 2026.

---

## "Significantly updated" explanation (paste into Devpost)

Chicky Drip existed before the Submission Period as a catering *request* site (version 0.8.0). Customers could
not pay online, there was no AI, and rewards counted unpaid requests. During the Submission Period (after
Oct 1, 2026) we added:

1. **PayPal Orders API v2 checkout** (server-side create + capture, JS SDK buttons, amount verification, declined-card
   retry, idempotency), replacing the unpaid "Place Order" flow.
2. **A payments data model** (new migration: payment status, PayPal order/capture IDs, paid time) and a reworked
   rewards engine so the Drip Meter fills only on captured payments, with the free meal sent to PayPal as a discount.
3. **The Drip Planner AI assistant**, which turns a plain-English event description into a menu-validated order that
   goes straight to PayPal checkout.
4. **Owner AI Insights** plus payment status and capture IDs in the admin.
5. **Tests** grew from 17 to 55, covering the PayPal flow and the AI validation.

The repo's first commit `<BASELINE_SHA>` is the pre-hackathon app; `git diff <BASELINE_SHA>..HEAD` shows the full
update (about 2,200 lines of new code and tests, 16 new source files plus a SQL migration).

---

## Demo video script (target 2:40, hard limit < 3:00)

Recording tips: 1080p browser window, sandbox mode, a logged-in customer account with **9 paid orders** already
(so the 10th fills the meter) plus an admin account. No copyrighted music. Voiceover by Daniel.

| # | Time | Screen | Voiceover |
|---|------|--------|-----------|
| 1 | 0:00–0:12 | Home page hero, scroll to flavors | "This is Chicky Drip, a real saucy-chicken catering business. Before this hackathon, every catering order was just a request: no payment, lots of phone calls." |
| 2 | 0:12–0:22 | Quick cut: old flow (baseline "Place Order" button) or a text card "Before: request → phone call → maybe paid" | "Owners chase quantities and payments, and customers guess how much food to order." |
| 3 | 0:22–0:50 | Order page > Drip Planner. Type "feeding 40 people, half like spicy, budget $300". Click Plan. Result card appears with the "AI recommendation" badge, items, total | "Now you just describe the party. The AI plans a full order from the real menu: flavors split between spicy and mild, sides, dips, under budget. It can only use real items, and every price is recalculated on our server." |
| 4 | 0:50–1:02 | Click **Add all to my order**; cart fills; change one quantity | "One click puts it in the cart, and you can still tweak anything." |
| 5 | 1:02–1:35 | Enter name + phone + event date. Click PayPal button, sandbox popup, log in as sandbox buyer, show item breakdown in PayPal, Pay Now | "Checkout is PayPal. Our server creates a PayPal order with the full itemized breakdown. The buyer approves, and we capture it server-side and verify the amount before confirming." |
| 6 | 1:35–1:55 | Redirect to Rewards: "Paid via PayPal" badge, Drip Meter animates to 10/10, "free meal ready" banner | "The order is confirmed and paid, and that payment fills the Drip Meter. Ten paid orders earns a free $15 meal." |
| 7 | 1:55–2:15 | New small order, tick "Use my free meal", PayPal popup shows the -$15 discount | "Next time, the reward goes straight into PayPal as a discount." |
| 8 | 2:15–2:35 | Admin > Orders (paid badge, PayPal capture ID, hide unpaid toggle) > AI Insights, click Summarize | "For the owner: paid orders with PayPal capture IDs, abandoned checkouts hidden, and an AI briefing on revenue, top flavors and this week's events to prep for." |
| 9 | 2:35–2:45 | Code split: `checkout.server.ts` + test run "55 passed" + GitHub repo with MIT license | "Built with TanStack Start, Supabase, PayPal Orders v2 and an OpenAI-compatible model, with 55 tests. Chicky Drip: describe it, pay with PayPal, eat." |

Backup if no AI key is set: the planner card says "Built-in planner (AI not configured, rule-based fallback)". Do
**not** record that for the final video; set `AI_API_KEY` first so the badge reads "AI recommendation".

---

## Submission checklist
- [ ] PayPal sandbox app created; `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` set on the host
- [ ] AI key set (`AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`)
- [ ] Supabase migration `supabase/migrations/20261109000000_paypal_payments.sql` applied; `SUPABASE_SERVICE_ROLE_KEY` on host
- [ ] App deployed (Lovable publish or Cloudflare Workers) and the end-to-end sandbox payment tested
- [ ] Public GitHub repo with LICENSE visible in About; no `.env` committed
- [ ] YouTube video (public, < 3:00)
- [ ] Devpost registration + submission as InfinityBuilds LLC (Representative: Daniel Francis) before Thu Nov 12, 3:00 PM ET
- [ ] Judge test login + sandbox buyer credentials in testing instructions; keep demo up through Dec 15, 2026
