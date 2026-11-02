import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import JSZip from "jszip";
import { Bell, Download, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ProfileFields,
  toPayload,
  valuesFrom,
  type ProfileFormValues,
} from "@/components/pp/profile-form";
import {
  ConfirmDelete,
  Field,
  NativeSelect,
  NumInput,
  PageHeader,
  Panel,
  Toggle,
  parseOptNum,
  strOf,
} from "@/components/pp/ui";
import { download, toCsv } from "@/lib/pp/csv";
import { WEEKDAYS, fmtDate, todayStr } from "@/lib/pp/dates";
import {
  db,
  errMsg,
  targetFor,
  useList,
  useProfile,
  useProgram,
  useTableMutations,
  useTargets,
} from "@/lib/pp/db";
import type { NutritionTarget, Reminder } from "@/lib/pp/types";

export const Route = createFileRoute("/fitness/settings")({
  component: SettingsPage,
});

const EXPORT_TABLES = [
  "fitness_profiles",
  "transformation_programs",
  "daily_weight_logs",
  "daily_body_measurements",
  "food_items",
  "recipe_ingredients",
  "food_entries",
  "daily_nutrition_summaries",
  "meal_templates",
  "meal_template_items",
  "nutrition_targets",
  "exercise_library",
  "workout_plans",
  "workout_plan_exercises",
  "workout_sessions",
  "workout_exercises",
  "workout_sets",
  "cardio_logs",
  "step_logs",
  "water_logs",
  "sleep_logs",
  "progress_photos",
  "achievements",
  "reminders",
  "daily_notes",
];

function SettingsPage() {
  const qc = useQueryClient();
  const profileQ = useProfile();
  const programQ = useProgram();
  const [v, setV] = useState<ProfileFormValues | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (profileQ.data && programQ.isFetched) setV(valuesFrom(profileQ.data, programQ.data ?? null));
  }, [profileQ.data, programQ.data, programQ.isFetched]);

  const saveProfile = async () => {
    if (!v) return;
    const p = toPayload(v);
    if ("error" in p) return toast.error(p.error);
    setBusy(true);
    try {
      const { error } = await db
        .from("fitness_profiles")
        .update(p.profile)
        .eq("user_id", profileQ.data!.user_id);
      if (error) throw error;
      if (programQ.data) {
        const { error: e2 } = await db
          .from("transformation_programs")
          .update(p.program)
          .eq("id", programQ.data.id);
        if (e2) throw e2;
      } else {
        const { error: e2 } = await db.from("transformation_programs").insert(p.program);
        if (e2) throw e2;
      }
      await qc.invalidateQueries({ queryKey: ["pp"] });
      toast.success("Profile and programme updated");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const exportAll = async () => {
    setBusy(true);
    try {
      const zip = new JSZip();
      for (const t of EXPORT_TABLES) {
        const { data, error } = await db.from(t).select("*").limit(50000);
        if (error) throw error;
        zip.file(`${t}.csv`, toCsv((data ?? []) as Record<string, unknown>[]));
      }
      zip.file(
        "README.txt",
        "Prime Physique data export. One CSV per table. Progress photo files are not included (they stay in private storage); progress_photos.csv lists their paths.\n",
      );
      const blob = await zip.generateAsync({ type: "blob" });
      download(`prime-physique-export-${todayStr()}.zip`, blob, "application/zip");
      toast.success("Export ready");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        description="Every profile field, target and reminder is editable."
      />
      <Panel
        title="Profile & programme"
        action={
          <Button size="sm" onClick={saveProfile} disabled={busy || !v}>
            <Save className="mr-1 h-4 w-4" /> Save
          </Button>
        }
      >
        {v ? (
          <ProfileFields v={v} setV={setV} />
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </Panel>
      <TargetsPanel />
      <RemindersPanel />
      <Panel title="Data" description="Download everything you have recorded.">
        <Button size="sm" variant="secondary" onClick={exportAll} disabled={busy}>
          <Download className="mr-1 h-4 w-4" /> Export all data (ZIP of CSV files)
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          Report-level CSV and PDF exports are available on the Analytics page.
        </p>
      </Panel>
    </div>
  );
}

type TF = Record<
  | "kcal_min"
  | "kcal_max"
  | "protein_min_g"
  | "protein_max_g"
  | "carbs_min_g"
  | "carbs_max_g"
  | "fat_min_g"
  | "fat_max_g"
  | "fibre_min_g"
  | "fibre_max_g"
  | "water_min_ml"
  | "water_max_ml"
  | "steps_target"
  | "sleep_target_hours",
  string
>;
const TF_FIELDS: { k: keyof TF; label: string; min: number; max: number; int?: boolean }[] = [
  { k: "kcal_min", label: "Calories min (kcal)", min: 800, max: 8000, int: true },
  { k: "kcal_max", label: "Calories max (kcal)", min: 800, max: 8000, int: true },
  { k: "protein_min_g", label: "Protein min (g)", min: 0, max: 500, int: true },
  { k: "protein_max_g", label: "Protein max (g)", min: 0, max: 500, int: true },
  { k: "carbs_min_g", label: "Carbs min (g)", min: 0, max: 1000, int: true },
  { k: "carbs_max_g", label: "Carbs max (g)", min: 0, max: 1000, int: true },
  { k: "fat_min_g", label: "Fat min (g)", min: 0, max: 400, int: true },
  { k: "fat_max_g", label: "Fat max (g)", min: 0, max: 400, int: true },
  { k: "fibre_min_g", label: "Fibre min (g)", min: 0, max: 150, int: true },
  { k: "fibre_max_g", label: "Fibre max (g)", min: 0, max: 150, int: true },
  { k: "water_min_ml", label: "Water min (ml)", min: 0, max: 10000, int: true },
  { k: "water_max_ml", label: "Water max (ml)", min: 0, max: 10000, int: true },
  { k: "steps_target", label: "Daily steps target", min: 0, max: 100000, int: true },
  { k: "sleep_target_hours", label: "Sleep target (h)", min: 3, max: 14 },
];

function TargetsPanel() {
  const targetsQ = useTargets();
  const profileQ = useProfile();
  const { insert, update, remove } = useTableMutations("nutrition_targets");
  const current = targetFor(targetsQ.data, todayStr());
  const [f, setF] = useState<TF | null>(null);
  const [note, setNote] = useState("");
  const [from, setFrom] = useState(todayStr());
  const [asNew, setAsNew] = useState(false);
  useEffect(() => {
    if (current) {
      setF(
        Object.fromEntries(
          TF_FIELDS.map(({ k }) => [
            k,
            strOf(current[k as keyof NutritionTarget] as number | null),
          ]),
        ) as TF,
      );
      setNote(current.professional_guidance_note ?? "");
    } else if (targetsQ.isFetched)
      setF(Object.fromEntries(TF_FIELDS.map(({ k }) => [k, ""])) as TF);
  }, [current?.id, targetsQ.isFetched]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!f) return;
    const row: Record<string, unknown> = { professional_guidance_note: note.trim() || null };
    for (const x of TF_FIELDS) {
      const n = parseOptNum(f[x.k], { min: x.min, max: x.max, int: x.int });
      if (n === undefined) return toast.error(`${x.label} must be ${x.min}–${x.max}`);
      row[x.k] = n;
    }
    for (const [a, z] of [
      ["kcal_min", "kcal_max"],
      ["protein_min_g", "protein_max_g"],
      ["carbs_min_g", "carbs_max_g"],
      ["fat_min_g", "fat_max_g"],
      ["fibre_min_g", "fibre_max_g"],
      ["water_min_ml", "water_max_ml"],
    ]) {
      if (row[a] !== null && row[z] !== null && (row[a] as number) > (row[z] as number))
        return toast.error("A minimum is larger than its maximum");
    }
    const warn = profileQ.data?.low_calorie_warning_kcal ?? 1600;
    if (row.kcal_min !== null && (row.kcal_min as number) < warn && !note.trim()) {
      return toast.error(
        `A calorie minimum below ${warn} kcal needs a note confirming it was set with professional guidance`,
      );
    }
    try {
      if (current && !asNew) await update.mutateAsync({ id: current.id, patch: row });
      else await insert.mutateAsync({ ...row, effective_from: from });
      toast.success("Targets saved");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Panel
      title="Nutrition & daily targets"
      description="Targets are effective-dated so past days are judged against the targets that applied then. Exercise calories are never added to the food target."
      action={
        <Button size="sm" onClick={save}>
          <Save className="mr-1 h-4 w-4" /> Save
        </Button>
      }
    >
      {!f ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TF_FIELDS.map((x) => (
              <Field key={x.k} label={x.label} id={`t-${x.k}`}>
                <NumInput
                  id={`t-${x.k}`}
                  value={f[x.k]}
                  onChange={(val) => setF({ ...f, [x.k]: val })}
                  placeholder="—"
                />
              </Field>
            ))}
          </div>
          <Field
            label="Professional guidance note"
            id="t-note"
            className="mt-3"
            hint="Required for very low calorie minimums. E.g. who approved the target and when."
          >
            <Textarea id="t-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Toggle
              id="t-new"
              checked={asNew || !current}
              onChange={setAsNew}
              label="Save as a new target period"
            />
            {(asNew || !current) && (
              <Field label="Effective from" id="t-from">
                <Input
                  id="t-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </Field>
            )}
          </div>
          {current && (
            <p className="mt-2 text-xs text-muted-foreground">
              Currently editing the period effective from {fmtDate(current.effective_from)}.
            </p>
          )}
          {(targetsQ.data?.length ?? 0) > 1 && (
            <div className="mt-3 divide-y text-sm">
              {targetsQ.data!.map((t) => (
                <div key={t.id} className="flex items-center gap-2 py-1">
                  <span className="w-32">{fmtDate(t.effective_from)}</span>
                  <span className="flex-1 text-xs text-muted-foreground">
                    {t.kcal_min}–{t.kcal_max} kcal · {t.protein_min_g}–{t.protein_max_g} g protein
                  </span>
                  <ConfirmDelete what="target period" onConfirm={() => remove.mutateAsync(t.id)} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

const REMINDER_TYPES = [
  "weight",
  "food",
  "water",
  "workout",
  "measurements",
  "photo",
  "sleep",
  "steps",
  "custom",
];

function RemindersPanel() {
  const listQ = useList<Reminder>("reminders", { order: "time_of_day" });
  const { insert, update, remove } = useTableMutations("reminders");
  const [type, setType] = useState("weight");
  const [title, setTitle] = useState("Log morning weight");
  const [time, setTime] = useState("07:30");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const add = async () => {
    if (!title.trim()) return toast.error("Give the reminder a title");
    if (!days.length) return toast.error("Choose at least one day");
    await insert.mutateAsync({
      reminder_type: type,
      title: title.trim(),
      time_of_day: time,
      days_of_week: days,
      enabled: true,
    });
    toast.success("Reminder added");
  };
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" /> Reminders
        </span>
      }
      description="Shown on your dashboard once their time has passed, until the matching record is logged that day. (Push notifications are not configured.)"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Type" id="r-type">
          <NativeSelect
            id="r-type"
            value={type}
            onChange={setType}
            options={REMINDER_TYPES.map((t) => ({
              value: t,
              label: t[0].toUpperCase() + t.slice(1),
            }))}
          />
        </Field>
        <Field label="Title" id="r-title" className="sm:col-span-2">
          <Input id="r-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Time" id="r-time">
          <Input id="r-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() =>
              setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort())
            }
            className={`rounded-md border px-2 py-1 text-xs ${days.includes(d) ? "border-primary bg-primary text-primary-foreground" : ""}`}
          >
            {WEEKDAYS[d].slice(0, 3)}
          </button>
        ))}
        <Button size="sm" className="ml-auto" onClick={add}>
          <Plus className="mr-1 h-4 w-4" /> Add reminder
        </Button>
      </div>
      <div className="mt-3 divide-y text-sm">
        {(listQ.data ?? []).map((r) => (
          <div key={r.id} className="flex items-center gap-2 py-1.5">
            <Toggle
              id={`rem-${r.id}`}
              checked={r.enabled}
              onChange={(v) => update.mutate({ id: r.id, patch: { enabled: v } })}
              label={<span className="tabular-nums">{r.time_of_day.slice(0, 5)}</span>}
            />
            <span className="flex-1">{r.title}</span>
            <span className="text-xs text-muted-foreground">
              {r.days_of_week.length === 7
                ? "Daily"
                : r.days_of_week.map((d) => WEEKDAYS[d].slice(0, 2)).join(" ")}
            </span>
            <ConfirmDelete what="reminder" onConfirm={() => remove.mutateAsync(r.id)} />
          </div>
        ))}
      </div>
    </Panel>
  );
}
