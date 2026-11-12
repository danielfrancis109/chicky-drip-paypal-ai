# Chicky Drip Catering · PayPal + AI checkout

Chicky Drip is a real catering business site for a saucy-chicken caterer: a menu with 10 "drip" flavors,
online catering orders, a **Drip Meter** rewards program (10 orders = a free $15 meal) and owner admin tools.

For the **PayPal AI Hackathon (Nov 2026)** we turned it from an "order request" form into a working
commerce app: customers describe their event to an **AI catering planner**, add the recommended order
with one click, and **pay with PayPal** (Orders API v2, sandbox). Payment confirms the order and fills
their Drip Meter; earned free meals are applied as a PayPal discount.

> Built by InfinityBuilds LLC. MIT licensed (see [LICENSE](LICENSE)).

## Live demo (for judges)

**https://chicky-drip-paypal.danielfrancis109.workers.dev** (Cloudflare Workers, PayPal **sandbox**, no real money)

1. Open the demo, click **Sign in** and use **Continue with Google**, or create an email account (email sign-ups need the confirmation link sent to your inbox).
2. Go to **Order**. In the **Drip Planner** type or click: *"Feeding 40 people, half like spicy, budget $300"* and press **Add all to my order**.
3. Enter a name + phone and click the yellow **PayPal** button. Log in with a **PayPal sandbox buyer** account:
   [developer.paypal.com](https://developer.paypal.com) > **Testing Tools** > **Sandbox Accounts** > the *Personal*
   (buyer) account > **View/Edit account** for the email + password. (Judges' own sandbox accounts work: the demo uses a
   standard sandbox merchant app.)
4. Approve the payment. You land on **Rewards**: the order is "Paid via PayPal" and the **Drip Meter** went up by one.
5. The owner/admin view (**Admin**: payment badges, PayPal capture ids, **AI Insights**) is available to the first
   account registered on a project; ask the team for an admin login if you want to see it live.

## For judges: what was added during the hackathon

The repository history starts with a **baseline commit** (`Baseline: Chicky Drip 0.8.0 ...`) that is the
app exactly as it existed before the update. Everything after it is hackathon work
(`git diff <baseline>..HEAD --stat`).

| Before (baseline 0.8.0) | After (hackathon update) |
| --- | --- |
| "Place Order" saved an unpaid request; staff called to collect money | **PayPal Smart Buttons** checkout; server creates and captures the PayPal order |
| Totals shown in the browser | Totals **re-priced on the server** from the menu; captured amount verified before marking paid |
| Drip Meter counted any submitted order (even never-paid ones) | Drip Meter fills **only on successful PayPal capture** (legacy pay-at-pickup orders still count) |
| Free $15 meal subtracted on a request | Free meal sent to PayPal as a **discount line**; fully-covered orders confirmed without PayPal ($0) |
| Customers had to build big catering orders line by line | **Drip Planner AI**: "feeding 40 people, half like spicy, budget $300" -> a menu-valid order, one click to cart |
| Admin saw a raw list | Payment badges, PayPal capture ids, hide abandoned checkouts, **AI Insights** summary of paid orders |
| 17 tests | 69 tests (pricing, rewards, AI validation, PayPal server flow with mocked fetch) |

## How PayPal is used

* `src/lib/paypal.server.ts`: small PayPal REST client (OAuth client-credentials token, `POST /v2/checkout/orders`,
  `POST /v2/checkout/orders/{id}/capture`, `GET` order). Uses `PayPal-Request-Id` for idempotency. Runs on Node and
  Cloudflare Workers (plain `fetch`).
* `src/lib/checkout.server.ts`:
  * `startCheckout`: validates every line against the menu, checks free-meal eligibility, prices the cart
    server-side, stores a `pending` order in Supabase, creates a PayPal order (`intent: CAPTURE`, item breakdown,
    `discount` for the reward, `custom_id` = our order id).
  * `finishCheckout`: re-checks the reward, captures, handles `INSTRUMENT_DECLINED` (buyer picks another funding
    source) and `ORDER_ALREADY_CAPTURED`, verifies the captured USD amount equals our total, then marks the order
    `paid` + `confirmed` (which increments the Drip Meter). Idempotent if called twice.
* `src/lib/checkout.functions.ts`: TanStack Start server functions (`createPayPalOrder`, `capturePayPalOrder`,
  `getPayPalConfig`) behind Supabase auth.
* `src/components/PayPalCheckout.tsx`: `@paypal/react-paypal-js` buttons; `createOrder`/`onApprove` call the
  server functions. The client secret never leaves the server.

## How AI is used

* **Drip Planner** (`src/lib/ai/*`, `src/components/CateringAssistant.tsx`): the server sends the real menu, prices,
  flavor names/heat levels and rules to any **OpenAI-compatible Chat Completions API** (`AI_API_KEY`,
  `AI_BASE_URL`, `AI_MODEL`) with JSON output. The reply is validated with **zod**, then every item is mapped to
  real product/flavor ids and checked with the same `validateOrderLine` used at checkout; invented items are
  dropped with a warning, and totals are always recomputed from the menu (never from the model). Over-budget plans
  are flagged.
* **Fallback**: with no key (or if the model fails/returns junk) a deterministic planner builds the plan and the UI
  labels it "Built-in planner (AI not configured, rule-based fallback)", so the demo always works.
* **Owner AI Insights** (Admin > AI Insights): stats over paid orders (revenue, top flavors, events in the next
  7 days, abandoned checkouts) plus an AI-written summary (rule-based summary without a key).

## Run it locally

Requirements: [Bun](https://bun.sh) 1.x (or Node 20+ / npm), a Supabase project, a free PayPal developer account.

```sh
bun install            # or: npm install
cp .env.example .env   # fill in values (see below)
bun run dev            # or: npm run dev   -> http://localhost:5173 (port shown in terminal)
bun run test           # or: npm test
bun run build          # or: npm run build (Cloudflare Workers output in .output/)
# deploy: npx wrangler deploy -c .output/server/wrangler.json   (then set the secrets listed in .env.example as Worker secrets)
```

### 1. Supabase

* **Fresh project** (judges): in the Supabase SQL editor run, in order,
  1. `drizzle/migrations/0000_migration.sql` (original schema: roles, site text, orders, RLS)
  2. `supabase/migrations/20261109000000_paypal_payments.sql` (hackathon: payment columns)
* **Existing Chicky Drip project**: run only step 2. It adds `payment_status`, `paypal_order_id`,
  `paypal_capture_id`, `paid_at`, `currency`, marks existing orders `legacy` so their Drip Meter progress is
  unchanged, and adds a unique index on `paypal_order_id`.
* Put the project URL, publishable (anon) key and **service role key** in `.env`.
* **No service-role key?** (for example a Lovable Cloud project you do not own): also run
  3. `supabase/migrations/20261112000000_server_rpc.sql`, and set `SERVER_RPC_TOKEN` (any 64 hex chars) on the host.
  It adds a private checker function holding only the SHA-256 hash of that token plus a handful of narrow `SECURITY DEFINER`
  functions (`srv_*`) that refuse to run without the token. The server then does checkout, cancel and owner
  insights through those functions with just the publishable key. Generate a token and its hash with
  `t=$(openssl rand -hex 32); printf %s "$t" | sha256sum`, and put the hash in the hash literal in `private.srv_check_token`.
  If `SUPABASE_SERVICE_ROLE_KEY` is set it is used instead.
* The first account that signs up becomes the admin (DB trigger).

### 2. PayPal sandbox

1. Log in at [developer.paypal.com](https://developer.paypal.com) > **Apps & Credentials** > **Sandbox** > create an app.
2. Copy the **Client ID** and **Secret** into `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`, keep `PAYPAL_ENV=sandbox`.
3. **Testing tools > Sandbox accounts** lists a default *Personal* (buyer) account. Use its email and password
   (View/Edit account) in the PayPal popup. No real money moves.

### 3. AI (optional)

Set `AI_API_KEY` (plus `AI_BASE_URL` / `AI_MODEL` for non-OpenAI providers such as Groq, OpenRouter, xAI, a
Lovable AI gateway or local Ollama). Without a key the labeled rule-based fallback is used.

## Test walkthrough

1. Sign up / sign in (first account = admin).
2. **Order** page > Drip Planner > click "Feeding 40 people, half like spicy, budget $300" > **Add all to my order**.
3. Enter name + phone, click the **PayPal** button, log in with the sandbox buyer, approve.
4. You land on **Rewards**: the order shows "Paid via PayPal" and the Drip Meter went up by one.
5. **Admin** > Orders shows the payment badge and PayPal capture id; **AI Insights** summarizes paid orders.
6. Free meal: after 10 paid orders, tick "Use my free meal ($15 off)"; PayPal shows the $15 discount
   (or "Redeem free meal" if it covers the whole cart).

## Project layout

```
src/lib/menu.ts                 menu, prices, pricing + Drip Meter rules (pure)
src/lib/paypal.server.ts        PayPal Orders v2 REST client
src/lib/checkout.server.ts      create/capture business logic
src/lib/checkout.functions.ts   server functions used by the order page
src/lib/ai/catering-plan.ts     AI schema, menu validation, deterministic planner
src/lib/ai/llm.server.ts        OpenAI-compatible client + planner orchestration
src/lib/ai/insights.ts          owner insights
src/lib/ai.functions.ts         planCatering / adminInsights server functions
supabase/migrations/            schema changes for payments
```

## Security notes

* Secrets (`PAYPAL_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` or `SERVER_RPC_TOKEN`, `AI_API_KEY`) are read only in server code; `.env`
  is git-ignored. Only the PayPal client id and Supabase publishable key reach the browser.
* Prices, rewards and totals are computed on the server; client-sent prices are stripped by the zod schema.
* Customers cannot self-cancel paid orders (the owner handles refunds).

## Built with

TanStack Start, React 19, TypeScript, Tailwind CSS, Supabase (via Lovable Cloud), PayPal Orders API v2 +
PayPal JS SDK (`@paypal/react-paypal-js`), an OpenAI-compatible LLM API, zod, Vitest.
