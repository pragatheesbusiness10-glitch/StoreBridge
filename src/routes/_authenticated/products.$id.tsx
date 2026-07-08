import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getMe } from "@/lib/me.functions";
import { publishProduct } from "@/lib/publish.functions";
import { StatusBadge } from "@/components/status-badge";
import { ImageUploader } from "@/components/image-uploader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { AlertCircle, Rocket, CheckCircle2, XCircle, Send, RotateCcw, Undo2, Lock, Check, ChevronsUpDown, Plus, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { friendlyCategoryError, validateCategoryName } from "@/lib/category-errors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/products/$id")({
  component: ProductDetailPage,
});

function ProductDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchMe = useServerFn(getMe);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });
  const isAdmin = !!me?.isAdmin;

  const productQuery = useQuery({
    queryKey: ["product", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*, clients(client_name, store_type, store_url)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  const [form, setForm] = useState<any>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);

  const categoriesQuery = useQuery({
    queryKey: ["categories-for-form"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_categories")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const categories = categoriesQuery.data ?? [];

  useEffect(() => {
    if (productQuery.data && !form) setForm({ ...productQuery.data });
  }, [productQuery.data, form]);

  const publishFn = useServerFn(publishProduct);
  const publishMutation = useMutation({
    mutationFn: (platform: "shopify" | "woocommerce") => publishFn({ data: { productId: id, platform } }),
    onSuccess: (res) => {
      if (res.ok) toast.success("Published"); else toast.error(res.error ?? "Publish failed");
      queryClient.invalidateQueries({ queryKey: ["product", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function saveForm() {
    if (!form) return;
    const update: any = {
      title: form.title,
      description: form.description,
      short_description: form.short_description,
      price: form.price !== "" ? Number(form.price) : null,
      compare_at_price: form.compare_at_price !== "" ? Number(form.compare_at_price) : null,
      cost_price: form.cost_price !== "" ? Number(form.cost_price) : null,
      sku: form.sku,
      barcode: form.barcode,
      inventory_quantity: form.inventory_quantity ? Number(form.inventory_quantity) : 0,
      category: form.category,
      product_type: form.product_type,
      vendor: form.vendor,
      tags: Array.isArray(form.tags) ? form.tags : (typeof form.tags === "string" ? form.tags.split(",").map((s: string) => s.trim()).filter(Boolean) : []),
      collection_name: form.collection_name,
      woo_category: form.woo_category,
      seo_title: form.seo_title,
      seo_description: form.seo_description,
      slug: form.slug,
    };
    const { error } = await supabase.from("products").update(update).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    queryClient.invalidateQueries({ queryKey: ["product", id] });
  }

  async function transition(newStatus: string, opts?: { note?: string }) {
    const patch: any = { status: newStatus };
    if (opts?.note !== undefined) patch.rejection_note = opts.note;
    const { error } = await supabase.from("products").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Marked as ${newStatus}`);
    queryClient.invalidateQueries({ queryKey: ["product", id] });
  }

  if (productQuery.isLoading || !form) {
    return <div className="p-10 text-sm text-muted-foreground">Loading…</div>;
  }
  if (productQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Could not load product</AlertTitle>
        <AlertDescription>{(productQuery.error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  const platform = productQuery.data.clients?.store_type as "shopify" | "woocommerce" | null;
  const canPublish = isAdmin && platform && (form.status === "approved" || form.status === "failed");

  // Editing lock: only published products are read-only. Clients can edit their
  // own drafts, rejected, submitted, and approved products.
  const locked = form.status === "published";

  const tagsAsString = Array.isArray(form.tags) ? form.tags.join(", ") : form.tags ?? "";

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-muted-foreground">
            {productQuery.data.clients?.client_name} · {platform ?? "no platform"}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{form.title}</h1>
          <div className="mt-2"><StatusBadge status={form.status} /></div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => navigate({ to: "/products" })}>Back</Button>
          {!locked && (
            <Button variant="secondary" onClick={saveForm}>Save changes</Button>
          )}
          {(form.status === "draft") && (
            <Button onClick={() => transition("submitted")}>
              <Send className="mr-2 h-4 w-4" /> Submit for review
            </Button>
          )}
          {form.status === "rejected" && (
            <Button onClick={() => transition("submitted", { note: null as any })}>
              <RotateCcw className="mr-2 h-4 w-4" /> Revise & resubmit
            </Button>
          )}
          {form.status === "submitted" && (
            <Button variant="outline" onClick={() => transition("draft")}>
              <Undo2 className="mr-2 h-4 w-4" /> Withdraw
            </Button>
          )}
          {isAdmin && form.status === "submitted" && (
            <Button onClick={() => transition("approved", { note: null as any })}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Approve
            </Button>
          )}
          {isAdmin && form.status === "approved" && (
            <Button variant="outline" onClick={() => transition("submitted")}>
              <Undo2 className="mr-2 h-4 w-4" /> Unapprove
            </Button>
          )}
          {canPublish && (
            <Button onClick={() => publishMutation.mutate(platform!)}>
              <Rocket className="mr-2 h-4 w-4" /> Publish to {platform}
            </Button>
          )}
        </div>
      </div>

      {locked ? (
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertTitle>Published — read-only</AlertTitle>
          <AlertDescription>Published products cannot be edited from here.</AlertDescription>
        </Alert>
      ) : null}

      {form.status === "rejected" && form.rejection_note ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Rejected</AlertTitle>
          <AlertDescription>{form.rejection_note}</AlertDescription>
        </Alert>
      ) : null}
      {form.status === "failed" ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Publish failed</AlertTitle>
          <AlertDescription>Check the Logs page for the error returned by {platform}.</AlertDescription>
        </Alert>
      ) : null}
      {form.status === "published" && form.published_url ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Published</AlertTitle>
          <AlertDescription>
            <a href={form.published_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              View on {form.published_platform}
            </a>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Images</CardTitle></CardHeader>
        <CardContent>
          <ImageUploader productId={id} clientId={form.client_id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <F label="Title" v={form.title} on={(v) => setForm({ ...form, title: v })} disabled={locked} />
          <F label="SKU" v={form.sku ?? ""} on={(v) => setForm({ ...form, sku: v })} disabled={locked} />
          <F label="Price" v={form.price ?? ""} on={(v) => setForm({ ...form, price: v })} type="number" disabled={locked} />
          <F label="Compare-at price" v={form.compare_at_price ?? ""} on={(v) => setForm({ ...form, compare_at_price: v })} type="number" disabled={locked} />
          <F label="Cost price" v={form.cost_price ?? ""} on={(v) => setForm({ ...form, cost_price: v })} type="number" disabled={locked} />
          <F label="Barcode" v={form.barcode ?? ""} on={(v) => setForm({ ...form, barcode: v })} disabled={locked} />
          <F label="Inventory" v={form.inventory_quantity ?? "0"} on={(v) => setForm({ ...form, inventory_quantity: v })} type="number" disabled={locked} />
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Popover open={categoryPickerOpen} onOpenChange={setCategoryPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  disabled={locked}
                  aria-expanded={categoryPickerOpen}
                  className="w-full justify-between font-normal"
                >
                  <span className={cn("truncate", !form.category && "text-muted-foreground")}>
                    {form.category || (categories.length === 0 ? "No categories yet" : "Search categories…")}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Type to search…" />
                  <CommandList>
                    <CommandEmpty>No matching category.</CommandEmpty>
                    {form.category ? (
                      <CommandGroup>
                        <CommandItem
                          value="__clear__"
                          onSelect={() => { setForm({ ...form, category: "" }); setCategoryPickerOpen(false); }}
                        >
                          Clear selection
                        </CommandItem>
                      </CommandGroup>
                    ) : null}
                    <CommandGroup heading="Categories">
                      {categories.map((c) => (
                        <CommandItem
                          key={c.id}
                          value={c.name}
                          onSelect={(v) => { setForm({ ...form, category: v }); setCategoryPickerOpen(false); }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", form.category === c.name ? "opacity-100" : "opacity-0")} />
                          {c.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <F label="Product type" v={form.product_type ?? ""} on={(v) => setForm({ ...form, product_type: v })} disabled={locked} />
          <F label="Vendor" v={form.vendor ?? ""} on={(v) => setForm({ ...form, vendor: v })} disabled={locked} />
          <F label="Tags (comma separated)" v={tagsAsString} on={(v) => setForm({ ...form, tags: v })} disabled={locked} />
          <F label="Shopify collection" v={form.collection_name ?? ""} on={(v) => setForm({ ...form, collection_name: v })} disabled={locked} />
          <F label="WooCommerce category" v={form.woo_category ?? ""} on={(v) => setForm({ ...form, woo_category: v })} disabled={locked} />
          <F label="SEO title" v={form.seo_title ?? ""} on={(v) => setForm({ ...form, seo_title: v })} disabled={locked} />
          <F label="URL slug" v={form.slug ?? ""} on={(v) => setForm({ ...form, slug: v })} disabled={locked} />
          <div className="md:col-span-2 space-y-1.5">
            <Label>Short description</Label>
            <Textarea rows={2} disabled={locked} value={form.short_description ?? ""} onChange={(e) => setForm({ ...form, short_description: e.target.value })} />
          </div>
          <div className="md:col-span-2 space-y-1.5">
            <Label>Description</Label>
            <Textarea rows={6} disabled={locked} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="md:col-span-2 space-y-1.5">
            <Label>SEO meta description</Label>
            <Textarea rows={3} disabled={locked} value={form.seo_description ?? ""} onChange={(e) => setForm({ ...form, seo_description: e.target.value })} />
          </div>
        </CardContent>
      </Card>

      {isAdmin && form.status === "submitted" ? (
        <Card>
          <CardHeader><CardTitle>Reject submission</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              placeholder="Reason for rejection (visible to the client)…"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={3}
            />
            <Button variant="destructive" onClick={() => transition("rejected", { note: rejectNote })}>
              <XCircle className="mr-2 h-4 w-4" /> Reject
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function F({ label, v, on, type = "text", disabled }: { label: string; v: any; on: (v: string) => void; type?: string; disabled?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type={type} disabled={disabled} value={v ?? ""} onChange={(e) => on(e.target.value)} />
    </div>
  );
}