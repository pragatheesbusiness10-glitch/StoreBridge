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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Plus, AlertCircle } from "lucide-react";
import { CategoryPicker } from "@/components/category-picker";
import { toast } from "sonner";
import { friendlyCategoryError, validateCategoryName } from "@/lib/category-errors";
import { Loader2, Star, Trash2, ImagePlus, ArrowUp, ArrowDown, GripVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SortableImageGrid } from "@/components/sortable-image-grid";
import { compressImage } from "@/lib/image-compress";

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
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    staleTime: 0,
  });
  const categories = categoriesQuery.data ?? [];

  // Live-sync the category list with the Categories page via Postgres changes.
  useEffect(() => {
    const channel = supabase
      .channel("product_categories:new-product-form")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "product_categories" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["categories-for-form"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const [openNewCategory, setOpenNewCategory] = useState(false);
  const [newCat, setNewCat] = useState({ name: "", description: "" });
  const createCategoryMut = useMutation({
    mutationFn: async () => {
      const validationError = validateCategoryName(newCat.name);
      if (validationError) throw new Error(validationError);
      const name = newCat.name.trim();
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      // Optimistic duplicate check against already-loaded categories
      if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
        throw new Error("A category with that name already exists.");
      }
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
    onError: (e) => toast.error(friendlyCategoryError(e)),
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

  type PendingImage = { id: string; file: File; previewUrl: string };
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);

  useEffect(() => {
    return () => {
      pendingImages.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const arr = Array.from(files);
    const compressed = await Promise.all(
      arr.map(async (file) => {
        try {
          return await compressImage(file);
        } catch {
          return file;
        }
      }),
    );
    const next: PendingImage[] = compressed.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setPendingImages((prev) => [...prev, ...next]);
  }
  function removePending(id: string) {
    setPendingImages((prev) => {
      const t = prev.find((p) => p.id === id);
      if (t) URL.revokeObjectURL(t.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }
  function movePending(id: string, dir: -1 | 1) {
    setPendingImages((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      return copy;
    });
  }
  function setPrimary(id: string) {
    setPendingImages((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx <= 0) return prev;
      const copy = [...prev];
      const [x] = copy.splice(idx, 1);
      copy.unshift(x);
      return copy;
    });
  }

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
    if (pendingImages.length === 0) {
      toast.error("Add at least one image before saving.");
      return;
    }
    // Invariant: primary === first item in the ordered list. Verify before submit.
    const orderedImages = [...pendingImages];
    const ids = orderedImages.map((p) => p.id);
    if (new Set(ids).size !== ids.length) {
      toast.error("Duplicate images detected. Remove duplicates before saving.");
      return;
    }
    if (orderedImages.some((p) => !p.file || !p.id)) {
      toast.error("An image entry is invalid. Remove it and re-upload.");
      return;
    }
    const primaryCount = orderedImages.filter((_, i) => i === 0).length;
    if (primaryCount !== 1) {
      toast.error("Primary image is out of sync with the image order. Reorder so exactly one image is first.");
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
      if (orderedImages.length > 0) {
        try {
          for (let i = 0; i < orderedImages.length; i++) {
            const p = orderedImages[i];
            const ext = p.file.name.split(".").pop()?.toLowerCase() ?? "jpg";
            const path = `clients/${form.client_id}/products/${data.id}/${crypto.randomUUID()}.${ext}`;
            const { error: upErr } = await supabase.storage
              .from("product-images")
              .upload(path, p.file, { cacheControl: "3600", upsert: false });
            if (upErr) throw upErr;
            const { error: dbErr } = await supabase
              .from("product_images")
              .insert({ product_id: data.id, storage_path: path, sort_order: i, alt_text: p.file.name });
            if (dbErr) throw dbErr;
          }
        } catch (err) {
          toast.error(`Product saved but image upload failed: ${err instanceof Error ? err.message : "unknown"}`);
        }
      }
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
      <div className="flex items-start gap-4">
        <div
          className="relative h-24 w-24 shrink-0 overflow-hidden rounded-md border bg-muted"
          aria-label={pendingImages[0] ? `Cover preview: ${pendingImages[0].file.name}` : "No cover image selected"}
        >
          {pendingImages[0] ? (
            <>
              <img
                src={pendingImages[0].previewUrl}
                alt={pendingImages[0].file.name}
                className="h-full w-full object-cover"
              />
              <Badge className="absolute left-1 top-1 gap-1 px-1.5 py-0 text-[10px] shadow">
                <Star className="h-2.5 w-2.5 fill-current" /> Cover
              </Badge>
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImagePlus className="h-6 w-6" aria-hidden="true" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {form.title.trim() || "New product"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {pendingImages.length === 0
              ? "Add an image to set a cover — the first image is the primary cover shown to shoppers."
              : `${pendingImages.length} image${pendingImages.length === 1 ? "" : "s"} · cover updates when you reorder or set primary.`}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Images</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <label className="inline-flex">
              <input
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
              />
              <Button asChild variant="outline" type="button">
                <span>
                  <ImagePlus className="h-4 w-4 mr-2" />
                  Add images
                </span>
              </Button>
            </label>
            <span className="text-xs text-muted-foreground">
              {pendingImages.length} image{pendingImages.length === 1 ? "" : "s"} · drag to reorder · first is primary
            </span>
          </div>
          {pendingImages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No images added yet.</p>
          ) : (
            <SortableImageGrid
              items={pendingImages}
              onReorder={(next) => setPendingImages(next)}
              renderItem={(img, i, handle) => (
                 <Card className={i === 0 ? "overflow-hidden p-0 ring-2 ring-primary shadow-md" : "overflow-hidden p-0"}>
                   <div className="relative aspect-square bg-muted">
                     <button
                       type="button"
                       onClick={() => setPrimary(img.id)}
                       disabled={i === 0}
                       aria-label={i === 0 ? "Already the primary cover image" : "Set as primary cover image"}
                       title={i === 0 ? "Already the primary cover" : "Click to set as primary cover"}
                       className="group absolute inset-0 h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                     >
                       <img src={img.previewUrl} alt={img.file.name} className="h-full w-full object-cover" draggable={false} />
                       {i !== 0 ? (
                         <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                           <span className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-1 text-xs font-medium shadow">
                             <Star className="h-3 w-3" /> Set as primary
                           </span>
                         </span>
                       ) : null}
                     </button>
                    <button
                      type="button"
                      className="absolute right-2 top-2 rounded-md bg-background/80 backdrop-blur p-1.5 shadow cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-none"
                      {...handle.attributes}
                      {...handle.listeners}
                      aria-label={handle["aria-label"]}
                    >
                      <GripVertical className="h-4 w-4" />
                    </button>
                    {i === 0 ? (
                      <>
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-black/60 to-transparent" />
                        <Badge className="absolute left-2 top-2 gap-1 shadow-lg">
                          <Star className="h-3 w-3 fill-current" /> Primary — will be published as cover
                        </Badge>
                      </>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between p-2">
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" type="button" onClick={() => setPrimary(img.id)} disabled={i === 0} title={i === 0 ? "Already primary" : "Set as primary"} aria-label={i === 0 ? "Already primary" : "Set as primary"}>
                        <Star className={i === 0 ? "h-4 w-4 fill-current text-primary" : "h-4 w-4"} />
                      </Button>
                      <Button size="icon" variant="ghost" type="button" onClick={() => movePending(img.id, -1)} disabled={i === 0} aria-label="Move image up">
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" type="button" onClick={() => movePending(img.id, 1)} disabled={i === pendingImages.length - 1} aria-label="Move image down">
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </div>
                    <Button size="icon" variant="ghost" type="button" onClick={() => removePending(img.id)} aria-label="Remove image">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </Card>
              )}
            />
          )}
        </CardContent>
      </Card>

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
              <CategoryPicker
                value={form.category}
                onChange={(name) => setForm({ ...form, category: name })}
                categories={categories}
                isLoading={categoriesQuery.isLoading}
                onCreateRequest={(name) => { setNewCat({ name, description: "" }); setOpenNewCategory(true); }}
              />
              <Button type="button" variant="outline" onClick={() => setOpenNewCategory(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> New
              </Button>
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

      <Sheet open={openNewCategory} onOpenChange={setOpenNewCategory}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader><SheetTitle>New category</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} />
              {newCat.name.length > 0 && validateCategoryName(newCat.name) ? (
                <p className="text-xs text-destructive">{validateCategoryName(newCat.name)}</p>
              ) : (
                <p className="text-xs text-muted-foreground">2–80 characters. Must be unique.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea rows={3} value={newCat.description} onChange={(e) => setNewCat({ ...newCat, description: e.target.value })} />
            </div>
            {createCategoryMut.isError ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Couldn't create category</AlertTitle>
                <AlertDescription>{friendlyCategoryError(createCategoryMut.error)}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" disabled={createCategoryMut.isPending} onClick={() => setOpenNewCategory(false)}>Cancel</Button>
              <Button
                disabled={createCategoryMut.isPending || !!validateCategoryName(newCat.name)}
                onClick={() => createCategoryMut.mutate()}
              >
                {createCategoryMut.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating…</>
                ) : "Create category"}
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