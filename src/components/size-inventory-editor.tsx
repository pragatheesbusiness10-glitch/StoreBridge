import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, Ruler } from "lucide-react";

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