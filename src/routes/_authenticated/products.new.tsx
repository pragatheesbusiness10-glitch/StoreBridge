import { useState, useMemo, useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { getMe } from "@/lib/me.functions";
import { createClient as createClientFn } from "@/lib/admin.functions";
import { createProduct } from "@/lib/products.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Plus, AlertCircle, Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
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
  const queryClient = useQueryClient();
  const createClient = useServerFn(createClientFn);
  const createProductFn = useServerFn(createProduct);

  const clientsQuery = useQuery({
    queryKey: ["clients-for-new"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, client_name").order("client_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const availableClients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);

  const categoriesQuery = useQuery({
    queryKey: ["categories-for-form"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_categories")
        .select("id, name, slug")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const categories = categoriesQuery.data ?? [];

  const [openNewCategory, setOpenNewCategory] = useState(false);
  const [newCat, setNewCat] = useState({ name: "", description: "" });
  const createCategoryMut = useMutation({
    mutationFn: async () => {
      const name = newCat.name.trim();
      if (!name) throw new Error("Name is required");
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const { data, error } = await supabase
        .from("product_categories")
        .insert({ name, slug, description: newCat.description || null })
        .select("name")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async (row) => {
      toast.success("Category created");
      setOpenNewCategory(false);
      setNewCat({ name: "", description: "" });
      await queryClient.invalidateQueries({ queryKey: ["categories-for-form"] });
      setForm((f) => ({ ...f, category: row!.name }));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [openNewClient, setOpenNewClient] = useState(false);
  const [newClient, setNewClient] = useState({ clientName: "", storeType: "shopify" as "shopify" | "woocommerce", storeUrl: "" });
  const createClientMut = useMutation({
    mutationFn: () => createClient({ data: newClient }),
    onSuccess: async (res) => {
      toast.success("Client created");
      setOpenNewClient(false);
      setNewClient({ clientName: "", storeType: "shopify", storeUrl: "" });
      await queryClient.invalidateQueries({ queryKey: ["clients-for-new"] });
      setForm((f) => ({ ...f, client_id: res.id }));
    },
    onError: (e: Error) => toast.error(e.message),
  });

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

  // Auto-select the client when only one is available.
  useEffect(() => {
    if (!form.client_id && availableClients.length === 1) {
      setForm((f) => ({ ...f, client_id: availableClients[0].id }));
    }
  }, [availableClients, form.client_id]);

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
      const payload = {
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
      };
      const data = await createProductFn({ data: payload });
      toast.success(status === "draft" ? "Draft saved" : "Product submitted for review");
      navigate({ to: "/products/$id", params: { id: data.id } });
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
          {availableClients.length === 0 && !me?.isAdmin && !clientsQuery.isLoading ? (
            <div className="md:col-span-2">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>You're not assigned to a client yet</AlertTitle>
                <AlertDescription>
                  Ask your agency admin to invite you to a client workspace. Once assigned, you'll be able to submit products here.
                </AlertDescription>
              </Alert>
            </div>
          ) : null}
          <div className="space-y-1.5 md:col-span-2">
            <Label>Client *</Label>
            <div className="flex gap-2">
              <Select value={form.client_id} onValueChange={(v) => setForm({ ...form, client_id: v })}>
                <SelectTrigger className="flex-1"><SelectValue placeholder={availableClients.length === 0 ? "No clients yet" : "Choose a client"} /></SelectTrigger>
                <SelectContent>
                  {availableClients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.client_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {me?.isAdmin ? (
                <Dialog open={openNewClient} onOpenChange={setOpenNewClient}>
                  <DialogTrigger asChild>
                    <Button type="button" variant="outline"><Plus className="mr-1.5 h-4 w-4" /> New</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>New client</DialogTitle></DialogHeader>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label>Client name *</Label>
                        <Input value={newClient.clientName} onChange={(e) => setNewClient({ ...newClient, clientName: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Platform</Label>
                        <Select value={newClient.storeType} onValueChange={(v) => setNewClient({ ...newClient, storeType: v as any })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="shopify">Shopify</SelectItem>
                            <SelectItem value="woocommerce">WooCommerce</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Store URL (optional)</Label>
                        <Input placeholder="https://…" value={newClient.storeUrl} onChange={(e) => setNewClient({ ...newClient, storeUrl: e.target.value })} />
                      </div>
                      <Button className="w-full" disabled={createClientMut.isPending || !newClient.clientName} onClick={() => createClientMut.mutate()}>
                        Create client
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              ) : null}
            </div>
            {availableClients.length === 0 && !me?.isAdmin ? (
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
          <div className="space-y-1.5">
            <Label>Category</Label>
            <div className="flex gap-2">
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder={categories.length === 0 ? "No categories yet" : "Pick a category"} />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {me?.isAdmin ? (
                <Button type="button" variant="outline" onClick={() => setOpenNewCategory(true)}>
                  <Plus className="mr-1.5 h-4 w-4" /> New
                </Button>
              ) : null}
            </div>
          </div>
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

      <Sheet open={openNewCategory} onOpenChange={setOpenNewCategory}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader><SheetTitle>New category</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea rows={3} value={newCat.description} onChange={(e) => setNewCat({ ...newCat, description: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpenNewCategory(false)}>Cancel</Button>
              <Button disabled={createCategoryMut.isPending || !newCat.name} onClick={() => createCategoryMut.mutate()}>
                Create category
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
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