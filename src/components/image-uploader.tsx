import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { AlertCircle, ArrowDown, ArrowUp, CheckCircle2, GripVertical, ImagePlus, Loader2, RotateCw, Star, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SortableImageGrid } from "@/components/sortable-image-grid";
import { Progress } from "@/components/ui/progress";

type Img = { id: string; storage_path: string; sort_order: number; alt_text: string | null; signedUrl?: string };

type UploadItem = {
  id: string;
  file: File;
  status: "queued" | "uploading" | "success" | "error";
  progress: number;
  error?: string;
};

function friendlyUploadError(status: number, body: string): string {
  if (status === 401 || status === 403) return "You don't have permission to upload to this product.";
  if (status === 413) return "File is too large.";
  if (status === 409) return "A file with this name already exists — try again.";
  if (status === 0) return "Network error — check your connection and try again.";
  const match = body.match(/"message":"([^"]+)"/);
  if (match) return match[1];
  return `Upload failed (HTTP ${status})`;
}

function uploadWithProgress(
  url: string,
  file: File,
  token: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("cache-control", "3600");
    if (file.type) xhr.setRequestHeader("content-type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(friendlyUploadError(xhr.status, xhr.responseText)));
    };
    xhr.onerror = () => reject(new Error(friendlyUploadError(0, "")));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    // Signed upload URL already carries the token in the query string,
    // but sending it as a bearer keeps parity with server-side clients.
    void token;
    xhr.send(file);
  });
}

export function ImageUploader({ productId, clientId }: { productId: string; clientId: string }) {
  const [images, setImages] = useState<Img[]>([]);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const uploading = uploads.some((u) => u.status === "uploading" || u.status === "queued");

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

  function patchUpload(id: string, patch: Partial<UploadItem>) {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }

  async function uploadOne(item: UploadItem, order: number) {
    patchUpload(item.id, { status: "uploading", progress: 0, error: undefined });
    try {
      const ext = item.file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `clients/${clientId}/products/${productId}/${crypto.randomUUID()}.${ext}`;
      const { data: signed, error: signErr } = await supabase.storage
        .from("product-images")
        .createSignedUploadUrl(path);
      if (signErr || !signed) throw new Error(signErr?.message ?? "Could not start upload");
      await uploadWithProgress(signed.signedUrl, item.file, signed.token, (p) =>
        patchUpload(item.id, { progress: p }),
      );
      const { error: dbErr } = await supabase
        .from("product_images")
        .insert({ product_id: productId, storage_path: path, sort_order: order, alt_text: item.file.name });
      if (dbErr) {
        // Roll back the object we just uploaded so we don't leak orphans.
        await supabase.storage.from("product-images").remove([path]);
        throw new Error(dbErr.message);
      }
      patchUpload(item.id, { status: "success", progress: 100 });
    } catch (err) {
      patchUpload(item.id, {
        status: "error",
        error: err instanceof Error ? err.message : "Upload failed",
      });
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const newItems: UploadItem[] = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      file,
      status: "queued",
      progress: 0,
    }));
    setUploads((prev) => [...prev, ...newItems]);
    let order = images.length;
    for (const item of newItems) {
      await uploadOne(item, order);
      order += 1;
    }
    const finished = newItems.length;
    const failed = newItems.filter((n) => {
      // uploads state may have moved on; check latest by id below.
      return false;
    }).length;
    // Read latest statuses from state via callback
    setUploads((prev) => {
      const relevant = prev.filter((p) => newItems.some((n) => n.id === p.id));
      const ok = relevant.filter((r) => r.status === "success").length;
      const bad = relevant.filter((r) => r.status === "error").length;
      if (ok > 0) toast.success(`${ok} of ${finished} image${finished === 1 ? "" : "s"} uploaded`);
      if (bad > 0) toast.error(`${bad} image${bad === 1 ? "" : "s"} failed — see list below`);
      return prev;
    });
    void failed;
    await load();
  }

  async function retryUpload(id: string) {
    const item = uploads.find((u) => u.id === id);
    if (!item) return;
    await uploadOne(item, images.length);
    await load();
  }

  function dismissUpload(id: string) {
    setUploads((prev) => prev.filter((u) => u.id !== id));
  }

  function clearFinished() {
    setUploads((prev) => prev.filter((u) => u.status === "uploading" || u.status === "queued"));
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
            onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }}
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
        {uploads.some((u) => u.status === "success" || u.status === "error") ? (
          <Button variant="ghost" size="sm" onClick={clearFinished} className="ml-auto">
            Clear finished
          </Button>
        ) : null}
      </div>
      {uploads.length > 0 ? (
        <ul role="list" aria-label="Upload progress" className="space-y-2 rounded-md border p-2">
          {uploads.map((u) => (
            <li key={u.id} className="flex items-center gap-3 text-sm">
              <div className="shrink-0">
                {u.status === "uploading" || u.status === "queued" ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Uploading" />
                ) : u.status === "success" ? (
                  <CheckCircle2 className="h-4 w-4 text-primary" aria-label="Uploaded" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-destructive" aria-label="Failed" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{u.file.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0" aria-live="polite">
                    {u.status === "uploading" ? `${u.progress}%` :
                     u.status === "queued" ? "Queued" :
                     u.status === "success" ? "Done" : "Failed"}
                  </span>
                </div>
                {u.status === "uploading" || u.status === "queued" ? (
                  <Progress value={u.status === "queued" ? 0 : u.progress} className="mt-1 h-1" />
                ) : null}
                {u.status === "error" && u.error ? (
                  <p className="mt-1 text-xs text-destructive">{u.error}</p>
                ) : null}
              </div>
              {u.status === "error" ? (
                <Button size="sm" variant="outline" onClick={() => retryUpload(u.id)} aria-label={`Retry uploading ${u.file.name}`}>
                  <RotateCw className="h-3 w-3 mr-1" /> Retry
                </Button>
              ) : null}
              {u.status !== "uploading" && u.status !== "queued" ? (
                <Button size="icon" variant="ghost" onClick={() => dismissUpload(u.id)} aria-label={`Dismiss ${u.file.name}`}>
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
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
                <button
                  type="button"
                  onClick={() => setPrimary(img)}
                  disabled={i === 0}
                  aria-label={i === 0 ? "Already the primary cover image" : "Set as primary cover image"}
                  title={i === 0 ? "Already the primary cover" : "Click to set as primary cover"}
                  className="group absolute inset-0 h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                >
                  {img.signedUrl ? (
                    <img src={img.signedUrl} alt={img.alt_text ?? ""} className="h-full w-full object-cover" draggable={false} />
                  ) : null}
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