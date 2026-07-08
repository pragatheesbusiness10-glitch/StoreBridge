import { useMemo, useState } from "react";
import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getMe } from "@/lib/me.functions";
import { publishProduct } from "@/lib/publish.functions";
import { generateExport, exportApprovedFeed } from "@/lib/exports.functions";
import { getImagesForZip } from "@/lib/images.functions";
import JSZip from "jszip";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Package, Rocket, PackagePlus, FileUp, Images, CheckCircle2, XCircle, Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/products")({
  component: ProductsPage,
});

type Row = {
  id: string;
  title: string;
  sku: string | null;
  price: number | null;
  status: "draft" | "submitted" | "approved" | "published" | "failed" | "rejected";
  category: string | null;
  updated_at: string;
  client_id: string;
  clients: { client_name: string; store_type: string | null } | null;
};

function download(filename: string, contentType: string, content: string) {
  const blob = new Blob([content], { type: contentType });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function ProductsPage() {
  const pathname = useLocation({ select: (location) => location.pathname });

  if (pathname !== "/products") {
    return <Outlet />;
  }

  return <ProductsList />;
}

function ProductsList() {
  const fetchMe = useServerFn(getMe);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });
  const isAdmin = !!me?.isAdmin;

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [clientId, setClientId] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const clientsQuery = useQuery({
    queryKey: ["clients-lite"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, client_name").order("client_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const productsQuery = useQuery({
    queryKey: ["products", status, clientId, q],
    queryFn: async () => {
      let query = supabase
        .from("products")
        .select("id, title, sku, price, status, category, updated_at, client_id, clients(client_name, store_type)")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (status !== "all") query = query.eq("status", status as any);
      if (clientId !== "all") query = query.eq("client_id", clientId);
      if (q) query = query.or(`title.ilike.%${q}%,sku.ilike.%${q}%,category.ilike.%${q}%`);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const rows = productsQuery.data ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const queryClient = useQueryClient();
  const publishFn = useServerFn(publishProduct);
  const exportFn = useServerFn(generateExport);
  const feedFn = useServerFn(exportApprovedFeed);
  const imagesFn = useServerFn(getImagesForZip);
  const [zipping, setZipping] = useState(false);

  const publishMutation = useMutation({
    mutationFn: async (payload: { productId: string; platform: "shopify" | "woocommerce" }) => publishFn({ data: payload }),
    onSuccess: (res) => {
      if (res.ok) toast.success("Published"); else toast.error(res.error ?? "Publish failed");
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkTransition = async (newStatus: "approved" | "rejected", note?: string) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return toast.error("Select products first");
    const eligible = rows.filter((r) => ids.includes(r.id) && r.status === "submitted").map((r) => r.id);
    if (eligible.length === 0) return toast.error("Only submitted products can be approved or rejected");
    const patch: any = { status: newStatus };
    if (newStatus === "rejected") patch.rejection_note = note ?? "Rejected in bulk review";
    const { error } = await supabase.from("products").update(patch).in("id", eligible);
    if (error) return toast.error(error.message);
    toast.success(`${newStatus === "approved" ? "Approved" : "Rejected"} ${eligible.length} product${eligible.length === 1 ? "" : "s"}`);
    setSelected(new Set());
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  const bulkExport = async (format: "shopify_csv" | "woo_csv" | "json") => {
    const ids = Array.from(selected);
    if (ids.length === 0) return toast.error("Select products first");
    try {
      const res = await exportFn({ data: { productIds: ids, format } });
      download(res.filename, res.contentType, res.content);
      toast.success(`Exported ${ids.length} products`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  };

  const downloadApprovedFeed = async (platform: "shopify" | "woocommerce") => {
    try {
      const res = await feedFn({
        data: { platform, clientId: clientId === "all" ? null : clientId },
      });
      if (res.productCount === 0) return toast.error(`No approved products for ${platform}`);
      download(res.filename, res.contentType, res.content);
      toast.success(`Exported ${res.productCount} approved product${res.productCount === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  };

  const downloadImagesZip = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return toast.error("Select products first");
    setZipping(true);
    try {
      const entries = await imagesFn({ data: { productIds: ids } });
      const zip = new JSZip();
      let count = 0;
      for (const p of entries) {
        if (p.images.length === 0) continue;
        const folder = zip.folder(
          `${(p.clientName ?? "unknown").replace(/[^a-z0-9-_]+/gi, "_")}/${p.productTitle.replace(/[^a-z0-9-_]+/gi, "_").slice(0, 60)}`,
        )!;
        for (const img of p.images) {
          const res = await fetch(img.signedUrl);
          if (!res.ok) continue;
          folder.file(img.filename, await res.arrayBuffer());
          count++;
        }
      }
      if (count === 0) return toast.error("No images to download");
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `product-images-${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Zipped ${count} images`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ZIP failed");
    } finally {
      setZipping(false);
    }
  };

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const filteredCount = useMemo(() => rows.length, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
          <p className="text-sm text-muted-foreground">{filteredCount} result{filteredCount === 1 ? "" : "s"}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isAdmin && (
            <Select onValueChange={(v) => downloadApprovedFeed(v as any)}>
              <SelectTrigger className="w-[210px]">
                <Download className="mr-1.5 h-4 w-4" />
                <SelectValue placeholder="Approved feed CSV" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shopify">Shopify (approved)</SelectItem>
                <SelectItem value="woocommerce">WooCommerce (approved)</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Link to="/products/import"><Button variant="outline"><FileUp className="mr-2 h-4 w-4" /> Bulk import</Button></Link>
          <Link to="/products/new"><Button><PackagePlus className="mr-2 h-4 w-4" /> New product</Button></Link>
        </div>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Input placeholder="Search title, SKU, category…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {["draft","submitted","approved","published","failed","rejected"].map((s) => (
                <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isAdmin && (
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger><SelectValue placeholder="Client" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All clients</SelectItem>
                {(clientsQuery.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.client_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex gap-2 justify-end">
            {isAdmin && (
              <>
                <Button variant="outline" size="sm" disabled={selected.size === 0} onClick={() => bulkTransition("approved")}>
                  <CheckCircle2 className="mr-1.5 h-4 w-4" /> Approve
                </Button>
                <Button variant="outline" size="sm" disabled={selected.size === 0} onClick={() => {
                  const note = window.prompt("Rejection note (visible to client):", "");
                  if (note === null) return;
                  bulkTransition("rejected", note);
                }}>
                  <XCircle className="mr-1.5 h-4 w-4" /> Reject
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" disabled={zipping || selected.size === 0} onClick={downloadImagesZip}>
              <Images className="mr-1.5 h-4 w-4" /> {zipping ? "Zipping…" : "Images ZIP"}
            </Button>
            <Select onValueChange={(v) => bulkExport(v as any)}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Export selected" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="shopify_csv">Shopify CSV</SelectItem>
                <SelectItem value="woo_csv">WooCommerce CSV</SelectItem>
                <SelectItem value="json">JSON</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {productsQuery.isLoading ? (
        <div className="text-sm text-muted-foreground p-8 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No products match"
          description="Try adjusting filters or add a new submission."
          action={<Link to="/products/new"><Button>Add product</Button></Link>}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                </TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleOne(r.id)} />
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link to="/products/$id" params={{ id: r.id }} className="hover:underline">
                      {r.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.clients?.client_name ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">{r.sku ?? "—"}</TableCell>
                  <TableCell className="text-sm">{r.price != null ? `$${r.price}` : "—"}</TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell className="text-right">
                    {isAdmin && (r.status === "approved" || r.status === "failed") && r.clients?.store_type ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          publishMutation.mutate({ productId: r.id, platform: r.clients!.store_type as any })
                        }
                      >
                        <Rocket className="mr-1.5 h-3.5 w-3.5" />
                        Publish
                      </Button>
                    ) : (
                      <Link to="/products/$id" params={{ id: r.id }}>
                        <Button size="sm" variant="ghost">Open</Button>
                      </Link>
                    )}
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