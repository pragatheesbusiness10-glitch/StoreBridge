import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getMe } from "@/lib/me.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Tags, Plus, Pencil, Trash2, Loader2, AlertCircle, Search, X, Check, Lock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { friendlyCategoryError, validateCategoryName } from "@/lib/category-errors";

const searchSchema = z.object({
  q: fallback(z.string(), "").default(""),
  sort: fallback(z.string(), "name-asc").default("name-asc"),
  mine: fallback(z.boolean(), false).default(false),
});

export const Route = createFileRoute("/_authenticated/categories")({
  validateSearch: zodValidator(searchSchema),
  component: CategoriesPage,
});

type Category = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parent_id: string | null;
  created_by: string | null;
};

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function CategoriesPage() {
  const { q, sort, mine } = Route.useSearch();
  const navigate = useNavigate({ from: "/categories" });
  const setSearch = (patch: Partial<{ q: string; sort: string; mine: boolean }>) =>
    navigate({ search: { q, sort, mine, ...patch }, replace: true });

  const fetchMe = useServerFn(getMe);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });
  const isAdmin = !!me?.isAdmin;
  const userId = me?.userId ?? null;
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_categories")
        .select("id, name, slug, description, parent_id, created_by")
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
      const nameError = validateCategoryName(form.name);
      if (nameError) throw new Error(nameError);
      const payload = {
        name: form.name.trim(),
        slug: (form.slug || slugify(form.name)).trim(),
        description: form.description || null,
        parent_id: form.parent_id || null,
      };
      // Duplicate check against loaded list (excluding the row being edited).
      const dup = rows.find(
        (r) => r.id !== edit?.id && r.name.toLowerCase() === payload.name.toLowerCase(),
      );
      if (dup) throw new Error("A category with that name already exists.");
      if (edit) {
        const { error } = await supabase.from("product_categories").update(payload).eq("id", edit.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("product_categories").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(edit ? "Category updated" : "Category created");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["categories-for-form"] });
    },
    onError: (e) => toast.error(friendlyCategoryError(e)),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("product_categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deleted");
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["categories-for-form"] });
    },
    onError: (e) => toast.error(friendlyCategoryError(e)),
  });

  const allRows = listQuery.data ?? [];
  const byId = new Map(allRows.map((r) => [r.id, r]));

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = allRows.filter((c) => {
      if (mine && !(userId && c.created_by === userId)) return false;
      if (!needle) return true;
      return (
        c.name.toLowerCase().includes(needle) ||
        c.slug.toLowerCase().includes(needle) ||
        (c.description ?? "").toLowerCase().includes(needle)
      );
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case "name-desc": return b.name.localeCompare(a.name);
        case "slug-asc": return a.slug.localeCompare(b.slug);
        case "slug-desc": return b.slug.localeCompare(a.slug);
        case "name-asc":
        default: return a.name.localeCompare(b.name);
      }
    });
    return sorted;
  }, [allRows, q, sort, mine, userId]);

  const canManage = (c: Category) => isAdmin || (!!userId && c.created_by === userId);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "Manage the categories clients can pick when submitting products."
              : "Browse existing categories or add a new one for your products."}
          </p>
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
                {form.name.length > 0 && validateCategoryName(form.name) ? (
                  <p className="text-xs text-destructive">{validateCategoryName(form.name)}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">2–80 characters. Must be unique.</p>
                )}
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
              {saveMut.isError ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Couldn't save category</AlertTitle>
                  <AlertDescription>{friendlyCategoryError(saveMut.error)}</AlertDescription>
                </Alert>
              ) : null}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" disabled={saveMut.isPending} onClick={() => setOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => saveMut.mutate()}
                  disabled={saveMut.isPending || !!validateCategoryName(form.name)}
                >
                  {saveMut.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</>
                  ) : edit ? "Save changes" : "Create category"}
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <Card className="p-3">
        <div className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setSearch({ q: e.target.value })}
              placeholder="Search name, slug, description…"
              className="pl-8 pr-8"
            />
            {q ? (
              <button
                type="button"
                onClick={() => setSearch({ q: "" })}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <Select value={sort} onValueChange={(v) => setSearch({ sort: v })}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="name-asc">Name A–Z</SelectItem>
              <SelectItem value="name-desc">Name Z–A</SelectItem>
              <SelectItem value="slug-asc">Slug A–Z</SelectItem>
              <SelectItem value="slug-desc">Slug Z–A</SelectItem>
            </SelectContent>
          </Select>
          {userId ? (
            <Button
              type="button"
              variant={mine ? "default" : "outline"}
              size="sm"
              onClick={() => setSearch({ mine: !mine })}
            >
              {mine ? "Mine only" : "All"}
            </Button>
          ) : null}
          <div className="text-xs text-muted-foreground md:pl-2">
            {rows.length} of {allRows.length}
          </div>
        </div>
      </Card>

      {listQuery.isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Couldn't load categories</AlertTitle>
          <AlertDescription>{friendlyCategoryError(listQuery.error)}</AlertDescription>
        </Alert>
      ) : listQuery.isLoading ? (
        <Card className="p-4 space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </Card>
      ) : rows.length === 0 ? (
        allRows.length === 0 ? (
          <EmptyState
            icon={Tags}
            title="No categories yet"
            description="Add a category so it's available when creating products."
            action={<Button onClick={openNew}><Plus className="mr-2 h-4 w-4" /> New category</Button>}
          />
        ) : (
          <EmptyState
            icon={Search}
            title="No matches"
            description="Try a different search or clear your filters."
            action={<Button variant="outline" onClick={() => setSearch({ q: "", mine: false })}>Clear filters</Button>}
          />
        )
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
                  {canManage(c) ? (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(c)} title="Rename">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Delete"
                        onClick={() => { if (confirm(`Delete "${c.name}"?`)) deleteMut.mutate(c.id); }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
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