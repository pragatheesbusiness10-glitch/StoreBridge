import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";
import { getMe } from "@/lib/me.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { AlertCircle, FileUp, Upload } from "lucide-react";

export const Route = createFileRoute("/_authenticated/products/import")({
  component: ImportPage,
});

const FIELDS = [
  { key: "title", label: "Title *", required: true },
  { key: "description", label: "Description" },
  { key: "short_description", label: "Short description" },
  { key: "sku", label: "SKU" },
  { key: "barcode", label: "Barcode" },
  { key: "price", label: "Price", number: true },
  { key: "compare_at_price", label: "Compare-at price", number: true },
  { key: "cost_price", label: "Cost price", number: true },
  { key: "inventory_quantity", label: "Inventory quantity", number: true },
  { key: "category", label: "Category" },
  { key: "product_type", label: "Product type" },
  { key: "vendor", label: "Vendor" },
  { key: "tags", label: "Tags (comma-separated)" },
  { key: "collection_name", label: "Shopify collection" },
  { key: "woo_category", label: "WooCommerce category" },
  { key: "seo_title", label: "SEO title" },
  { key: "seo_description", label: "SEO description" },
  { key: "slug", label: "URL slug" },
  { key: "handle", label: "Handle / group key (variant rows)" },
  { key: "variant_size", label: "Variant size" },
  { key: "variant_sku", label: "Variant SKU" },
  { key: "variant_price", label: "Variant price override", number: true },
  { key: "variant_quantity", label: "Variant quantity", number: true },
] as const;

type ParsedRow = Record<string, string>;

function guessMap(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const dict: Record<string, string> = {
    title: "title", name: "title", producttitle: "title", productname: "title",
    description: "description", body: "description", bodyhtml: "description",
    shortdescription: "short_description",
    sku: "sku",
    barcode: "barcode",
    price: "price", regularprice: "price",
    compareatprice: "compare_at_price", saleprice: "compare_at_price",
    costprice: "cost_price", cost: "cost_price",
    inventoryquantity: "inventory_quantity", stock: "inventory_quantity",
    category: "category", categories: "category",
    producttype: "product_type", type: "product_type",
    vendor: "vendor", brand: "vendor",
    tags: "tags",
    collection: "collection_name", collectionname: "collection_name",
    woocategory: "woo_category",
    seotitle: "seo_title", metatitle: "seo_title",
    seodescription: "seo_description", metadescription: "seo_description",
    slug: "slug", url: "slug",
    handle: "handle",
    option1value: "variant_size", size: "variant_size", variantsize: "variant_size",
    variantsku: "variant_sku",
    variantprice: "variant_price",
    variantinventoryqty: "variant_quantity", variantquantity: "variant_quantity", quantity: "variant_quantity",
  };
  for (const h of headers) {
    const key = dict[norm(h)];
    if (key) map[key] = h;
  }
  return map;
}

function ImportPage() {
  const navigate = useNavigate();
  const fetchMe = useServerFn(getMe);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });

  const clientsQuery = useQuery({
    queryKey: ["clients-for-import"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, client_name").order("client_name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const clients = clientsQuery.data ?? [];

  const [clientId, setClientId] = useState<string>("");
  const [status, setStatus] = useState<"draft" | "submitted">("draft");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ inserted: number; failed: number; errors: string[] } | null>(null);

  const onFile = (file: File) => {
    Papa.parse<ParsedRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const h = (res.meta.fields ?? []).filter(Boolean) as string[];
        setHeaders(h);
        setRows(res.data);
        setMap(guessMap(h));
        setResult(null);
      },
      error: (err) => toast.error(err.message),
    });
  };

  const preview = useMemo(() => rows.slice(0, 5), [rows]);

  const canImport = clientId && rows.length > 0 && map.title;

  async function runImport() {
    if (!canImport) return;
    setImporting(true);
    setResult(null);
    const errors: string[] = [];
    let inserted = 0;

    const variantFieldKeys = new Set(["variant_size", "variant_sku", "variant_price", "variant_quantity"]);
    const getRaw = (r: ParsedRow, key: string) => {
      const src = map[key];
      if (!src) return "";
      return (r[src] ?? "").trim();
    };
    const toNum = (v: string) => {
      if (v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    type Group = {
      product: any;
      variants: { size: string; sku: string | null; price: number | null; inventory_quantity: number }[];
      firstRow: number;
    };
    const groups = new Map<string, Group>();
    const orderedKeys: string[] = [];

    rows.forEach((r, i) => {
      const rowNum = i + 2;
      const title = getRaw(r, "title");
      const handle = getRaw(r, "handle") || getRaw(r, "slug") || title;
      const variantSize = getRaw(r, "variant_size");

      if (!handle && !title) return;
      const key = handle.toLowerCase();

      let group = groups.get(key);
      if (!group) {
        if (!title) {
          errors.push(`Row ${rowNum}: missing title for new product "${handle}"`);
          return;
        }
        const rec: any = { client_id: clientId, status, created_by: me?.userId };
        for (const f of FIELDS) {
          if (variantFieldKeys.has(f.key) || f.key === "handle") continue;
          const raw = getRaw(r, f.key);
          if (raw === "") continue;
          if (f.key === "tags") rec.tags = raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
          else if ((f as any).number) {
            const n = Number(raw);
            if (!Number.isFinite(n)) { errors.push(`Row ${rowNum}: "${f.key}" is not a number`); continue; }
            rec[f.key] = n;
          } else rec[f.key] = raw;
        }
        group = { product: rec, variants: [], firstRow: rowNum };
        groups.set(key, group);
        orderedKeys.push(key);
      }

      if (variantSize) {
        group.variants.push({
          size: variantSize,
          sku: getRaw(r, "variant_sku") || null,
          price: toNum(getRaw(r, "variant_price")),
          inventory_quantity: toNum(getRaw(r, "variant_quantity")) ?? 0,
        });
      }
    });

    for (const key of orderedKeys) {
      const g = groups.get(key)!;
      const { data: inserted1, error } = await supabase
        .from("products")
        .insert(g.product)
        .select("id")
        .single();
      if (error || !inserted1) {
        errors.push(`Row ${g.firstRow} ("${g.product.title}"): ${error?.message ?? "insert failed"}`);
        continue;
      }
      inserted += 1;
      if (g.variants.length > 0) {
        // Deduplicate variants by size (last wins)
        const bySize = new Map<string, (typeof g.variants)[number]>();
        for (const v of g.variants) bySize.set(v.size, v);
        const payload = Array.from(bySize.values()).map((v) => ({ ...v, product_id: inserted1.id }));
        const { error: vErr } = await supabase.from("product_variants").insert(payload);
        if (vErr) errors.push(`Row ${g.firstRow} ("${g.product.title}") variants: ${vErr.message}`);
      }
    }

    const total = orderedKeys.length;
    setResult({ inserted, failed: total - inserted, errors });
    setImporting(false);
    if (inserted > 0) toast.success(`Imported ${inserted} products (${rows.length} rows)`);
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bulk CSV import</h1>
          <p className="text-sm text-muted-foreground">Upload a CSV, map columns, then create products in one shot.</p>
        </div>
        <Link to="/products"><Button variant="outline">Back to products</Button></Link>
      </div>

      <Card>
        <CardHeader><CardTitle>1. Choose destination</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5 md:col-span-2">
            <Label>Client *</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger><SelectValue placeholder={clients.length ? "Choose a client" : "No clients yet"} /></SelectTrigger>
              <SelectContent>
                {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.client_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Initial status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="submitted">Submitted for review</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>2. Upload CSV</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-3 rounded-md border border-dashed p-6 cursor-pointer hover:bg-muted/50">
            <FileUp className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm">
              {rows.length > 0 ? `${rows.length} rows loaded — click to replace` : "Click to select a .csv file"}
            </span>
            <Input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            The first row must contain column names. Common Shopify / WooCommerce exports are auto-mapped.
          </p>
        </CardContent>
      </Card>

      {headers.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>3. Map columns</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {FIELDS.map((f) => (
              <div key={f.key} className="grid grid-cols-[1fr_1.2fr] items-center gap-2">
                <Label className="text-sm">{f.label}</Label>
                <Select
                  value={map[f.key] ?? "__none__"}
                  onValueChange={(v) => setMap({ ...map, [f.key]: v === "__none__" ? "" : v })}
                >
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— skip —</SelectItem>
                    {headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {preview.length > 0 ? (
        <Card className="overflow-hidden p-0">
          <div className="px-4 py-3 border-b text-sm font-medium">Preview (first 5 rows)</div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>{headers.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow>
              </TableHeader>
              <TableBody>
                {preview.map((r, i) => (
                  <TableRow key={i}>
                    {headers.map((h) => <TableCell key={h} className="text-xs">{r[h]}</TableCell>)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      ) : null}

      {result ? (
        <Alert variant={result.failed > 0 ? "destructive" : "default"}>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Import complete — {result.inserted} inserted, {result.failed} failed</AlertTitle>
          {result.errors.length > 0 ? (
            <AlertDescription>
              <ul className="list-disc pl-5 text-xs">
                {result.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
                {result.errors.length > 20 ? <li>…and {result.errors.length - 20} more</li> : null}
              </ul>
            </AlertDescription>
          ) : null}
        </Alert>
      ) : null}

      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={() => navigate({ to: "/products" })}>Cancel</Button>
        <Button onClick={runImport} disabled={!canImport || importing}>
          <Upload className="mr-2 h-4 w-4" />
          {importing ? "Importing…" : `Import ${rows.length} rows`}
        </Button>
      </div>
    </div>
  );
}