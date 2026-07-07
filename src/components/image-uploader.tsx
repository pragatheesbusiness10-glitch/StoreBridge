import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from "lucide-react";

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
      {images.length === 0 ? (
        <p className="text-sm text-muted-foreground">No images yet.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {images.map((img, i) => (
            <Card key={img.id} className="overflow-hidden p-0">
              <div className="aspect-square bg-muted">
                {img.signedUrl ? (
                  <img src={img.signedUrl} alt={img.alt_text ?? ""} className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="flex items-center justify-between p-2">
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => move(img, -1)} disabled={i === 0}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => move(img, 1)} disabled={i === images.length - 1}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
                <Button size="icon" variant="ghost" onClick={() => remove(img)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}