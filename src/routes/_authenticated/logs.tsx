import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { ScrollText, ExternalLink } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";

type LogRow = {
  id: string;
  action: string;
  status: string;
  platform: string | null;
  error_message: string | null;
  created_at: string;
  product_id: string | null;
  client_id: string | null;
  request_payload: unknown;
  response_payload: unknown;
  products: { title: string | null } | null;
  clients: { client_name: string | null } | null;
};

export const Route = createFileRoute("/_authenticated/logs")({
  component: LogsPage,
});

function extractPlatformError(row: LogRow): string | null {
  if (row.error_message) return row.error_message;
  const resp = row.response_payload as any;
  if (!resp || typeof resp !== "object") return null;
  // Shopify: { errors: { title: ["can't be blank"] } } or { errors: "not found" }
  if (resp.errors) {
    if (typeof resp.errors === "string") return resp.errors;
    if (Array.isArray(resp.errors)) return resp.errors.join("; ");
    if (typeof resp.errors === "object") {
      return Object.entries(resp.errors)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
        .join(" • ");
    }
  }
  // WooCommerce: { code, message, data: { status } }
  if (resp.message) return `${resp.code ? `[${resp.code}] ` : ""}${resp.message}`;
  return null;
}

function LogsPage() {
  const [status, setStatus] = useState<string>("all");
  const [platform, setPlatform] = useState<string>("all");
  const [action, setAction] = useState<string>("all");
  const [clientId, setClientId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<LogRow | null>(null);

  const clientsQ = useQuery({
    queryKey: ["logs-clients"],
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, client_name").order("client_name");
      return (data ?? []) as { id: string; client_name: string }[];
    },
  });

  const q = useQuery({
    queryKey: ["logs", status, platform, action, clientId],
    queryFn: async () => {
      let query = supabase
        .from("import_logs")
        .select("id, action, status, platform, error_message, created_at, product_id, client_id, request_payload, response_payload, products(title), clients(client_name)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (status !== "all") query = query.eq("status", status as any);
      if (platform !== "all") query = query.eq("platform", platform as any);
      if (action !== "all") query = query.eq("action", action as any);
      if (clientId !== "all") query = query.eq("client_id", clientId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as LogRow[];
    },
  });

  const rows = useMemo(() => {
    const all = q.data ?? [];
    if (!search.trim()) return all;
    const s = search.toLowerCase();
    return all.filter((r) =>
      (r.products?.title ?? "").toLowerCase().includes(s) ||
      (r.clients?.client_name ?? "").toLowerCase().includes(s) ||
      (r.error_message ?? "").toLowerCase().includes(s) ||
      (extractPlatformError(r) ?? "").toLowerCase().includes(s),
    );
  }, [q.data, search]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import & export logs</h1>
        <p className="text-sm text-muted-foreground">Every publish, export, and connection test with exact platform responses.</p>
      </div>

      <Card className="p-3 flex flex-wrap gap-2 items-center">
        <Input
          placeholder="Search product, client, error…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
        <Select value={platform} onValueChange={setPlatform}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Platform" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            <SelectItem value="shopify">Shopify</SelectItem>
            <SelectItem value="woocommerce">WooCommerce</SelectItem>
          </SelectContent>
        </Select>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Action" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            <SelectItem value="publish">Publish</SelectItem>
            <SelectItem value="test_connection">Test connection</SelectItem>
            <SelectItem value="import">Import</SelectItem>
            <SelectItem value="export">Export</SelectItem>
          </SelectContent>
        </Select>
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Client" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {(clientsQ.data ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.client_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(status !== "all" || platform !== "all" || action !== "all" || clientId !== "all" || search) && (
          <Button variant="ghost" size="sm" onClick={() => {
            setStatus("all"); setPlatform("all"); setAction("all"); setClientId("all"); setSearch("");
          }}>Clear</Button>
        )}
        <div className="ml-auto text-xs text-muted-foreground">{rows.length} entries</div>
      </Card>

      {q.isLoading ? (
        <div className="text-sm text-muted-foreground p-8 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={ScrollText} title="No logs match" description="Adjust filters or run a publish/test action." />
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
                <TableHead>Error / details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((l) => {
                const err = extractPlatformError(l);
                return (
                  <TableRow key={l.id} className="cursor-pointer" onClick={() => setSelected(l)}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</TableCell>
                    <TableCell className="capitalize">{l.action.replace(/_/g, " ")}</TableCell>
                    <TableCell>{l.clients?.client_name ?? "—"}</TableCell>
                    <TableCell>{l.products?.title ?? "—"}</TableCell>
                    <TableCell className="capitalize">{l.platform ?? "—"}</TableCell>
                    <TableCell>
                      <Badge className={l.status === "success" ? "bg-emerald-100 text-emerald-800 border-transparent" : "bg-red-100 text-red-800 border-transparent"}>
                        {l.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-md truncate">{err ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="capitalize">{selected.action.replace(/_/g, " ")} · {selected.platform ?? "—"}</SheetTitle>
                <SheetDescription>{new Date(selected.created_at).toLocaleString()}</SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Status">
                    <Badge className={selected.status === "success" ? "bg-emerald-100 text-emerald-800 border-transparent" : "bg-red-100 text-red-800 border-transparent"}>
                      {selected.status}
                    </Badge>
                  </Field>
                  <Field label="Client">{selected.clients?.client_name ?? "—"}</Field>
                  <Field label="Product">
                    {selected.product_id ? (
                      <Link to="/products/$id" params={{ id: selected.product_id }} className="text-primary hover:underline inline-flex items-center gap-1">
                        {selected.products?.title ?? selected.product_id}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : "—"}
                  </Field>
                  <Field label="Log ID"><code className="text-xs">{selected.id}</code></Field>
                </div>

                {extractPlatformError(selected) && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">Platform error</div>
                    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900 text-xs whitespace-pre-wrap">
                      {extractPlatformError(selected)}
                    </div>
                  </div>
                )}

                <Payload label="Response payload" value={selected.response_payload} />
                <Payload label="Request payload" value={selected.request_payload} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Payload({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null;
  let text: string;
  try { text = JSON.stringify(value, null, 2); } catch { text = String(value); }
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground mb-1">{label}</div>
      <pre className="rounded-md border bg-muted/40 p-3 text-xs overflow-auto max-h-80"><code>{text}</code></pre>
    </div>
  );
}