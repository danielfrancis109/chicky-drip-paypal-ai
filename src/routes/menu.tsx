import { createFileRoute, Link } from "@tanstack/react-router";
import { PRODUCTS } from "@/lib/menu";
import { useContent } from "@/lib/content";
import { FlavorGrid } from "@/components/FlavorGrid";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/menu")({
  head: () => ({
    meta: [
      { title: "Menu | Chicky Drip Catering" },
      { name: "description", content: "Chicken sandwiches, mini drums & thighs, large drums, fries, cole slaw and rice in 10 flavors." },
      { property: "og:title", content: "Chicky Drip Menu" },
      { property: "og:description", content: "Pick your chicken, pick your drip, add your sides." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MenuPage,
});

function MenuPage() {
  const t = useContent();
  const list = (g: "chicken" | "side" | "extra" | "drink") =>
    Object.entries(PRODUCTS).filter(([, p]) => p.group === g).map(([id, p]) => (
      <div key={id} className="flex items-center justify-between border-b border-dashed border-border py-3">
        <span className="min-w-0 text-lg font-medium">{p.name}</span>
        <span className="ml-3 shrink-0 font-display text-2xl text-drip">${p.price.toFixed(2)}</span>
      </div>
    ));
  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="text-fire text-6xl">Menu</h1>
      <p className="mt-2 text-muted-foreground">{t("menu_intro")}</p>
      <div className="mt-8 grid gap-8 md:grid-cols-2">
        <section><h2 className="text-4xl text-accent">Chicken</h2><p className="mt-3 text-drip">{t("menu_meal_note")}</p>{list("chicken")}<p className="mt-3 text-sm text-muted-foreground">{t("menu_sandwich_note")}</p></section>
        <section><h2 className="text-4xl text-accent">Sides</h2>{list("side")}<h2 className="mt-8 text-4xl text-accent">Dips</h2>{list("extra")}<p className="mt-3 text-sm text-muted-foreground">{t("menu_extras_note")}</p></section>
        <section><h2 className="text-4xl text-accent">Drinks</h2>{list("drink")}<p className="mt-3 text-muted-foreground">{t("menu_drinks_note")}</p></section>
      </div>
      <h2 className="text-fire mt-16 text-5xl">Flavors</h2>
      <div className="mt-6"><FlavorGrid /></div>
      <div className="mt-10 text-center">
        <Button asChild size="lg" className="font-display text-2xl"><Link to="/order">Start an Order</Link></Button>
      </div>
    </main>
  );
}
