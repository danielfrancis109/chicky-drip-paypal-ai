import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { toast } from "sonner";
import { capturePayPalOrder, createPayPalOrder, getPayPalConfig } from "@/lib/checkout.functions";
import type { CheckoutInput } from "@/lib/checkout.schema";

type Props = {
  payload: CheckoutInput;
  /** Returns an error message if the form isn't ready (shown instead of opening PayPal). */
  validate: () => string | null;
  onPaid: (orderId: string) => void;
};

/** PayPal Smart Buttons wired to our server functions (Orders API v2: create on server, capture on server). */
export function PayPalCheckout({ payload, validate, onPaid }: Props) {
  const getConfig = useServerFn(getPayPalConfig);
  const createFn = useServerFn(createPayPalOrder);
  const captureFn = useServerFn(capturePayPalOrder);
  const { data: cfg, isLoading } = useQuery({
    queryKey: ["paypal_config"],
    queryFn: () => getConfig(),
    staleTime: Infinity,
  });
  // PayPal keeps the first callbacks it was given, so read the latest cart/form through a ref.
  const latest = useRef(payload);
  latest.current = payload;
  const validateRef = useRef(validate);
  validateRef.current = validate;

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading PayPal…</p>;
  if (!cfg?.configured || !cfg.clientId)
    return (
      <p className="rounded-lg border-2 border-dashed border-border p-3 text-sm text-muted-foreground">
        PayPal isn't configured on this server yet. Set <code>PAYPAL_CLIENT_ID</code> and{" "}
        <code>PAYPAL_CLIENT_SECRET</code> (sandbox) to take payments.
      </p>
    );

  return (
    <div className="space-y-2">
      {cfg.env === "sandbox" && (
        <p className="text-xs text-muted-foreground">
          PayPal sandbox mode: use a sandbox test buyer account, no real money moves.
        </p>
      )}
      <PayPalScriptProvider
        options={{
          clientId: cfg.clientId,
          currency: cfg.currency,
          intent: "capture",
          components: "buttons",
        }}
      >
        <PayPalButtons
          style={{ layout: "vertical", shape: "pill", label: "pay" }}
          onClick={(_data, actions) => {
            const problem = validateRef.current();
            if (problem) {
              toast.error(problem);
              return actions.reject();
            }
            return actions.resolve();
          }}
          createOrder={async () => {
            const res = await createFn({ data: latest.current });
            if (res.mode !== "paypal")
              throw new Error("This order is free; use the free meal button.");
            return res.paypalOrderId;
          }}
          onApprove={async (data, actions) => {
            const res = await captureFn({ data: { paypalOrderId: data.orderID } });
            if (!res.ok) {
              toast.error(res.message);
              return actions.restart();
            }
            onPaid(res.orderId);
          }}
          onCancel={() => toast("Payment cancelled. Your cart is still here.")}
          onError={(err) =>
            toast.error(
              err instanceof Error ? err.message : "PayPal checkout failed. Please try again.",
            )
          }
        />
      </PayPalScriptProvider>
    </div>
  );
}
