import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Play, Plus } from "lucide-react";
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
  KindBadge,
  NativeSelect,
  NumInput,
  PageHeader,
  Panel,
  Toggle,
  parseOptNum,
  strOf,
} from "@/components/pp/ui";
import { progressionAdvice } from "@/lib/pp/calc";
import { WEEKDAYS, fmtDate, isoWeekday, todayStr } from "@/lib/pp/dates";
import { db, errMsg, qk, useList, useTableMutations } from "@/lib/pp/db";
import { titleCase, type Exercise, type PlanExercise, type WorkoutPlan } from "@/lib/pp/types";
import { lastPerformances, startSession } from "@/lib/pp/workouts";

export const Route = createFileRoute("/fitness/planner")({
  component: PlannerPage,
});

type PEForm = {
  exercise_id: string;
  target_sets: string;
  rmin: string;
  rmax: string;
  secs: string;
  weight: string;
  rest: string;
  inc: string;
  notes: string;
};

function PlannerPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const plansQ = useList<WorkoutPlan>("workout_plans", { order: "sort_order" });
  const peQ = useList<PlanExercise>("workout_plan_exercises", { order: "sort_order" });
  const exQ = useList<Exercise>("exercise_library", { order: "name" });
  const planMut = useTableMutations("workout_plans");
  const peMut = useTableMutations("workout_plan_exercises");
  const exIds = [...new Set((peQ.data ?? []).map((p) => p.exercise_id))];
  const lastQ = useQuery({
    queryKey: qk("workout_exercises", "last", exIds.join(",")),
    queryFn: () => lastPerformances(exIds),
    enabled: exIds.length > 0,
  });
  const exById = new Map((exQ.data ?? []).map((e) => [e.id, e]));

  const [planDlg, setPlanDlg] = useState<{
    open: boolean;
    edit: WorkoutPlan | null;
    name: string;
    day: string;
    focus: string;
    rest: boolean;
    notes: string;
  }>({
    open: false,
    edit: null,
    name: "",
    day: "",
    focus: "",
    rest: false,
    notes: "",
  });
  const [peDlg, setPeDlg] = useState<{
    open: boolean;
    planId: string;
    edit: PlanExercise | null;
    f: PEForm;
  }>({
    open: false,
    planId: "",
    edit: null,
    f: {
      exercise_id: "",
      target_sets: "3",
      rmin: "8",
      rmax: "12",
      secs: "",
      weight: "",
      rest: "90",
      inc: "2.5",
      notes: "",
    },
  });
  const today = todayStr();
  const plans = [...(plansQ.data ?? [])].sort(
    (a, b) => (a.day_of_week ?? 99) - (b.day_of_week ?? 99) || a.sort_order - b.sort_order,
  );

  const start = async (p: WorkoutPlan) => {
    try {
      const id = await startSession({ date: today, plan: p });
      await qc.invalidateQueries({ queryKey: ["pp"] });
      navigate({ to: "/fitness/workouts/$id", params: { id } });
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const savePlan = async () => {
    const d = planDlg;
    if (!d.name.trim()) return toast.error("Name the workout");
    const row = {
      name: d.name.trim(),
      day_of_week: d.day ? Number(d.day) : null,
      focus: d.focus.trim() || null,
      is_rest_day: d.rest,
      notes: d.notes.trim() || null,
    };
    if (d.edit) await planMut.update.mutateAsync({ id: d.edit.id, patch: row });
    else await planMut.insert.mutateAsync({ ...row, sort_order: plans.length + 1 });
    setPlanDlg({ ...d, open: false });
  };

  const openPe = (planId: string, edit: PlanExercise | null) =>
    setPeDlg({
      open: true,
      planId,
      edit,
      f: edit
        ? {
            exercise_id: edit.exercise_id,
            target_sets: String(edit.target_sets),
            rmin: strOf(edit.target_reps_min),
            rmax: strOf(edit.target_reps_max),
            secs: strOf(edit.target_duration_seconds),
            weight: strOf(edit.suggested_weight_kg),
            rest: strOf(edit.rest_seconds),
            inc: strOf(edit.progression_increment_kg),
            notes: edit.training_notes ?? "",
          }
        : {
            exercise_id: "",
            target_sets: "3",
            rmin: "8",
            rmax: "12",
            secs: "",
            weight: "",
            rest: "90",
            inc: "2.5",
            notes: "",
          },
    });

  const savePe = async () => {
    const f = peDlg.f;
    const sets = parseOptNum(f.target_sets, { min: 1, max: 20, int: true });
    const rmin = parseOptNum(f.rmin, { min: 1, max: 100, int: true });
    const rmax = parseOptNum(f.rmax, { min: 1, max: 100, int: true });
    const secs = parseOptNum(f.secs, { min: 1, max: 3600, int: true });
    const w = parseOptNum(f.weight, { min: 0, max: 1000 });
    const rest = parseOptNum(f.rest, { min: 0, max: 900, int: true });
    const inc = parseOptNum(f.inc, { min: 0, max: 20 });
    if (!f.exercise_id) return toast.error("Choose an exercise");
    if (
      !sets ||
      rmin === undefined ||
      rmax === undefined ||
      secs === undefined ||
      w === undefined ||
      rest === undefined ||
      inc === undefined
    )
      return toast.error("Check the numbers");
    if (rmin !== null && rmax !== null && rmin > rmax)
      return toast.error("Min reps cannot exceed max reps");
    const row = {
      exercise_id: f.exercise_id,
      target_sets: sets,
      target_reps_min: rmin,
      target_reps_max: rmax,
      target_duration_seconds: secs,
      suggested_weight_kg: w,
      rest_seconds: rest,
      progression_increment_kg: inc ?? 0,
      training_notes: f.notes.trim() || null,
    };
    if (peDlg.edit) await peMut.update.mutateAsync({ id: peDlg.edit.id, patch: row });
    else {
      const count = (peQ.data ?? []).filter((p) => p.plan_id === peDlg.planId).length;
      await peMut.insert.mutateAsync({ ...row, plan_id: peDlg.planId, sort_order: count + 1 });
    }
    setPeDlg({ ...peDlg, open: false });
  };

  const move = async (items: PlanExercise[], idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const a = items[idx];
    const b = items[j];
    try {
      await Promise.all([
        db.from("workout_plan_exercises").update({ sort_order: b.sort_order }).eq("id", a.id),
        db
          .from("workout_plan_exercises")
          .update({ sort_order: a.sort_order === b.sort_order ? a.sort_order + dir : a.sort_order })
          .eq("id", b.id),
      ]);
      peMut.invalidate();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div>
      <PageHeader
        title="Workout Planner"
        description="Planned workouts are targets. What you actually lift is recorded separately in each session — nothing here assumes you can lift a given weight."
        actions={
          <Button
            size="sm"
            onClick={() =>
              setPlanDlg({
                open: true,
                edit: null,
                name: "",
                day: "",
                focus: "",
                rest: false,
                notes: "",
              })
            }
          >
            <Plus className="mr-1 h-4 w-4" /> New workout
          </Button>
        }
      />
      {plans.length === 0 && <EmptyHint>No plans yet.</EmptyHint>}
      <div className="space-y-4">
        {plans.map((p) => {
          const items = (peQ.data ?? [])
            .filter((x) => x.plan_id === p.id)
            .sort((a, b) => a.sort_order - b.sort_order);
          const isToday = p.day_of_week === isoWeekday(today);
          return (
            <Panel
              key={p.id}
              className={isToday ? "border-primary/60" : ""}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                    {p.day_of_week ? WEEKDAYS[p.day_of_week] : "Any day"}
                  </span>
                  <span className="text-base">{p.name}</span>
                  {isToday && (
                    <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">
                      Today
                    </span>
                  )}
                  <KindBadge kind="planned" />
                </span>
              }
              description={[p.focus, p.notes].filter(Boolean).join(" — ")}
              action={
                <div className="flex gap-1">
                  {!p.is_rest_day && (
                    <Button size="sm" onClick={() => start(p)}>
                      <Play className="mr-1 h-4 w-4" /> Start
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Edit workout"
                    onClick={() =>
                      setPlanDlg({
                        open: true,
                        edit: p,
                        name: p.name,
                        day: p.day_of_week ? String(p.day_of_week) : "",
                        focus: p.focus ?? "",
                        rest: p.is_rest_day,
                        notes: p.notes ?? "",
                      })
                    }
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <ConfirmDelete
                    what={`workout "${p.name}"`}
                    onConfirm={() => planMut.remove.mutateAsync(p.id)}
                  />
                </div>
              }
            >
              {p.is_rest_day ? (
                <p className="text-sm text-muted-foreground">Rest day.</p>
              ) : (
                <div className="divide-y">
                  {items.map((it, i) => {
                    const ex = exById.get(it.exercise_id);
                    const last = lastQ.data?.get(it.exercise_id);
                    const advice = ex
                      ? progressionAdvice({
                          measurementType: ex.measurement_type,
                          targetSets: it.target_sets,
                          repsMin: it.target_reps_min,
                          repsMax: it.target_reps_max,
                          incrementKg: Number(it.progression_increment_kg),
                          last: last
                            ? {
                                sets: last.workout_sets,
                                pain: last.pain_reported,
                                form: last.form_quality,
                                difficulty: last.difficulty_rating,
                              }
                            : null,
                        })
                      : null;
                    return (
                      <div key={it.id} className="flex flex-wrap items-start gap-2 py-2.5">
                        <div className="flex flex-col">
                          <button
                            type="button"
                            aria-label="Move up"
                            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                            disabled={i === 0}
                            onClick={() => move(items, i, -1)}
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Move down"
                            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                            disabled={i === items.length - 1}
                            onClick={() => move(items, i, 1)}
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">
                            {ex?.name ?? "?"}{" "}
                            <span className="font-normal text-muted-foreground">
                              {it.target_sets} ×{" "}
                              {it.target_duration_seconds
                                ? `${it.target_duration_seconds}s`
                                : it.target_reps_min &&
                                    it.target_reps_max &&
                                    it.target_reps_min !== it.target_reps_max
                                  ? `${it.target_reps_min}–${it.target_reps_max}`
                                  : (it.target_reps_max ?? it.target_reps_min ?? "?")}
                              {it.rest_seconds ? ` · rest ${it.rest_seconds}s` : ""}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Suggested weight:{" "}
                            {it.suggested_weight_kg !== null
                              ? `${Number(it.suggested_weight_kg)} kg`
                              : "— to be assessed"}
                            {it.training_notes ? ` · ${it.training_notes}` : ""}
                          </div>
                          {last && (
                            <div className="text-xs text-muted-foreground">
                              Last ({fmtDate(last.workout_sessions.session_date, "d MMM")}):{" "}
                              {last.workout_sets
                                .filter((s) => !s.is_warmup)
                                .map((s) =>
                                  s.duration_seconds
                                    ? `${s.duration_seconds}s`
                                    : `${s.weight_kg !== null ? Number(s.weight_kg) + "×" : ""}${s.reps}`,
                                )
                                .join(", ")}
                            </div>
                          )}
                          {advice && (
                            <div
                              className={`mt-0.5 text-xs ${advice.kind === "increase" ? "text-[var(--pp-good)]" : advice.kind.startsWith("hold_p") || advice.kind === "hold_form" ? "text-destructive" : "text-muted-foreground"}`}
                            >
                              {advice.message}
                              {advice.kind === "increase" &&
                                Number(it.suggested_weight_kg) !== advice.nextWeight && (
                                  <button
                                    type="button"
                                    className="ml-2 underline"
                                    onClick={() =>
                                      peMut.update.mutate({
                                        id: it.id,
                                        patch: { suggested_weight_kg: advice.nextWeight },
                                      })
                                    }
                                  >
                                    Set {advice.nextWeight} kg as next suggestion
                                  </button>
                                )}
                              {(advice.kind === "hold_reps" || advice.kind === "hold_effort") &&
                                "referenceWeight" in advice &&
                                advice.referenceWeight &&
                                Number(it.suggested_weight_kg) !== advice.referenceWeight && (
                                  <button
                                    type="button"
                                    className="ml-2 underline"
                                    onClick={() =>
                                      peMut.update.mutate({
                                        id: it.id,
                                        patch: { suggested_weight_kg: advice.referenceWeight },
                                      })
                                    }
                                  >
                                    Use {advice.referenceWeight} kg as reference
                                  </button>
                                )}
                            </div>
                          )}
                        </div>
                        <div className="flex">
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Edit exercise"
                            onClick={() => openPe(p.id, it)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <ConfirmDelete
                            what={ex?.name ?? "exercise"}
                            onConfirm={() => peMut.remove.mutateAsync(it.id)}
                          />
                        </div>
                      </div>
                    );
                  })}
                  <div className="pt-2">
                    <Button size="sm" variant="outline" onClick={() => openPe(p.id, null)}>
                      <Plus className="mr-1 h-4 w-4" /> Add exercise
                    </Button>
                  </div>
                </div>
              )}
            </Panel>
          );
        })}
      </div>

      <Dialog open={planDlg.open} onOpenChange={(o) => setPlanDlg({ ...planDlg, open: o })}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{planDlg.edit ? "Edit workout" : "New workout"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" id="pl-name" className="col-span-2">
              <Input
                id="pl-name"
                value={planDlg.name}
                onChange={(e) => setPlanDlg({ ...planDlg, name: e.target.value })}
              />
            </Field>
            <Field label="Day" id="pl-day">
              <NativeSelect
                id="pl-day"
                value={planDlg.day}
                onChange={(v) => setPlanDlg({ ...planDlg, day: v })}
                placeholder="Any day"
                options={[1, 2, 3, 4, 5, 6, 7].map((d) => ({
                  value: String(d),
                  label: WEEKDAYS[d],
                }))}
              />
            </Field>
            <Field label="Focus" id="pl-focus">
              <Input
                id="pl-focus"
                value={planDlg.focus}
                onChange={(e) => setPlanDlg({ ...planDlg, focus: e.target.value })}
              />
            </Field>
            <div className="col-span-2">
              <Toggle
                id="pl-rest"
                checked={planDlg.rest}
                onChange={(v) => setPlanDlg({ ...planDlg, rest: v })}
                label="Rest day"
              />
            </div>
            <Field label="Notes" id="pl-notes" className="col-span-2">
              <Textarea
                id="pl-notes"
                rows={2}
                value={planDlg.notes}
                onChange={(e) => setPlanDlg({ ...planDlg, notes: e.target.value })}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={savePlan}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={peDlg.open} onOpenChange={(o) => setPeDlg({ ...peDlg, open: o })}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {peDlg.edit ? "Edit planned exercise" : "Add exercise to plan"}
            </DialogTitle>
            <DialogDescription>
              Leave suggested weight blank until you've assessed a weight you can control with good
              form.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Exercise" id="pe-ex" className="col-span-3">
              <NativeSelect
                id="pe-ex"
                value={peDlg.f.exercise_id}
                placeholder="Choose…"
                onChange={(v) => setPeDlg({ ...peDlg, f: { ...peDlg.f, exercise_id: v } })}
                options={(exQ.data ?? [])
                  .filter((e) => !e.archived)
                  .map((e) => ({ value: e.id, label: `${e.name} (${titleCase(e.muscle_group)})` }))}
              />
            </Field>
            {(
              [
                ["target_sets", "Sets"],
                ["rmin", "Min reps"],
                ["rmax", "Max reps"],
                ["secs", "Hold (s)"],
                ["weight", "Suggested kg"],
                ["rest", "Rest (s)"],
                ["inc", "Increment kg"],
              ] as const
            ).map(([k, l]) => (
              <Field key={k} label={l} id={`pe-${k}`}>
                <NumInput
                  id={`pe-${k}`}
                  value={peDlg.f[k]}
                  onChange={(v) => setPeDlg({ ...peDlg, f: { ...peDlg.f, [k]: v } })}
                  placeholder={k === "weight" ? "assess" : ""}
                />
              </Field>
            ))}
            <Field label="Instructions / notes" id="pe-notes" className="col-span-3">
              <Textarea
                id="pe-notes"
                rows={2}
                value={peDlg.f.notes}
                onChange={(e) => setPeDlg({ ...peDlg, f: { ...peDlg.f, notes: e.target.value } })}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={savePe}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
