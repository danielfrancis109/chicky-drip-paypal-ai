import { createFileRoute, Link } from "@tanstack/react-router";
import logo from "@/assets/logo.png.asset.json";
import wings from "@/assets/wings.jpg.asset.json";
import sauces from "@/assets/sauces.jpg.asset.json";
import { useContent } from "@/lib/content";
import { FlavorGrid } from "@/components/FlavorGrid";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Chicky Drip Catering | Saucy Chicken for Any Crowd" },
      { name: "description", content: "Order Chicky Drip chicken catering: mini drums, large drums, sandwiches and 10 drip flavors. Earn a free meal every 10 orders." },
      { property: "og:title", content: "Chicky Drip Catering" },
      { property: "og:description", content: "Sauce it. Dip it. Drip it. Order catering and earn free meals." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const t = useContent();
  return (
    <main>
      <section className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-12 md:grid-cols-2">
        <div>
          <p className="font-script text-3xl text-drip">{t("hero_tagline")}</p>
          <h1 className="text-fire mt-2 text-6xl leading-none md:text-8xl">{t("hero_title")}</h1>
          <p className="mt-6 max-w-md text-lg text-muted-foreground">{t("hero_text")}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/order" className="rounded-full bg-primary px-8 py-3 font-display text-2xl tracking-wider text-primary-foreground shadow-[4px_4px_0_var(--drip)] hover:translate-y-0.5">
              Get Saucy
            </Link>
            <Link to="/menu" className="rounded-full border-2 border-drip px-8 py-3 font-display text-2xl tracking-wider text-drip">
              See Menu
            </Link>
          </div>
        </div>
        <img src={logo.url} alt="Chicky Drip logo" className="mx-auto w-full max-w-md drop-shadow-2xl" />
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 md:grid-cols-2">
        <img src={wings.url} alt="Saucy chicken in a Chicky Drip box" className="h-72 w-full rounded-2xl border-4 border-primary object-cover" />
        <img src={sauces.url} alt="Dipping sauces" className="h-72 w-full rounded-2xl border-4 border-accent object-cover" />
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-fire text-5xl md:text-6xl">The Drip Lineup</h2>
        <p className="mt-2 text-muted-foreground">{t("flavors_intro")}</p>
        <div className="mt-8"><FlavorGrid /></div>
      </section>

      <section className="mx-auto max-w-6xl px-4">
        <div className="bg-fire rounded-3xl p-8 text-drip-foreground md:p-12">
          <h2 className="text-5xl">{t("rewards_title")}</h2>
          <p className="mt-2 max-w-xl text-lg font-medium">{t("rewards_text")}</p>
          <Link to="/rewards" className="mt-6 inline-block rounded-full bg-background px-6 py-2 font-display text-xl text-drip">
            Check my Drip Meter
          </Link>
        </div>
      </section>
    </main>
  );
}
