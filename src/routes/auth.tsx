import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Store, Zap } from "lucide-react";

type AuthSearch = { redirect?: string };

export const Route = createFileRoute("/auth")({
  // Optional post-login destination (same-origin paths only). Used by the Prime Physique module.
  validateSearch: (s: Record<string, unknown>): AuthSearch =>
    typeof s.redirect === "string" && s.redirect.startsWith("/") && !s.redirect.startsWith("//")
      ? { redirect: s.redirect }
      : {},
  head: () => ({
    meta: [
      { title: "Sign in — StoreBridge" },
      {
        name: "description",
        content: "Sign in to StoreBridge to manage your product intake and publishing.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { redirect: redirectTo } = Route.useSearch();
  const dest = redirectTo ?? "/dashboard";
  const isFitness = dest.startsWith("/fitness");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: dest, replace: true });
    });
  }, [navigate, dest]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}${dest}` },
        });
        if (error) throw error;
      }
      toast.success(mode === "signin" ? "Welcome back" : "Account created");
      navigate({ to: dest, replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const google = async () => {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: isFitness ? `${window.location.origin}${dest}` : window.location.origin,
    });
    if (result.error) toast.error(result.error.message || "Google sign-in failed");
    if (result.redirected) return;
    navigate({ to: dest, replace: true });
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-background">
      {isFitness ? (
        <div className="hidden md:flex flex-col justify-between p-10 bg-zinc-950 text-zinc-100">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-lime-400 p-1.5 text-zinc-950">
              <Zap className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold tracking-tight">PRIME PHYSIQUE</span>
          </div>
          <div className="max-w-md space-y-4">
            <h1 className="text-3xl font-semibold tracking-tight">
              Every gram. Every rep. Every kilogram.
            </h1>
            <p className="text-zinc-400">
              Your private fitness transformation system: food to the gram, set-by-set training,
              daily weight trends, measurements, progress photos, sleep and recovery.
            </p>
          </div>
          <div className="text-xs text-zinc-500">Your data is private to your account.</div>
        </div>
      ) : (
        <div className="hidden md:flex flex-col justify-between p-10 bg-sidebar text-sidebar-foreground">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-primary p-1.5 text-primary-foreground">
              <Store className="h-5 w-5" />
            </div>
            <span className="text-lg font-semibold">StoreBridge</span>
          </div>
          <div className="max-w-md space-y-4">
            <h1 className="text-3xl font-semibold tracking-tight">
              Ship products to Shopify & WooCommerce, faster.
            </h1>
            <p className="text-sidebar-foreground/70">
              Collect polished product submissions from your clients, review them in one place, and
              publish with one click.
            </p>
            <ul className="text-sm space-y-2 text-sidebar-foreground/80">
              <li>• Role-based dashboards for agencies and clients</li>
              <li>• Encrypted store credentials, never exposed in the browser</li>
              <li>• CSV export or direct API publish per client</li>
            </ul>
          </div>
          <div className="text-xs text-sidebar-foreground/50">© StoreBridge</div>
        </div>
      )}
      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>{mode === "signin" ? "Sign in" : "Create account"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button variant="outline" className="w-full" onClick={google}>
              Continue with Google
            </Button>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="flex-1 h-px bg-border" />
              or
              <div className="flex-1 h-px bg-border" />
            </div>
            <form onSubmit={submit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button className="w-full" type="submit" disabled={loading}>
                {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
              </Button>
            </form>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground w-full text-center"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            >
              {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
