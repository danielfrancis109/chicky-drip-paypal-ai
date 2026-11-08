import { FLAVOR_IDS } from "@/lib/menu";
import { useContent } from "@/lib/content";

export function FlavorGrid() {
  const t = useContent();
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {FLAVOR_IDS.map((id, i) => (
        <div key={id} className="relative overflow-hidden rounded-2xl border-2 border-border bg-card p-4">
          <div
            className="absolute inset-x-0 top-0 h-1.5"
            style={{ background: `color-mix(in oklab, var(--drip), var(--primary) ${i * 11}%)` }}
          />
          <span className="text-xs font-bold uppercase tracking-widest text-accent">{t(`${id}_heat`)}</span>
          <h3 className="mt-1 text-2xl text-drip">{t(id)}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t(`${id}_desc`)}</p>
        </div>
      ))}
    </div>
  );
}
