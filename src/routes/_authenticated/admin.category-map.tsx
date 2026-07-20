import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { useRoleGuard } from "@/hooks/use-role-guard";
import {
  listPlatformCategoryMap,
  upsertPlatformCategoryMap,
  deletePlatformCategoryMap,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/admin/category-map")({
  component: CategoryMapPage,
});

type Integration = {
  id: string; client_id: string; platform: "shopify" | "woocommerce";
  store_name: string | null; store_url: string; is_active: boolean;
  clients?: { client_name: string } | null;
};
type Category = { id: string; name: string; slug: string };
type Mapping = {
  id: string; integration_id: string; category_id: string;
  platform_category_id: string; platform_handle: string | null; updated_at: string;
};

type FormState = {
  id?: string;
  integrationId: string;
  categoryId: string;
  platformCategoryId: string;
  platformHandle: string;
};

const emptyForm: FormState = { integrationId: "", categoryId: "", platformCategoryId: "", platformHandle: "" };

function CategoryMapPage() {
  const { allowed } = useRoleGuard("admin");
  const queryClient = useQueryClient();
  const listFn = useServerFn(listPlatformCategoryMap);
  const upsertFn = useServerFn(upsertPlatformCategoryMap);
  const deleteFn = useServerFn(deletePlatformCategoryMap);

  const query = useQuery({
    queryKey: ["platform-category-map"],
    queryFn: () => listFn(),
    enabled: !!allowed,
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const integs = (query.data?.integrations ?? []) as Integration[];
  const cats = (query.data?.categories ?? []) as Category[];
  const mappings = (query.data?.mappings ?? []) as Mapping[];
  const integById = useMemo(() => new Map(integs.map((i) => [i.id, i])), [integs]);
  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return mappings;
    return mappings.filter((m) => {
      const i = integById.get(m.integration_id);
      const c = catById.get(m.category_id);
      return (
        c?.name.toLowerCase().includes(q) ||
        i?.clients?.client_name?.toLowerCase().includes(q) ||
        i?.platform.includes(q) ||
        m.platform_category_id.toLowerCase().includes(q) ||
        (m.platform_handle ?? "").toLowerCase().includes(q)
      );
    });
  }, [filter, mappings, integById, catById]);

  const openNew = () => { setForm(emptyForm); setOpen(true); };
  const openEdit = (m: Mapping) => {
    setForm({
      id: m.id,
      integrationId: m.integration_id,
      categoryId: m.category_id,
      platformCategoryId: m.platform_category_id,
      platformHandle: m.platform_handle ?? "",
    });
    setOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!form.integrationId || !form.categoryId || !form.platformCategoryId.trim()) {
        throw new Error("Integration, catalogue and platform ID are required");
      }
      await upsertFn({ data: {
        id: form.id,
        integrationId: form.integrationId,
        categoryId: form.categoryId,
        platformCategoryId: form.platformCategoryId.trim(),
        platformHandle: form.platformHandle.trim() || null,
      } });
    },
    onSuccess: () => {
      toast.success(form.id ? "Mapping updated" : "Mapping created");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["platform-category-map"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => { await deleteFn({ data: { id } }); },
    onSuccess: () => {
      toast.success("Mapping deleted");
      setDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ["platform-category-map"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!allowed) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Category mappings</h1>
          <p className="text-sm text-muted-foreground">
            Link local catalogues to Shopify collections and WooCommerce categories used during publish.
          </p>
        </div>
        <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" /> New mapping</Button>
      </div>

      <div className="flex items-center gap-2">
        <Input
          placeholder="Filter by client, catalogue, platform, or ID…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-sm"
        />
        <span className="text-xs text-muted-foreground">{filtered.length} of {mappings.length}</span>
      </div>

      {query.isLoading ? (
        <div className="text-sm text-muted-foreground p-8 text-center">Loading…</div>
      ) : mappings.length === 0 ? (
        <EmptyState
          icon={Link2}
          title="No mappings yet"
          description="Mappings are created automatically on publish, or you can add them manually."
          action={<Button onClick={openNew}><Plus className="mr-2 h-4 w-4" /> New mapping</Button>}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Integration</TableHead>
                <TableHead>Catalogue</TableHead>
                <TableHead>Platform ID</TableHead>
                <TableHead>Handle</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((m) => {
                const i = integById.get(m.integration_id);
                const c = catById.get(m.category_id);
                return (
                  <TableRow key={m.id}>
                    <TableCell className="text-sm">{i?.clients?.client_name ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="capitalize">{i?.platform ?? "?"}</Badge>
                        <span className="text-xs text-muted-foreground">{i?.store_name ?? i?.store_url ?? ""}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{c?.name ?? <span className="text-muted-foreground">Unknown</span>}</TableCell>
                    <TableCell className="font-mono text-xs">{m.platform_category_id}</TableCell>
                    <TableCell className="font-mono text-xs">{m.platform_handle ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(m)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleteId(m.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader><SheetTitle>{form.id ? "Edit mapping" : "New mapping"}</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label>Integration *</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={form.integrationId}
                onChange={(e) => setForm({ ...form, integrationId: e.target.value })}
              >
                <option value="">— select —</option>
                {integs.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.clients?.client_name ?? "?"} · {i.platform} · {i.store_name ?? i.store_url}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Catalogue *</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              >
                <option value="">— select —</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Platform category ID *</Label>
              <Input
                value={form.platformCategoryId}
                onChange={(e) => setForm({ ...form, platformCategoryId: e.target.value })}
                placeholder="e.g. 123456789 (Shopify collection ID / Woo term ID)"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Handle / slug</Label>
              <Input
                value={form.platformHandle}
                onChange={(e) => setForm({ ...form, platformHandle: e.target.value })}
                placeholder="optional"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                {form.id ? "Save changes" : "Create mapping"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete mapping?</AlertDialogTitle>
            <AlertDialogDescription>
              The next publish will recreate or re-resolve the platform category for this catalogue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMut.mutate(deleteId)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}