// PayPal Orders API v2 client (server-only). Uses fetch so it runs on Node and Cloudflare Workers.
// Docs: https://developer.paypal.com/docs/api/orders/v2/
export type PayPalEnv = "sandbox" | "live";

export type PayPalConfig = { clientId: string; clientSecret: string; env: PayPalEnv };

export class PayPalError extends Error {
  constructor(
    message: string,
    public status: number,
    public issue?: string,
    public debugId?: string,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

export function readPayPalConfig(
  env: Record<string, string | undefined> = process.env,
): PayPalConfig | null {
  const clientId = env["PAYPAL_CLIENT_ID"]?.trim();
  const clientSecret = env["PAYPAL_CLIENT_SECRET"]?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, env: env["PAYPAL_ENV"] === "live" ? "live" : "sandbox" };
}

export const paypalApiBase = (env: PayPalEnv) =>
  env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

export type PayPalOrder = {
  id: string;
  status: string;
  purchase_units?: Array<{
    reference_id?: string;
    custom_id?: string;
    amount?: { currency_code: string; value: string };
    payments?: {
      captures?: Array<{
        id: string;
        status: string;
        amount: { currency_code: string; value: string };
      }>;
    };
  }>;
  payer?: { email_address?: string; payer_id?: string };
};

export type CreateOrderInput = {
  referenceId: string; // our Supabase order id
  amount: string; // "123.45"
  currency?: string;
  description?: string;
  items?: Array<{ name: string; quantity: number; unitAmount: string }>;
  itemTotal?: string;
  discount?: string;
};

export function createPayPalClient(
  config: PayPalConfig,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
) {
  const base = paypalApiBase(config.env);
  let cached: { token: string; expiresAt: number } | null = null;

  async function parseError(res: Response): Promise<PayPalError> {
    let body: {
      name?: string;
      message?: string;
      details?: Array<{ issue?: string; description?: string }>;
      debug_id?: string;
    } = {};
    try {
      body = await res.json();
    } catch {
      /* not json */
    }
    const issue = body.details?.[0]?.issue ?? body.name;
    const msg =
      body.details?.[0]?.description ?? body.message ?? `PayPal request failed (${res.status})`;
    return new PayPalError(msg, res.status, issue, body.debug_id);
  }

  async function accessToken(): Promise<string> {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const res = await fetchImpl(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw await parseError(res);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  async function call<T>(
    path: string,
    init: { method: string; body?: unknown; requestId?: string },
  ): Promise<T> {
    const token = await accessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
    if (init.requestId) headers["PayPal-Request-Id"] = init.requestId;
    const res = await fetchImpl(`${base}${path}`, {
      method: init.method,
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    if (!res.ok) throw await parseError(res);
    return (await res.json()) as T;
  }

  return {
    accessToken,
    createOrder(input: CreateOrderInput) {
      const currency = input.currency ?? "USD";
      const breakdown = input.itemTotal
        ? {
            item_total: { currency_code: currency, value: input.itemTotal },
            ...(input.discount && input.discount !== "0.00"
              ? { discount: { currency_code: currency, value: input.discount } }
              : {}),
          }
        : undefined;
      return call<PayPalOrder>("/v2/checkout/orders", {
        method: "POST",
        requestId: `create-${input.referenceId}`,
        body: {
          intent: "CAPTURE",
          purchase_units: [
            {
              reference_id: input.referenceId,
              custom_id: input.referenceId,
              description: input.description?.slice(0, 127),
              amount: {
                currency_code: currency,
                value: input.amount,
                ...(breakdown ? { breakdown } : {}),
              },
              ...(input.items && breakdown
                ? {
                    items: input.items.map((i) => ({
                      name: i.name.slice(0, 127),
                      quantity: String(i.quantity),
                      unit_amount: { currency_code: currency, value: i.unitAmount },
                      category: "PHYSICAL_GOODS",
                    })),
                  }
                : {}),
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                brand_name: "Chicky Drip Catering",
                shipping_preference: "NO_SHIPPING",
                user_action: "PAY_NOW",
              },
            },
          },
        },
      });
    },
    captureOrder(paypalOrderId: string) {
      return call<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
        method: "POST",
        body: {},
        requestId: `capture-${paypalOrderId}`,
      });
    },
    getOrder(paypalOrderId: string) {
      return call<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`, {
        method: "GET",
      });
    },
  };
}

export type PayPalClient = ReturnType<typeof createPayPalClient>;

/** First completed capture on the order, if any. */
export function completedCapture(order: PayPalOrder) {
  for (const pu of order.purchase_units ?? [])
    for (const c of pu.payments?.captures ?? []) if (c.status === "COMPLETED") return c;
  return null;
}
