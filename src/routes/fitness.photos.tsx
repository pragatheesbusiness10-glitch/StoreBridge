import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Camera, Lock, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ConfirmDelete,
  EmptyHint,
  Field,
  NativeSelect,
  NumInput,
  PageHeader,
  Panel,
  Segmented,
  fmtNum,
  parseOptNum,
  signed,
  strOf,
} from "@/components/pp/ui";
import { compressImage } from "@/lib/image-compress";
import { fmtDate, todayStr } from "@/lib/pp/dates";
import { currentUserId, db, errMsg, qk, useList, useTableMutations } from "@/lib/pp/db";
import type { BodyMeasurement, ProgressPhoto, WeightLog } from "@/lib/pp/types";

export const Route = createFileRoute("/fitness/photos")({
  validateSearch: (s: Record<string, unknown>): { upload?: number } =>
    s.upload ? { upload: 1 } : {},
  component: PhotosPage,
});

const BUCKET = "progress-photos";
const VIEWS = [
  { value: "front", label: "Front" },
  { value: "side", label: "Side" },
  { value: "back", label: "Back" },
] as const;
type View = (typeof VIEWS)[number]["value"];

/** Local object URLs for photos stored on this device (never uploaded). */
function useSignedUrls(paths: string[]) {
  return useQuery({
    queryKey: qk("progress_photos", "signed", paths.join("|")),
    enabled: paths.length > 0,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await db.storage.from(BUCKET).createSignedUrls(paths, 60 * 60);
      if (error) throw error;
      return new Map(
        (data ?? [])
          .filter((d) => d.path && d.signedUrl)
          .map((d) => [d.path as string, d.signedUrl as string]),
      );
    },
  });
}

function PhotosPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const photosQ = useList<ProgressPhoto>("progress_photos", {
    order: "photo_date",
    ascending: false,
  });
  const weightsQ = useList<WeightLog>("daily_weight_logs", { order: "log_date" });
  const measQ = useList<BodyMeasurement>("daily_body_measurements", { order: "measured_on" });
  const { invalidate } = useTableMutations("progress_photos");
  const photos = useMemo(() => photosQ.data ?? [], [photosQ.data]);
  const urlsQ = useSignedUrls(photos.map((p) => p.storage_path));
  const urls = urlsQ.data ?? new Map<string, string>();

  const [mode, setMode] = useState<"timeline" | "compare">("timeline");
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayStr());
  const [view, setView] = useState<View>("front");
  const [file, setFile] = useState<File | null>(null);
  const [weight, setWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<ProgressPhoto | null>(null);

  // Snapshot the recorded weight/waist of the photo date (if any). Never invented.
  useEffect(() => {
    if (!open) return;
    const w = weightsQ.data?.find((x) => x.log_date === date);
    const m = measQ.data?.find((x) => x.measured_on === date);
    setWeight(strOf(w?.morning_weight_kg));
    setWaist(strOf(m?.waist_cm));
  }, [open, date, weightsQ.data, measQ.data]);
  useEffect(() => {
    if (search.upload) {
      setOpen(true);
      navigate({ to: "/fitness/photos", search: {}, replace: true });
    }
  }, [search.upload, navigate]);

  const upload = async () => {
    if (!file) return toast.error("Choose a photo");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
      return toast.error("Use a JPEG, PNG or WebP image");
    const wv = parseOptNum(weight, { min: 20, max: 400 });
    const wa = parseOptNum(waist, { min: 30, max: 250 });
    if (wv === undefined || wa === undefined) return toast.error("Check weight / waist values");
    setBusy(true);
    try {
      // Re-encode on the device: shrinks the upload and strips EXIF metadata such as GPS location.
      const processed = await compressImage(file, {
        maxDimension: 1600,
        quality: 0.85,
        minBytesToCompress: 0,
      });
      if (processed.size > 10 * 1024 * 1024)
        throw new Error("Image is larger than 10 MB after compression");
      const uid = await currentUserId();
      const ext =
        processed.type === "image/png" ? "png" : processed.type === "image/webp" ? "webp" : "jpg";
      const path = `${uid}/${date}/${view}-${crypto.randomUUID()}.${ext}`;
      const { error: ue } = await db.storage
        .from(BUCKET)
        .upload(path, processed, { contentType: processed.type, upsert: false });
      if (ue) throw ue;
      const { error: ie } = await db.from("progress_photos").insert({
        photo_date: date,
        view,
        storage_path: path,
        weight_kg: wv,
        waist_cm: wa,
        notes: notes.trim() || null,
      });
      if (ie) {
        await db.storage.from(BUCKET).remove([path]);
        throw ie;
      }
      toast.success("Photo saved on this device");
      setOpen(false);
      setFile(null);
      setNotes("");
      invalidate();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const del = async (p: ProgressPhoto) => {
    const { error } = await db.storage.from(BUCKET).remove([p.storage_path]);
    if (error) return toast.error(errMsg(error));
    const { error: de } = await db.from("progress_photos").delete().eq("id", p.id);
    if (de) return toast.error(errMsg(de));
    toast.success("Photo deleted");
    setLightbox(null);
    invalidate();
  };

  const byDate = useMemo(() => {
    const m = new Map<string, ProgressPhoto[]>();
    for (const p of photos) m.set(p.photo_date, [...(m.get(p.photo_date) ?? []), p]);
    return [...m.entries()];
  }, [photos]);
  const dates = byDate.map(([d]) => d);

  return (
    <div>
      <PageHeader
        title="Progress Photos"
        description={
          <span className="inline-flex items-center gap-1">
            <Lock className="h-3.5 w-3.5" /> Private: photos are stored only on this device and are
            never uploaded anywhere.
          </span>
        }
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Camera className="mr-1 h-4 w-4" /> Add photo
          </Button>
        }
      />
      <Segmented
        className="mb-4"
        value={mode}
        onChange={setMode}
        options={[
          { value: "timeline", label: "Timeline" },
          { value: "compare", label: "Compare" },
        ]}
      />
      {photos.length === 0 ? (
        <EmptyHint
          action={
            <Button size="sm" onClick={() => setOpen(true)}>
              Add your first photo
            </Button>
          }
        >
          No photos yet. Take front, side and back photos in the same light and pose each time.
        </EmptyHint>
      ) : mode === "timeline" ? (
        <div className="space-y-4">
          {byDate.map(([d, ps]) => (
            <Panel
              key={d}
              title={fmtDate(d, "EEEE d MMM yyyy")}
              description={[
                ps.find((p) => p.weight_kg)?.weight_kg
                  ? `${fmtNum(ps.find((p) => p.weight_kg)!.weight_kg, 2)} kg`
                  : null,
                ps.find((p) => p.waist_cm)?.waist_cm
                  ? `waist ${fmtNum(ps.find((p) => p.waist_cm)!.waist_cm)} cm`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            >
              <div className="grid grid-cols-3 gap-2">
                {ps.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="group relative overflow-hidden rounded-lg border bg-muted"
                    onClick={() => setLightbox(p)}
                  >
                    {urls.get(p.storage_path) ? (
                      <img
                        src={urls.get(p.storage_path)}
                        alt={`${p.view} view ${p.photo_date}`}
                        className="aspect-[3/4] w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="aspect-[3/4] w-full animate-pulse" />
                    )}
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] uppercase text-white">
                      {p.view}
                    </span>
                  </button>
                ))}
              </div>
            </Panel>
          ))}
        </div>
      ) : (
        <Compare photos={photos} dates={dates} urls={urls} />
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add progress photo</DialogTitle>
            <DialogDescription>
              JPEG, PNG or WebP. Images are resized and stripped of location metadata before saving
              on this device.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" id="ph-date">
              <Input
                id="ph-date"
                type="date"
                value={date}
                max={todayStr()}
                onChange={(e) => e.target.value && setDate(e.target.value)}
              />
            </Field>
            <Field label="View" id="ph-view">
              <NativeSelect
                id="ph-view"
                value={view}
                onChange={(v) => setView(v as View)}
                options={[...VIEWS]}
              />
            </Field>
            <Field label="Photo" id="ph-file" className="col-span-2">
              <Input
                id="ph-file"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </Field>
            <Field
              label="Weight that day (kg)"
              id="ph-w"
              hint={weight ? "From your weigh-in" : "No weigh-in that day"}
            >
              <NumInput id="ph-w" value={weight} onChange={setWeight} />
            </Field>
            <Field
              label="Waist (cm)"
              id="ph-waist"
              hint={waist ? "From your measurements" : "Optional"}
            >
              <NumInput id="ph-waist" value={waist} onChange={setWaist} />
            </Field>
            <Field label="Notes" id="ph-notes" className="col-span-2">
              <Textarea
                id="ph-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={upload} disabled={busy}>
              <Upload className="mr-1 h-4 w-4" /> {busy ? "Saving…" : "Save photo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="sm:max-w-lg">
          {lightbox && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {fmtDate(lightbox.photo_date)} · {lightbox.view}
                </DialogTitle>
                <DialogDescription>
                  {lightbox.weight_kg
                    ? `${fmtNum(lightbox.weight_kg, 2)} kg`
                    : "No weight recorded"}
                  {lightbox.waist_cm ? ` · waist ${fmtNum(lightbox.waist_cm)} cm` : ""}
                  {lightbox.notes ? ` · ${lightbox.notes}` : ""}
                </DialogDescription>
              </DialogHeader>
              {urls.get(lightbox.storage_path) && (
                <img
                  src={urls.get(lightbox.storage_path)}
                  alt=""
                  className="max-h-[65vh] w-full rounded-lg object-contain"
                />
              )}
              <DialogFooter>
                <ConfirmDelete size="sm" what="this photo" onConfirm={() => del(lightbox)} />
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Compare({
  photos,
  dates,
  urls,
}: {
  photos: ProgressPhoto[];
  dates: string[];
  urls: Map<string, string>;
}) {
  const [view, setView] = useState<View>("front");
  const withView = [
    ...new Set(photos.filter((p) => p.view === view).map((p) => p.photo_date)),
  ].sort();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  useEffect(() => {
    setA(withView[0] ?? "");
    setB(withView[withView.length - 1] ?? "");
  }, [view, dates.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const pa = photos.find((p) => p.view === view && p.photo_date === a);
  const pb = photos.find((p) => p.view === view && p.photo_date === b);
  const opts = withView.map((d) => ({ value: d, label: fmtDate(d) }));
  const dw = pa?.weight_kg && pb?.weight_kg ? Number(pb.weight_kg) - Number(pa.weight_kg) : null;
  const dwaist = pa?.waist_cm && pb?.waist_cm ? Number(pb.waist_cm) - Number(pa.waist_cm) : null;
  return (
    <Panel
      title="Before & after"
      action={<Segmented value={view} onChange={setView} options={[...VIEWS]} />}
      description={
        dw !== null || dwaist !== null
          ? `Change: ${dw !== null ? signed(dw, 2, " kg") : ""}${dw !== null && dwaist !== null ? " · " : ""}${dwaist !== null ? signed(dwaist, 1, " cm waist") : ""}`
          : undefined
      }
    >
      {withView.length < 1 ? (
        <EmptyHint>No {view} photos yet.</EmptyHint>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {[
            { d: a, set: setA, p: pa, label: "Before" },
            { d: b, set: setB, p: pb, label: "After" },
          ].map((x) => (
            <div key={x.label} className="space-y-2">
              <NativeSelect value={x.d} onChange={x.set} options={opts} />
              {x.p && urls.get(x.p.storage_path) ? (
                <img
                  src={urls.get(x.p.storage_path)}
                  alt={`${x.label} ${view}`}
                  className="aspect-[3/4] w-full rounded-lg border object-cover"
                />
              ) : (
                <div className="aspect-[3/4] w-full rounded-lg border bg-muted" />
              )}
              <div className="text-center text-xs text-muted-foreground">
                {x.label}
                {x.p?.weight_kg ? ` · ${fmtNum(x.p.weight_kg, 2)} kg` : ""}
                {x.p?.waist_cm ? ` · ${fmtNum(x.p.waist_cm)} cm` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
