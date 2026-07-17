import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, GripVertical, ImagePlus, Star, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SortableImageGrid } from "@/components/sortable-image-grid";

type Img = { id: string; storage_path: string; sort_order: number; alt_text: string | null; signedUrl?: string };

export function ImageUploader({ productId, clientId }: { productId: string; clientId: string }) {
  const [images, setImages] = useState<Img[]>([]);
  const [uploading, setUploading] = useState(false);

  async function load() {
    const { data, error } = await supabase
      .from("product_images")
      .select("id, storage_path, sort_order, alt_text")
      .eq("product_id", productId)
      .order("sort_order", { ascending: true });
    if (error) return toast.error(error.message);
    const withUrls: Img[] = [];
    for (const row of data ?? []) {
      const { data: signed } = await supabase.storage
        .from("product-images")
        .createSignedUrl(row.storage_path, 3600);
      withUrls.push({ ...row, signedUrl: signed?.signedUrl });
    }
    setImages(withUrls);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
        const path = `clients/${clientId}/products/${productId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("product-images")
          .upload(path, file, { cacheControl: "3600", upsert: false });
        if (upErr) throw upErr;
        const nextOrder = images.length;
        const { error: dbErr } = await supabase
          .from("product_images")
          .insert({ product_id: productId, storage_path: path, sort_order: nextOrder, alt_text: file.name });
        if (dbErr) throw dbErr;
      }
      toast.success("Images uploaded");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function remove(img: Img) {
    await supabase.storage.from("product-images").remove([img.storage_path]);
    await supabase.from("product_images").delete().eq("id", img.id);
    await load();
  }

  async function move(img: Img, dir: -1 | 1) {
    const idx = images.findIndex((i) => i.id === img.id);
    const other = images[idx + dir];
    if (!other) return;
    await Promise.all([
      supabase.from("product_images").update({ sort_order: other.sort_order }).eq("id", img.id),
      supabase.from("product_images").update({ sort_order: img.sort_order }).eq("id", other.id),
    ]);
    await load();
  }

  async function setPrimary(img: Img) {
    const idx = images.findIndex((i) => i.id === img.id);
    if (idx <= 0) return;
    // Renumber: chosen image becomes sort_order 0; everything before it shifts down by 1.
    const updates = images.map((row, i) => {
      if (row.id === img.id) return { id: row.id, sort_order: 0 };
      if (i < idx) return { id: row.id, sort_order: i + 1 };
      return { id: row.id, sort_order: i };
    });
    try {
      await Promise.all(
        updates.map((u) =>
          supabase.from("product_images").update({ sort_order: u.sort_order }).eq("id", u.id),
        ),
      );
      toast.success("Primary image updated");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not set primary image");
    }
  }

  async function persistOrder(nextItems: Img[]) {
    const prev = images;
    // Optimistic UI
    setImages(nextItems.map((it, i) => ({ ...it, sort_order: i })));
    try {
      await Promise.all(
        nextItems.map((it, i) =>
          supabase.from("product_images").update({ sort_order: i }).eq("id", it.id),
        ),
      );
      toast.success("Image order updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save order");
      setImages(prev);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="inline-flex">
          <input
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
          <Button asChild variant="outline" disabled={uploading}>
            <span>
              <ImagePlus className="h-4 w-4 mr-2" />
              {uploading ? "Uploading..." : "Add images"}
            </span>
          </Button>
        </label>
        <span className="text-xs text-muted-foreground">
          {images.length} image{images.length === 1 ? "" : "s"}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Drag a tile or use the grip handle (space to pick up, arrow keys to move, space to drop) to reorder. The first image is the primary cover.
      </p>
      {images.length === 0 ? (
        <p className="text-sm text-muted-foreground">No images yet.</p>
      ) : (
        <SortableImageGrid
          items={images}
          onReorder={(next) => persistOrder(next)}
          renderItem={(img, i, handle) => (
            <Card className={i === 0 ? "overflow-hidden p-0 ring-2 ring-primary shadow-md" : "overflow-hidden p-0"}>
              <div className="relative aspect-square bg-muted">
                {img.signedUrl ? (
                  <img src={img.signedUrl} alt={img.alt_text ?? ""} className="h-full w-full object-cover" draggable={false} />
                ) : null}
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
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setPrimary(img)}
                    disabled={i === 0}
                    title={i === 0 ? "Already primary" : "Set as primary"}
                    aria-label={i === 0 ? "Already primary" : "Set as primary"}
                  >
                    <Star className={i === 0 ? "h-4 w-4 fill-current text-primary" : "h-4 w-4"} />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => move(img, -1)} disabled={i === 0} aria-label="Move image up">
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => move(img, 1)} disabled={i === images.length - 1} aria-label="Move image down">
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
                <Button size="icon" variant="ghost" onClick={() => remove(img)} aria-label="Remove image">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </Card>
          )}
        />
      )}
    </div>
  );
}