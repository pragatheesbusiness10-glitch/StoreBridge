import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Archive, Pencil, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StrengthChart, useExerciseHistory } from "@/components/pp/strength-chart";
import {
  ConfirmDelete,
  EmptyHint,
  Field,
  KindBadge,
  MetricCard,
  NativeSelect,
  PageHeader,
  Panel,
  Toggle,
  fmtNum,
} from "@/components/pp/ui";
import { bestE1RM, exerciseTotals } from "@/lib/pp/calc";
import { addDaysStr, fmtDate, todayStr } from "@/lib/pp/dates";
import { useList, useRange, useTableMutations } from "@/lib/pp/db";
import {
  EXERCISE_CATEGORIES,
  MUSCLE_GROUPS,
  titleCase,
  type Exercise,
  type MeasurementType,
  type WorkoutExercise,
  type WorkoutSession,
} from "@/lib/pp/types";

export const Route = createFileRoute("/fitness/exercises")({
  component: ExercisesPage,
});

const MT_OPTIONS: { value: MeasurementType; label: string }[] = [
  { value: "weight_reps", label: "Weight × reps" },
  { value: "bodyweight_reps", label: "Bodyweight reps" },
  { value: "assisted_reps", label: "Assisted reps (assistance in kg)" },
  { value: "time", label: "Time (seconds)" },
];

function ExercisesPage() {
  const exQ = useList<Exercise>("exercise_library", { order: "name" });
  const { insert, update, remove } = useTableMutations("exercise_library");
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [dlg, setDlg] = useState<{ open: boolean; edit: Exercise | null }>({
    open: false,
    edit: null,
  });
  const [form, setForm] = useState({
    name: "",
    muscle_group: "chest",
    category: "compound",
    equipment: "",
    measurement_type: "weight_reps" as MeasurementType,
    instructions: "",
  });

  // Muscle-group training frequency over the last 28 days (sessions in which the group was trained with ≥ 1 set)
  const today = todayStr();
  const freqQ = useRange<
    WorkoutSession & { workout_exercises: (WorkoutExercise & { workout_sets: { id: string }[] })[] }
  >("workout_sessions", "session_date", addDaysStr(today, -27), today, {
    select:
      "id, session_date, status, workout_exercises(muscle_group, exercise_id, workout_sets(id))",
  });
  const freq = useMemo(() => {
    const groups = new Map<string, Set<string>>();
    const perEx = new Map<string, number>();
    for (const s of freqQ.data ?? []) {
      if (s.status === "skipped") continue;
      for (const e of s.workout_exercises) {
        if (!e.workout_sets.length) continue;
        const g = e.muscle_group ?? "other";
        groups.set(g, (groups.get(g) ?? new Set()).add(s.session_date));
        if (e.exercise_id) perEx.set(e.exercise_id, (perEx.get(e.exercise_id) ?? 0) + 1);
      }
    }
    return {
      groups: [...groups.entries()]
        .map(([g, d]) => ({ g, days: d.size }))
        .sort((a, b) => b.days - a.days),
      perEx,
    };
  }, [freqQ.data]);

  const list = (exQ.data ?? [])
    .filter((e) => showArchived || !e.archived)
    .filter((e) => !group || e.muscle_group === group)
    .filter((e) => !search || e.name.toLowerCase().includes(search.toLowerCase()));
  const grouped = MUSCLE_GROUPS.map((g) => ({
    g,
    items: list.filter((e) => e.muscle_group === g),
  })).filter((x) => x.items.length);
  const sel = (exQ.data ?? []).find((e) => e.id === selected) ?? null;

  const openNew = () => {
    setForm({
      name: "",
      muscle_group: "chest",
      category: "compound",
      equipment: "",
      measurement_type: "weight_reps",
      instructions: "",
    });
    setDlg({ open: true, edit: null });
  };
  const openEdit = (e: Exercise) => {
    setForm({
      name: e.name,
      muscle_group: e.muscle_group,
      category: e.category,
      equipment: e.equipment ?? "",
      measurement_type: e.measurement_type,
      instructions: e.instructions ?? "",
    });
    setDlg({ open: true, edit: e });
  };
  const save = async () => {
    if (!form.name.trim()) return toast.error("Name is required");
    const row = {
      ...form,
      name: form.name.trim(),
      equipment: form.equipment.trim() || null,
      instructions: form.instructions.trim() || null,
    };
    if (dlg.edit) await update.mutateAsync({ id: dlg.edit.id, patch: row });
    else await insert.mutateAsync({ ...row, is_custom: true });
    toast.success("Exercise saved");
    setDlg({ open: false, edit: null });
  };

  return (
    <div>
      <PageHeader
        title="Exercise Library"
        description="Built-in and custom exercises. Select one to see its history, personal records and progression."
        actions={
          <Button size="sm" onClick={openNew}>
            <Plus className="mr-1 h-4 w-4" /> Custom exercise
          </Button>
        }
      />
      <Panel
        className="mb-4"
        title="Muscle group frequency"
        description="Training days per muscle group, last 28 days"
      >
        {freq.groups.length ? (
          <div className="flex flex-wrap gap-2">
            {freq.groups.map((x) => (
              <span key={x.g} className="rounded-full bg-muted px-2.5 py-1 text-xs">
                {titleCase(x.g)} <b className="tabular-nums">{x.days}×</b>{" "}
                <span className="text-muted-foreground">({fmtNum(x.days / 4, 1)}/wk)</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No sets recorded in the last 28 days.</p>
        )}
      </Panel>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-40">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search…"
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <NativeSelect
              className="w-auto"
              value={group}
              onChange={setGroup}
              placeholder="All groups"
              options={MUSCLE_GROUPS.map((g) => ({ value: g, label: titleCase(g) }))}
            />
            <Toggle
              id="ex-arch"
              checked={showArchived}
              onChange={setShowArchived}
              label={<span className="text-xs">Archived</span>}
            />
          </div>
          {grouped.map(({ g, items }) => (
            <div key={g}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {titleCase(g)}
              </div>
              <div className="divide-y rounded-lg border bg-card">
                {items.map((e) => (
                  <button
                    type="button"
                    key={e.id}
                    onClick={() => setSelected(e.id)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted ${selected === e.id ? "bg-accent" : ""} ${e.archived ? "opacity-50" : ""}`}
                  >
                    <span className="flex-1">{e.name}</span>
                    {e.is_custom && <KindBadge kind="entered" />}
                    {freq.perEx.get(e.id) ? (
                      <span className="text-[11px] text-muted-foreground">
                        {freq.perEx.get(e.id)}× / 28d
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="lg:col-span-3">
          {sel ? (
            <ExerciseDetail
              ex={sel}
              onEdit={() => openEdit(sel)}
              onArchive={() => update.mutate({ id: sel.id, patch: { archived: !sel.archived } })}
              onDelete={async () => {
                await remove.mutateAsync(sel.id);
                setSelected(null);
              }}
            />
          ) : (
            <EmptyHint>
              Select an exercise to see instructions, history and personal records.
            </EmptyHint>
          )}
        </div>
      </div>
      <Dialog open={dlg.open} onOpenChange={(o) => setDlg({ ...dlg, open: o })}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{dlg.edit ? "Edit exercise" : "Custom exercise"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" id="e-name" className="col-span-2">
              <Input
                id="e-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Muscle group" id="e-mg">
              <NativeSelect
                id="e-mg"
                value={form.muscle_group}
                onChange={(v) => setForm({ ...form, muscle_group: v })}
                options={MUSCLE_GROUPS.map((g) => ({ value: g, label: titleCase(g) }))}
              />
            </Field>
            <Field label="Category" id="e-cat">
              <NativeSelect
                id="e-cat"
                value={form.category}
                onChange={(v) => setForm({ ...form, category: v })}
                options={EXERCISE_CATEGORIES.map((g) => ({ value: g, label: titleCase(g) }))}
              />
            </Field>
            <Field label="Equipment" id="e-eq">
              <Input
                id="e-eq"
                value={form.equipment}
                onChange={(e) => setForm({ ...form, equipment: e.target.value })}
              />
            </Field>
            <Field label="Recorded as" id="e-mt">
              <NativeSelect
                id="e-mt"
                value={form.measurement_type}
                onChange={(v) => setForm({ ...form, measurement_type: v as MeasurementType })}
                options={MT_OPTIONS}
              />
            </Field>
            <Field label="Instructions" id="e-ins" className="col-span-2">
              <Textarea
                id="e-ins"
                rows={3}
                value={form.instructions}
                onChange={(e) => setForm({ ...form, instructions: e.target.value })}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ExerciseDetail({
  ex,
  onEdit,
  onArchive,
  onDelete,
}: {
  ex: Exercise;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => Promise<void>;
}) {
  const hQ = useExerciseHistory(ex.id);
  const rows = (hQ.data ?? []).map((h) => {
    const t = exerciseTotals(h.workout_sets, h.measurement_type);
    return { h, t, e1rm: bestE1RM(h.workout_sets, h.measurement_type) };
  });
  const loaded = ex.measurement_type === "weight_reps";
  const prWeight = loaded
    ? rows.reduce<{ v: number; date: string; reps: number } | null>((best, r) => {
        for (const s of r.h.workout_sets.filter((x) => !x.is_warmup)) {
          const w = Number(s.weight_kg) || 0;
          if (!best || w > best.v)
            best = { v: w, date: r.h.workout_sessions.session_date, reps: Number(s.reps) || 0 };
        }
        return best;
      }, null)
    : null;
  const prE1 = rows.reduce<{ v: number; date: string } | null>(
    (b, r) =>
      r.e1rm !== null && (!b || r.e1rm > b.v)
        ? { v: r.e1rm, date: r.h.workout_sessions.session_date }
        : b,
    null,
  );
  const prVol = rows.reduce<{ v: number; date: string } | null>(
    (b, r) =>
      r.t.volume > 0 && (!b || r.t.volume > b.v)
        ? { v: r.t.volume, date: r.h.workout_sessions.session_date }
        : b,
    null,
  );
  const prReps = rows.reduce<{ v: number; date: string } | null>((b, r) => {
    const m = Math.max(
      0,
      ...r.h.workout_sets.filter((s) => !s.is_warmup).map((s) => Number(s.reps) || 0),
    );
    return m > 0 && (!b || m > b.v) ? { v: m, date: r.h.workout_sessions.session_date } : b;
  }, null);
  const prTime = rows.reduce<{ v: number; date: string } | null>((b, r) => {
    const m = Math.max(0, ...r.h.workout_sets.map((s) => Number(s.duration_seconds) || 0));
    return m > 0 && (!b || m > b.v) ? { v: m, date: r.h.workout_sessions.session_date } : b;
  }, null);

  return (
    <div className="space-y-3">
      <Panel
        title={ex.name}
        description={`${titleCase(ex.muscle_group)} · ${titleCase(ex.category)}${ex.equipment ? ` · ${ex.equipment}` : ""} · ${MT_OPTIONS.find((m) => m.value === ex.measurement_type)?.label}`}
        action={
          <div className="flex">
            <Button size="icon" variant="ghost" aria-label="Edit" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Archive"
              title={ex.archived ? "Unarchive" : "Archive"}
              onClick={onArchive}
            >
              <Archive className="h-4 w-4" />
            </Button>
            <ConfirmDelete what={ex.name} onConfirm={onDelete} />
          </div>
        }
      >
        {ex.instructions && <p className="text-sm text-muted-foreground">{ex.instructions}</p>}
      </Panel>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {loaded ? (
          <>
            <MetricCard
              label="Heaviest set"
              value={prWeight ? fmtNum(prWeight.v) : null}
              unit="kg"
              kind="measured"
              sub={
                prWeight ? `${prWeight.reps} reps · ${fmtDate(prWeight.date, "d MMM")}` : undefined
              }
            />
            <MetricCard
              label="Best est. 1RM"
              value={prE1 ? fmtNum(prE1.v) : null}
              unit="kg"
              kind="estimated"
              sub={prE1 ? `Epley · ${fmtDate(prE1.date, "d MMM")}` : "Needs 1–12 rep sets"}
            />
            <MetricCard
              label="Best session volume"
              value={prVol ? fmtNum(prVol.v, 0) : null}
              unit="kg"
              kind="calculated"
              sub={prVol ? fmtDate(prVol.date, "d MMM") : undefined}
            />
          </>
        ) : ex.measurement_type === "time" ? (
          <MetricCard
            label="Longest hold"
            value={prTime ? prTime.v : null}
            unit="s"
            kind="measured"
            sub={prTime ? fmtDate(prTime.date, "d MMM") : undefined}
          />
        ) : (
          <MetricCard
            label="Most reps in a set"
            value={prReps ? prReps.v : null}
            kind="measured"
            sub={prReps ? fmtDate(prReps.date, "d MMM") : undefined}
          />
        )}
        <MetricCard label="Times performed" value={rows.length} kind="calculated" />
      </div>
      {loaded && (
        <Panel title="Progression">
          <StrengthChart initialExerciseId={ex.id} key={ex.id} />
        </Panel>
      )}
      <Panel title="History">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not performed yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="text-left">Date</th>
                  <th className="text-left">Sets (weight × reps)</th>
                  <th className="text-right">Sets</th>
                  <th className="text-right">Reps</th>
                  {loaded && <th className="text-right">Volume</th>}
                  {loaded && <th className="text-right">e1RM*</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ h, t, e1rm }) => (
                  <tr key={h.id} className="border-t align-top">
                    <td className="py-1 pr-2 whitespace-nowrap">
                      {fmtDate(h.workout_sessions.session_date, "d MMM yy")}
                    </td>
                    <td className="py-1 text-xs">
                      {h.workout_sets
                        .map(
                          (s) =>
                            `${s.is_warmup ? "W " : ""}${s.weight_kg !== null ? `${Number(s.weight_kg)}kg` : ""}${s.reps !== null ? `×${s.reps}` : ""}${s.duration_seconds ? ` ${s.duration_seconds}s` : ""}`,
                        )
                        .join(", ")}
                      {(h.pain_reported || h.form_quality === "poor") && (
                        <span className="ml-1 text-destructive">
                          {h.pain_reported ? "· pain" : "· poor form"}
                        </span>
                      )}
                    </td>
                    <td className="text-right">{t.sets}</td>
                    <td className="text-right">{t.reps}</td>
                    {loaded && <td className="text-right">{fmtNum(t.volume, 0)}</td>}
                    {loaded && <td className="text-right">{e1rm ?? "—"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {loaded && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                *Estimated one-rep max (Epley formula) — an estimate, not a tested max.
              </p>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
