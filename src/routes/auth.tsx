import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import "@lovable.dev/cloud-auth-js/styles.css";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in | Chicky Drip Catering" },
      { name: "description", content: "Create a Chicky Drip account to order and earn free meals." },
      { property: "og:title", content: "Sign in to Chicky Drip" },
      { property: "og:description", content: "Order catering and start earning points." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const [mode, setMode] = useState<"in" | "up">("up");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (mode === "up") {
      const { error } = await supabase.auth.signUp({ email, password: pw, options: { emailRedirectTo: window.location.origin + "/rewards" } });
      if (error) toast.error(error.message);
      else toast.success("Check your email to confirm your account.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
      if (error) toast.error(error.message);
      else nav({ to: "/rewards" });
    }
    setBusy(false);
  };
  const social = async (p: "google" | "lovable") => {
    const r = await lovable.auth.signInWithOAuth(p, { redirect_uri: window.location.origin });
    if (r.error) toast.error(String(r.error));
    else if (!r.redirected) nav({ to: "/rewards" });
  };
  const input = "w-full rounded-lg border-2 border-border bg-background px-4 py-3 outline-none focus:border-accent";
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-fire text-center text-6xl">{mode === "up" ? "Join the Drip" : "Welcome Back"}</h1>
      <p className="mt-2 text-center text-muted-foreground">Make an account and start earning points toward free meals.</p>
      <div className="mt-8 space-y-3 rounded-2xl border-2 border-primary bg-card p-6">
        <button type="button" onClick={() => social("google")} className="w-full rounded-lg bg-foreground py-3 font-medium text-background">Continue with Google</button>
        <button type="button" className="lovable-auth-button w-full" onClick={() => social("lovable")}>Continue with Lovable</button>
        <div className="py-2 text-center text-sm text-muted-foreground">or with email</div>
        <form onSubmit={submit} className="space-y-3">
          <input className={input} type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={input} type="password" required minLength={6} placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button disabled={busy} className="w-full rounded-lg bg-primary py-3 font-display text-2xl tracking-wider text-primary-foreground">
            {mode === "up" ? "Create Account" : "Sign In"}
          </button>
        </form>
        <button className="w-full text-sm text-drip" onClick={() => setMode(mode === "up" ? "in" : "up")}>
          {mode === "up" ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
      </div>
    </main>
  );
}
