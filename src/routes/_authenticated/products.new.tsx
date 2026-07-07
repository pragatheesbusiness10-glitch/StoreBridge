import { useState, useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { getMe } from "@/lib/me.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/products/new")({
  component: NewProductPage,
});

const schema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  client_id: z.string().uuid("Choose a client"),
  description: z.string().max(20000).optional(),
  price: z.string().optional(),
  sku: z.string().max(80).optional(),
});

function NewProductPage() {
  const navigate = useNavigate();
  const fetchMe = useServerFn(getMe);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });

  const clientsQuery = useQuery({
    queryKey: ["clients-for-new"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, client_name").order("client_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const availableClients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);

  const [form, setForm] = useState({
    title: "",
    client_id: "",
    description: "",
    short_description: "",
    price: "",
    compare_at_price: "",
    cost_price: "",
    sku: "",
    barcode: "",
    inventory_quantity: "0",
    category: "",
    product_type: "",
    vendor: "",
    tags: "",
    collection_name: "",
    woo_category: "",
    seo_title: "",
    seo_description: "",
    slug: "",
  });
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function save(status: "draft" | "submitted") {
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message ?? "Invalid input");
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        client_id: form.client_id,
        title: form.title.trim(),
        description: form.description || null,
        short_description: form.short_description || null,
        price: form.price ? Number(form.price) : null,
        compare_at_price: form.compare_at_price ? Number(form.compare_at_price) : null,
        cost_price: form.cost_price ? Number(form.cost_price) : null,
        sku: form.sku || null,
        barcode: form.barcode || null,
        inventory_quantity: form.inventory_quantity ? Number(form.inventory_quantity) : 0,
        category: form.category || null,
        product_type: form.product_type || null,
        vendor: form.vendor || null,
        tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        collection_name: form.collection_name || null,
        woo_category: form.woo_category || null,
        seo_title: form.seo_title || null,
        seo_description: form.seo_description || null,
        slug: form.slug || null,
        status,
        created_by: me?.userId,
      };
      const { data, error } = await supabase.from("products").insert(payload).select("id").single();
      if (error) throw error;
      toast.success(status === "draft" ? "Draft saved" : "Product submitted for review");
      navigate({ to: "/products/$id", params: { id: data!.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New product</h1>
        <p className="text-sm text-muted-foreground">Fill in as much detail as possible. You can save as a draft or submit for review.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Basics</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label>Client *</Label>
            <Select value={form.client_id} onValueChange={(v) => setForm({ ...form, client_id: v })}>
              <SelectTrigger><SelectValue placeholder="Choose a client" /></SelectTrigger>
              <SelectContent>
                {availableClients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.client_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableClients.length === 0 ? (
              <p className="text-xs text-muted-foreground">No clients yet. Ask an admin to create a client and assign you.</p>
            ) : null}
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="title">Title *</Label>
            <Input id="title" value={form.title} onChange={set("title")} maxLength={200} />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="short_description">Short description</Label>
            <Textarea id="short_description" value={form.short_description} onChange={set("short_description")} rows={2} />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" value={form.description} onChange={set("description")} rows={6} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Pricing & inventory</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field label="Price" v={form.price} on={set("price")} type="number" />
          <Field label="Compare-at price" v={form.compare_at_price} on={set("compare_at_price")} type="number" />
          <Field label="Cost price" v={form.cost_price} on={set("cost_price")} type="number" />
          <Field label="SKU" v={form.sku} on={set("sku")} />
          <Field label="Barcode" v={form.barcode} on={set("barcode")} />
          <Field label="Inventory quantity" v={form.inventory_quantity} on={set("inventory_quantity")} type="number" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Organization</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Category" v={form.category} on={set("category")} />
          <Field label="Product type" v={form.product_type} on={set("product_type")} />
          <Field label="Vendor / brand" v={form.vendor} on={set("vendor")} />
          <Field label="Tags (comma separated)" v={form.tags} on={set("tags")} />
          <Field label="Shopify collection" v={form.collection_name} on={set("collection_name")} />
          <Field label="WooCommerce category" v={form.woo_category} on={set("woo_category")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>SEO</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="SEO title" v={form.seo_title} on={set("seo_title")} />
          <Field label="URL slug" v={form.slug} on={set("slug")} />
          <div className="md:col-span-2 space-y-1.5">
            <Label>SEO meta description</Label>
            <Textarea value={form.seo_description} onChange={set("seo_description")} rows={3} />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2 justify-end">
        <Button variant="outline" disabled={saving} onClick={() => save("draft")}>Save draft</Button>
        <Button disabled={saving} onClick={() => save("submitted")}>Submit for review</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Images can be added after the product is created.
      </p>
    </div>
  );
}

function Field({ label, v, on, type = "text" }: { label: string; v: string; on: (e: any) => void; type?: string }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={v} onChange={on} type={type} />
    </div>
  );
}