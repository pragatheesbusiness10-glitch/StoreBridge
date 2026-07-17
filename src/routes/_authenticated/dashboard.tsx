import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getMe } from "@/lib/me.functions";
import { StatCard } from "@/components/stat-card";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, BarChart, Bar,
} from "recharts";
import { Package, Clock, CheckCircle2, Rocket, XCircle, FileText, Users, Plug, PackagePlus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const fetchMe = useServerFn(getMe);
  const { data: me, isLoading: meLoading, isError: meError } = useQuery({
    queryKey: ["me"],
    queryFn: () => fetchMe(),
    staleTime: 0,
    refetchOnMount: "always",
  });

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

  const trendsQuery = useQuery({
    queryKey: ["dashboard-trends", me?.userId],
    enabled: !!me,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86400_000).toISOString();
      const [{ data: prods }, { data: perClient }] = await Promise.all([
        supabase.from("products").select("created_at, status").gte("created_at", since).limit(2000),
        supabase.from("products").select("status, clients(client_name)").limit(2000),
      ]);
      const days: Record<string, number> = {};
      for (let i = 29; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
        days[d] = 0;
      }
      (prods ?? []).forEach((p: any) => {
        const d = p.created_at.slice(0, 10);
        if (d in days) days[d] += 1;
      });
      const byDay = Object.entries(days).map(([date, count]) => ({
        date: date.slice(5),
        count,
      }));
      const clientCounts: Record<string, number> = {};
      (perClient ?? []).forEach((p: any) => {
        const name = p.clients?.client_name ?? "Unassigned";
        clientCounts[name] = (clientCounts[name] ?? 0) + 1;
      });
      const byClient = Object.entries(clientCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);
      return { byDay, byClient };
    },
  });

  if (meLoading) {
    return <div className="text-sm text-muted-foreground p-8 text-center">Loading your workspace…</div>;
  }

  if (meError || !me) {
    return (
      <EmptyState
        icon={Users}
        title="Identity could not be loaded"
        description="Sign out and sign back in so your latest role is applied."
      />
    );
  }

  const s = statsQuery.data;
  const isAdmin = me?.isAdmin;
  const t = trendsQuery.data;

  const statusData = s
    ? [
        { name: "Draft", value: s.draft, fill: "hsl(215 20% 55%)" },
        { name: "Submitted", value: s.submitted, fill: "hsl(199 89% 48%)" },
        { name: "Approved", value: s.approved, fill: "hsl(43 96% 56%)" },
        { name: "Published", value: s.published, fill: "hsl(160 84% 39%)" },
        { name: "Failed", value: s.failed, fill: "hsl(0 84% 60%)" },
      ].filter((d) => d.value > 0)
    : [];

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
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base">Submissions — last 30 days</CardTitle></CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={t?.byDay ?? []} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(160 84% 39%)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(160 84% 39%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 20% 90%)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="count" stroke="hsl(160 84% 39%)" fill="url(#g)" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">By status</CardTitle></CardHeader>
            <CardContent className="h-64">
              {statusData.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center pt-16">No data yet.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={70}>
                      {statusData.map((d) => <Cell key={d.name} fill={d.fill} />)}
                    </Pie>
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          {isAdmin ? (
            <Card className="lg:col-span-3">
              <CardHeader><CardTitle className="text-base">Top clients by product count</CardTitle></CardHeader>
              <CardContent className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={t?.byClient ?? []} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 20% 90%)" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="hsl(160 84% 39%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}