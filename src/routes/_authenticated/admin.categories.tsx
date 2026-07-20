import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useRoleGuard } from "@/hooks/use-role-guard";
import { deleteProductCategory, createProductCategory, updateProductCategory } from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "sonner";
import { Tags, Pencil, Trash2, Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/categories")({
  component: CategoriesPage,
});

type Category = { id: string; name: string; slug: string; description: string | null; parent_id: string | null };

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function CategoriesPage() {
  const { allowed } = useRoleGuard("superAdmin");
  const queryClient = useQueryClient();
  const deleteCategory = useServerFn(deleteProductCategory);
  const createCategory = useServerFn(createProductCategory);
  const updateCategory = useServerFn(updateProductCategory);

  const listQuery = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_categories")
        .select("id, name, slug, description, parent_id")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Category[];
    },
  });

  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Category | null>(null);
  const [form, setForm] = useState({ name: "", slug: "", description: "", parent_id: "" });

  const openNew = () => { setEdit(null); setForm({ name: "", slug: "", description: "", parent_id: "" }); setOpen(true); };
  const openEdit = (c: Category) => {
    setEdit(c);
    setForm({ name: c.name, slug: c.slug, description: c.description ?? "", parent_id: c.parent_id ?? "" });
    setOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        slug: (form.slug || slugify(form.name)).trim(),
        description: form.description || null,
        parent_id: form.parent_id || null,
      };
      if (!payload.name) throw new Error("Name is required");
      if (edit) {
        await updateCategory({ data: {
          id: edit.id,
          name: payload.name,
          slug: payload.slug,
          description: payload.description,
          parentId: payload.parent_id,
        } });
      } else {
        await createCategory({ data: {
          name: payload.name,
          slug: payload.slug,
          description: payload.description,
          parentId: payload.parent_id,
        } });
      }
    },
    onSuccess: () => {
      toast.success(edit ? "Category updated" : "Category created");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["categories-for-form"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await deleteCategory({ data: { categoryId: id } });
    },
    onSuccess: () => {
      toast.success("Deleted");
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["categories-for-form"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!allowed) return null;

  const rows = listQuery.data ?? [];
  const byId = new Map(rows.map((r) => [r.id, r]));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
          <p className="text-sm text-muted-foreground">Categories power the picker on the product form.</p>
        </div>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button onClick={openNew}><Plus className="mr-2 h-4 w-4" /> New category</Button>
          </SheetTrigger>
          <SheetContent className="sm:max-w-md">
            <SheetHeader><SheetTitle>{edit ? "Edit category" : "New category"}</SheetTitle></SheetHeader>
            <div className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: form.slug || slugify(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Slug</Label>
                <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="auto from name" />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
              </div>
              <div className="space-y-1.5">
                <Label>Parent (optional)</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={form.parent_id}
                  onChange={(e) => setForm({ ...form, parent_id: e.target.value })}
                >
                  <option value="">— none —</option>
                  {rows.filter((r) => r.id !== edit?.id).map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.name}>
                  {edit ? "Save changes" : "Create category"}
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {listQuery.isLoading ? (
        <div className="text-sm text-muted-foreground p-8 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Tags} title="No categories yet" description="Add categories that clients can pick when submitting products."
          action={<Button onClick={openNew}><Plus className="mr-2 h-4 w-4" /> New category</Button>} />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Parent</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.slug}</TableCell>
                  <TableCell className="text-sm">{c.parent_id ? byId.get(c.parent_id)?.name ?? "—" : "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { if (confirm(`Delete "${c.name}"?`)) deleteMut.mutate(c.id); }}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
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