import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, Ruler, Layers } from "lucide-react";

type Variant = {
  id: string;
  product_id: string;
  size: string;
  sku: string | null;
  price: number | null;
  inventory_quantity: number;
  sort_order: number;
};

const COMMON_PRESETS = ["XS", "S", "M", "L", "XL", "XXL"];

export function SizeInventoryEditor({
  productId,
  disabled,
}: {
  productId: string;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const [newSize, setNewSize] = useState("");
  const [newQty, setNewQty] = useState<string>("0");
  const [newSku, setNewSku] = useState("");
  const [newPrice, setNewPrice] = useState("");

  const listQuery = useQuery({
    queryKey: ["product-variants", productId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("product_variants")
        .select("id, product_id, size, sku, price, inventory_quantity, sort_order")
        .eq("product_id", productId)
        .order("sort_order", { ascending: true })
        .order("size", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Variant[];
    },
  });

  const rows = listQuery.data ?? [];
  const totalInventory = rows.reduce((s, r) => s + (r.inventory_quantity ?? 0), 0);

  const addMut = useMutation({
    mutationFn: async () => {
      const size = newSize.trim().toUpperCase();
      if (!size) throw new Error("Size is required");
      if (rows.some((r) => r.size.toUpperCase() === size)) {
        throw new Error(`Size "${size}" already exists`);
      }
      const payload: any = {
        product_id: productId,
        size,
        sku: newSku.trim() || null,
        price: newPrice !== "" ? Number(newPrice) : null,
        inventory_quantity: newQty !== "" ? Math.max(0, Math.floor(Number(newQty))) : 0,
        sort_order: rows.length,
      };
      const { error } = await (supabase as any).from("product_variants").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Size added");
      setNewSize(""); setNewQty("0"); setNewSku(""); setNewPrice("");
      qc.invalidateQueries({ queryKey: ["product-variants", productId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkMut = useMutation({
    mutationFn: async (drafts: Array<{ size: string; sku: string; price: string; qty: string }>) => {
      const existing = new Set(rows.map((r) => r.size.toUpperCase()));
      const seen = new Set<string>();
      const payload: any[] = [];
      drafts.forEach((d, i) => {
        const size = d.size.trim().toUpperCase();
        if (!size) return;
        if (existing.has(size)) throw new Error(`Size "${size}" already exists`);
        if (seen.has(size)) throw new Error(`Duplicate size "${size}" in this batch`);
        seen.add(size);
        const priceNum = d.price !== "" ? Number(d.price) : null;
        if (priceNum != null && (!Number.isFinite(priceNum) || priceNum < 0)) {
          throw new Error(`Invalid price for size "${size}"`);
        }
        const qtyNum = d.qty !== "" ? Math.max(0, Math.floor(Number(d.qty))) : 0;
        if (!Number.isFinite(qtyNum)) throw new Error(`Invalid quantity for size "${size}"`);
        payload.push({
          product_id: productId,
          size,
          sku: d.sku.trim() || null,
          price: priceNum,
          inventory_quantity: qtyNum,
          sort_order: rows.length + i,
        });
      });
      if (payload.length === 0) throw new Error("Add at least one row");
      const { error } = await (supabase as any).from("product_variants").insert(payload);
      if (error) throw error;
      return payload.length;
    },
    onSuccess: (n) => {
      toast.success(`Added ${n} size${n === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["product-variants", productId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Variant> }) => {
      const { error } = await (supabase as any).from("product_variants").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["product-variants", productId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("product_variants").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removed");
      qc.invalidateQueries({ queryKey: ["product-variants", productId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Ruler className="h-4 w-4" /> Inventory by size
          {rows.length > 0 ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {rows.length} size{rows.length === 1 ? "" : "s"} · total {totalInventory}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!disabled ? (
          <div className="rounded-md border p-3 space-y-3">
            <div className="flex justify-end">
              <BulkAddDialog
                existingSizes={rows.map((r) => r.size.toUpperCase())}
                onSubmit={(drafts) => bulkMut.mutateAsync(drafts)}
                isPending={bulkMut.isPending}
              />
            </div>
            <div className="grid gap-2 md:grid-cols-[110px_1fr_1fr_110px_auto] md:items-end">
              <div className="space-y-1.5">
                <Label className="text-xs">Size</Label>
                <Input value={newSize} onChange={(e) => setNewSize(e.target.value)} placeholder="M" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">SKU (optional)</Label>
                <Input value={newSku} onChange={(e) => setNewSku(e.target.value)} placeholder="SKU-M" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Price override (optional)</Label>
                <Input type="number" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="—" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Quantity</Label>
                <Input type="number" min={0} value={newQty} onChange={(e) => setNewQty(e.target.value)} />
              </div>
              <Button onClick={() => addMut.mutate()} disabled={addMut.isPending || !newSize.trim()}>
                {addMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Add size
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground mr-1">Quick add:</span>
              {COMMON_PRESETS.map((p) => {
                const already = rows.some((r) => r.size.toUpperCase() === p);
                return (
                  <Button
                    key={p}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={already || addMut.isPending}
                    onClick={() => { setNewSize(p); }}
                  >
                    {p}
                  </Button>
                );
              })}
            </div>
          </div>
        ) : null}

        {listQuery.isLoading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading sizes…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No size variants yet. Add one above to track inventory per size.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Size</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="w-32">Price</TableHead>
                  <TableHead className="w-32">Quantity</TableHead>
                  <TableHead className="w-16 text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <VariantRow
                    key={r.id}
                    row={r}
                    disabled={disabled}
                    onSave={(patch) => updateMut.mutate({ id: r.id, patch })}
                    onDelete={() => deleteMut.mutate(r.id)}
                    isSaving={updateMut.isPending}
                    isDeleting={deleteMut.isPending}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VariantRow({
  row, disabled, onSave, onDelete, isSaving, isDeleting,
}: {
  row: Variant;
  disabled?: boolean;
  onSave: (patch: Partial<Variant>) => void;
  onDelete: () => void;
  isSaving: boolean;
  isDeleting: boolean;
}) {
  const [size, setSize] = useState(row.size);
  const [sku, setSku] = useState(row.sku ?? "");
  const [price, setPrice] = useState(row.price != null ? String(row.price) : "");
  const [qty, setQty] = useState(String(row.inventory_quantity ?? 0));

  const dirty =
    size !== row.size ||
    (sku || "") !== (row.sku ?? "") ||
    (price === "" ? row.price != null : Number(price) !== row.price) ||
    Number(qty) !== row.inventory_quantity;

  const commit = () => {
    if (!dirty || disabled) return;
    onSave({
      size: size.trim().toUpperCase(),
      sku: sku.trim() || null,
      price: price !== "" ? Number(price) : null,
      inventory_quantity: qty !== "" ? Math.max(0, Math.floor(Number(qty))) : 0,
    });
  };

  return (
    <TableRow>
      <TableCell>
        <Input disabled={disabled} value={size} onChange={(e) => setSize(e.target.value)} onBlur={commit} className="h-8" />
      </TableCell>
      <TableCell>
        <Input disabled={disabled} value={sku} onChange={(e) => setSku(e.target.value)} onBlur={commit} className="h-8" placeholder="—" />
      </TableCell>
      <TableCell>
        <Input disabled={disabled} type="number" value={price} onChange={(e) => setPrice(e.target.value)} onBlur={commit} className="h-8" placeholder="—" />
      </TableCell>
      <TableCell>
        <Input disabled={disabled} type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} onBlur={commit} className="h-8" />
      </TableCell>
      <TableCell className="text-right">
        {disabled ? null : (
          <Button size="icon" variant="ghost" onClick={onDelete} disabled={isDeleting || isSaving} title="Remove">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

type Draft = { size: string; sku: string; price: string; qty: string };
const PRESETS = ["XS", "S", "M", "L", "XL", "XXL"];

function BulkAddDialog({
  existingSizes,
  onSubmit,
  isPending,
}: {
  existingSizes: string[];
  onSubmit: (drafts: Draft[]) => Promise<unknown>;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([
    { size: "", sku: "", price: "", qty: "0" },
  ]);
  const [skuPrefix, setSkuPrefix] = useState("");
  const [defaultPrice, setDefaultPrice] = useState("");
  const [defaultQty, setDefaultQty] = useState("");

  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((d) => d.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setDrafts((d) => d.filter((_, idx) => idx !== i));
  const addRow = () => setDrafts((d) => [...d, { size: "", sku: "", price: "", qty: "0" }]);

  const fillPresets = () => {
    const missing = PRESETS.filter((p) => !existingSizes.includes(p));
    if (missing.length === 0) {
      toast.info("All standard sizes are already added");
      return;
    }
    setDrafts(missing.map((size) => ({ size, sku: "", price: "", qty: "0" })));
  };

  const applyDefaults = () => {
    setDrafts((d) =>
      d.map((row) => ({
        ...row,
        sku: row.sku || (skuPrefix && row.size ? `${skuPrefix}-${row.size.toUpperCase()}` : row.sku),
        price: row.price || defaultPrice,
        qty: row.qty || defaultQty,
      })),
    );
  };

  const submit = async () => {
    const cleaned = drafts.filter((d) => d.size.trim());
    if (cleaned.length === 0) return toast.error("Add at least one size row");
    try {
      await onSubmit(cleaned);
      setOpen(false);
      setDrafts([{ size: "", sku: "", price: "", qty: "0" }]);
      setSkuPrefix(""); setDefaultPrice(""); setDefaultQty("");
    } catch {
      /* error toast already surfaced */
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Layers className="mr-2 h-4 w-4" /> Bulk add sizes
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Bulk add variants</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={fillPresets}>
              Fill XS–XXL
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={addRow}>
              <Plus className="mr-1 h-4 w-4" /> Add row
            </Button>
          </div>

          <div className="rounded-md border p-3">
            <div className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
              <div className="space-y-1.5">
                <Label className="text-xs">SKU prefix</Label>
                <Input value={skuPrefix} onChange={(e) => setSkuPrefix(e.target.value)} placeholder="TSHIRT" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Default price</Label>
                <Input type="number" value={defaultPrice} onChange={(e) => setDefaultPrice(e.target.value)} placeholder="—" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Default quantity</Label>
                <Input type="number" min={0} value={defaultQty} onChange={(e) => setDefaultQty(e.target.value)} placeholder="0" />
              </div>
              <Button type="button" variant="outline" onClick={applyDefaults}>Apply to empty rows</Button>
            </div>
          </div>

          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Size *</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="w-32">Price</TableHead>
                  <TableHead className="w-32">Quantity</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {drafts.map((d, i) => {
                  const size = d.size.trim().toUpperCase();
                  const conflict = size && existingSizes.includes(size);
                  const dupInBatch =
                    size && drafts.some((o, j) => j !== i && o.size.trim().toUpperCase() === size);
                  return (
                    <TableRow key={i}>
                      <TableCell>
                        <Input
                          value={d.size}
                          onChange={(e) => update(i, { size: e.target.value })}
                          className={`h-8 ${conflict || dupInBatch ? "border-destructive" : ""}`}
                          placeholder="M"
                        />
                        {conflict ? (
                          <p className="mt-1 text-[10px] text-destructive">Already exists</p>
                        ) : dupInBatch ? (
                          <p className="mt-1 text-[10px] text-destructive">Duplicate row</p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Input value={d.sku} onChange={(e) => update(i, { sku: e.target.value })} className="h-8" placeholder="—" />
                      </TableCell>
                      <TableCell>
                        <Input type="number" value={d.price} onChange={(e) => update(i, { price: e.target.value })} className="h-8" placeholder="—" />
                      </TableCell>
                      <TableCell>
                        <Input type="number" min={0} value={d.qty} onChange={(e) => update(i, { qty: e.target.value })} className="h-8" />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="icon" variant="ghost" onClick={() => remove(i)} disabled={drafts.length === 1} title="Remove row">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <p className="text-xs text-muted-foreground">
            Rows with an empty size are skipped. All rows insert in a single submission.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>Cancel</Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</> : `Create ${drafts.filter((d) => d.size.trim()).length} variant${drafts.filter((d) => d.size.trim()).length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}