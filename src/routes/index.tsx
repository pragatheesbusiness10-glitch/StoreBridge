import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Store, PackageCheck, Rocket, Lock } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-primary p-1.5 text-primary-foreground">
              <Store className="h-5 w-5" />
            </div>
            <span className="font-semibold">StoreBridge</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/auth"><Button variant="ghost">Sign in</Button></Link>
            <Link to="/auth"><Button>Get started</Button></Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-24 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-primary" /> Product intake for Shopify & WooCommerce
        </div>
        <h1 className="mt-6 text-4xl md:text-6xl font-semibold tracking-tight max-w-3xl mx-auto">
          Collect, review, and publish products for every client.
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
          StoreBridge gives your agency a clean intake portal for clients and a control panel to
          approve or reject submissions and push them live to Shopify or WooCommerce in one click.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link to="/auth"><Button size="lg">Sign in to your workspace</Button></Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24 grid md:grid-cols-3 gap-6">
        {[
          { icon: PackageCheck, title: "Guided intake", body: "Clients upload rich product data with images, SEO, pricing, and inventory in one place." },
          { icon: Rocket, title: "One-click publish", body: "Route approved products to Shopify or WooCommerce via secure server-side APIs." },
          { icon: Lock, title: "Credentials stay safe", body: "Store API keys encrypted at rest — never exposed to the browser." },
        ].map((f) => (
          <div key={f.title} className="rounded-lg border bg-card p-6">
            <div className="rounded-md bg-primary/10 text-primary inline-flex p-2">
              <f.icon className="h-5 w-5" />
            </div>
            <h3 className="mt-4 font-semibold">{f.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
