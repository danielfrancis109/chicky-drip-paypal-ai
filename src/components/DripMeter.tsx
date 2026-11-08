import { REWARD_EVERY } from "@/lib/menu";

export function DripMeter({ progress, available, toNext }: { progress: number; available: number; toNext: number }) {
  return (
    <div className="rounded-2xl border-2 border-accent bg-card p-6">
      <div className="flex items-end justify-between">
        <h2 className="text-4xl text-drip">Drip Meter</h2>
        <span className="font-display text-3xl">{progress}/{REWARD_EVERY}</span>
      </div>
      <div className="mt-4 grid grid-cols-10 gap-1.5">
        {Array.from({ length: REWARD_EVERY }, (_, i) => (
          <div key={i} className={`h-8 rounded-b-full ${i < progress ? "bg-fire" : "bg-muted"}`} />
        ))}
      </div>
      <p className="mt-4 text-muted-foreground">
        {toNext} more order{toNext === 1 ? "" : "s"} to your next free meal ($15).
      </p>
      {available > 0 && (
        <p className="mt-3 rounded-lg bg-drip px-4 py-2 font-display text-xl text-drip-foreground">
          You have {available} free meal{available > 1 ? "s" : ""} ready! Use it at checkout.
        </p>
      )}
    </div>
  );
}
