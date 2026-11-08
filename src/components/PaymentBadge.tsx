const LEGACY = { text: "Pay at pickup", cls: "bg-secondary text-secondary-foreground" };
const LABELS: Record<string, { text: string; cls: string }> = {
  paid: { text: "Paid via PayPal", cls: "bg-drip text-drip-foreground" },
  pending: { text: "Awaiting payment", cls: "bg-muted text-muted-foreground" },
  legacy: { text: "Pay at pickup", cls: "bg-secondary text-secondary-foreground" },
  failed: { text: "Payment failed", cls: "bg-destructive text-destructive-foreground" },
  refunded: { text: "Refunded", cls: "bg-secondary text-secondary-foreground" },
};

export function PaymentBadge({ status }: { status?: string | null }) {
  const l = LABELS[status ?? "legacy"] ?? LEGACY;
  return <span className={`rounded px-2 py-0.5 text-xs normal-case ${l.cls}`}>{l.text}</span>;
}
