import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAuditLogs } from "@/lib/admin.functions";
import { getMe } from "@/lib/me.functions";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { History } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/audit")({
  component: AuditPage,
});

function formatWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString();
}

function AuditPage() {
  const fetchMe = useServerFn(getMe);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });
  const fetchLogs = useServerFn(listAuditLogs);
  const logsQuery = useQuery({
    queryKey: ["audit-logs"],
    queryFn: () => fetchLogs({ data: { limit: 200 } }),
    enabled: !!me?.isAdmin,
  });

  if (!me?.isAdmin) {
    return <EmptyState icon={History} title="Admins only" description="Only agency and super admins can view the audit log." />;
  }

  const rows = logsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Records of client and login activity. Scoped to clients you manage.
        </p>
      </div>

      {logsQuery.isLoading ? (
        <div className="text-sm text-muted-foreground py-6">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={History} title="No activity yet" description="Actions on clients and logins will appear here." />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatWhen(r.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-xs">{r.action}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{r.actorEmail || r.actorId || "—"}</TableCell>
                  <TableCell className="text-sm">{r.clientName || (r.clientId ? r.clientId : "—")}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-md">
                    <code className="whitespace-pre-wrap break-all">
                      {Object.keys(r.metadata || {}).length ? JSON.stringify(r.metadata) : "—"}
                    </code>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}