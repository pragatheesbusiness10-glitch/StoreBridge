import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { ScrollText } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/logs")({
  component: LogsPage,
});

function LogsPage() {
  const q = useQuery({
    queryKey: ["logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_logs")
        .select("id, action, status, platform, error_message, created_at, product_id, client_id, products(title), clients(client_name)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const rows = q.data ?? [];
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import & export logs</h1>
        <p className="text-sm text-muted-foreground">Every publish, export, and connection test.</p>
      </div>
      {q.isLoading ? (
        <div className="text-sm text-muted-foreground p-8 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={ScrollText} title="No logs yet" description="Publishing and connection tests will appear here." />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString()}</TableCell>
                  <TableCell className="capitalize">{l.action.replace("_", " ")}</TableCell>
                  <TableCell>{l.clients?.client_name ?? "—"}</TableCell>
                  <TableCell>{l.products?.title ?? "—"}</TableCell>
                  <TableCell className="capitalize">{l.platform ?? "—"}</TableCell>
                  <TableCell>
                    <Badge className={l.status === "success" ? "bg-emerald-100 text-emerald-800 border-transparent" : "bg-red-100 text-red-800 border-transparent"}>
                      {l.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-md truncate">{l.error_message ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}