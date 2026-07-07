import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getMe } from "@/lib/me.functions";
import { StatCard } from "@/components/stat-card";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Package, Clock, CheckCircle2, Rocket, XCircle, FileText, Users, Plug, PackagePlus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const fetchMe = useServerFn(getMe);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });

  const statsQuery = useQuery({
    queryKey: ["dashboard-stats", me?.userId],
    enabled: !!me,
    queryFn: async () => {
      const results = await Promise.all([
        supabase.from("products").select("id", { count: "exact", head: true }),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "draft"),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "submitted"),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "approved"),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "published"),
        supabase.from("products").select("id", { count: "exact", head: true }).eq("status", "failed"),
        supabase.from("clients").select("id", { count: "exact", head: true }),
        supabase.from("store_integrations").select("id", { count: "exact", head: true }).eq("is_active", true),
      ]);
      return {
        total: results[0].count ?? 0,
        draft: results[1].count ?? 0,
        submitted: results[2].count ?? 0,
        approved: results[3].count ?? 0,
        published: results[4].count ?? 0,
        failed: results[5].count ?? 0,
        clients: results[6].count ?? 0,
        integrations: results[7].count ?? 0,
      };
    },
  });

  const s = statsQuery.data;
  const isAdmin = me?.isAdmin;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isAdmin ? "Agency dashboard" : "Your workspace"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "Overview of all clients, submissions, and store connections."
              : "Track submissions and publish status across your assigned stores."}
          </p>
        </div>
        <Link to="/products/new"><Button><PackagePlus className="mr-2 h-4 w-4" /> New product</Button></Link>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Total products" value={s?.total ?? "—"} icon={Package} />
        <StatCard label="Drafts" value={s?.draft ?? "—"} icon={FileText} />
        <StatCard label="Pending review" value={s?.submitted ?? "—"} icon={Clock} accent="bg-sky-100 text-sky-700" />
        <StatCard label="Approved" value={s?.approved ?? "—"} icon={CheckCircle2} accent="bg-amber-100 text-amber-700" />
        <StatCard label="Published" value={s?.published ?? "—"} icon={Rocket} accent="bg-emerald-100 text-emerald-700" />
        <StatCard label="Failed" value={s?.failed ?? "—"} icon={XCircle} accent="bg-red-100 text-red-700" />
        {isAdmin ? <StatCard label="Clients" value={s?.clients ?? "—"} icon={Users} /> : null}
        {isAdmin ? <StatCard label="Active integrations" value={s?.integrations ?? "—"} icon={Plug} /> : null}
      </div>

      {statsQuery.isSuccess && (s?.total ?? 0) === 0 ? (
        <EmptyState
          icon={Package}
          title="No products yet"
          description="Get started by adding your first product submission."
          action={<Link to="/products/new"><Button>Add product</Button></Link>}
        />
      ) : null}
    </div>
  );
}