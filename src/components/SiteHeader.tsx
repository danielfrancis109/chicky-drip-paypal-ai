import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import logo from "@/assets/logo.png.asset.json";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export function Drip({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 1200 40" preserveAspectRatio="none" className={`block w-full h-6 ${className}`} aria-hidden>
      <path
        fill="currentColor"
        d="M0 0h1200v10c-30 0-30 22-60 22s-20-14-50-14-25 26-55 26-25-30-60-30-35 16-60 16-30-12-55-12-30 28-60 28-30-26-60-26-25 12-55 12-30-18-60-18-35 30-65 30-25-28-55-28-30 14-60 14-30-20-55-20-30 24-60 24-25-22-55-22-35 18-60 18-25-12-55-12-30 26-60 26S70 10 40 10 10 20 0 20z"
      />
    </svg>
  );
}

export function SiteHeader() {
  const { user, isAdmin } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const link = "font-display text-lg tracking-wider hover:text-drip transition-colors";
  return (
    <header className="sticky top-0 z-40">
      <div className="bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2">
          <Link to="/" className="shrink-0">
            <img src={logo.url} alt="Chicky Drip" className="h-14 w-auto" />
          </Link>
          <nav className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1">
            <Link to="/menu" className={link}>Menu</Link>
            <Link to="/order" className={link}>Order</Link>
            <Link to="/rewards" className={link}>Rewards</Link>
            {isAdmin && <Link to="/admin" className={link}>Admin</Link>}
            {user ? (
              <button
                className="rounded-full bg-background px-4 py-1 font-display text-lg text-drip"
                onClick={async () => {
                  await qc.cancelQueries();
                  await supabase.auth.signOut();
                  nav({ to: "/", replace: true });
                }}
              >
                Sign out
              </button>
            ) : (
              <Link to="/auth" className="rounded-full bg-background px-4 py-1 font-display text-lg text-drip">
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </div>
      <Drip className="text-primary -mt-px" />
    </header>
  );
}
