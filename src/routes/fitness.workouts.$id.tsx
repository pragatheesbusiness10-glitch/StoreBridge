import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Copy, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ConfirmDelete,
  Field,
  KindBadge,
  MetricCard,
  NativeSelect,
  NumInput,
  Panel,
  RatingPicker,
  Toggle,
  fmtNum,
  parseOptNum,
  strOf,
} from "@/components/pp/ui";
import { estimated1RM, exerciseTotals, progressionAdvice } from "@/lib/pp/calc";
import { sessionTotals, type SessionWithSets } from "@/lib/pp/daily";
import { fmtDate } from "@/lib/pp/dates";
import { db, errMsg, qk, unwrap, useList } from "@/lib/pp/db";
import {
  titleCase,
  type Exercise,
  type PlanExercise,
  type WorkoutExercise,
  type WorkoutSet,
} from "@/lib/pp/types";
import { copySets, lastPerformances, type HistoryRow } from "@/lib/pp/workouts";

export const Route = createFileRoute("/fitness/workouts/$id")({
  component: SessionPage,
});

type ExWithSets = WorkoutExercise & { workout_sets: WorkoutSet[] };

function SessionPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const sQ = useQuery({
    queryKey: qk("workout_sessions", "one", id),
    queryFn: () =>
      unwrap<SessionWithSets>(
        db
          .from("workout_sessions")
          .select("*, workout_exercises(*, workout_sets(*))")
          .eq("id", id)
          .single(),
      ),
  });
  const exLib = useList<Exercise>("exercise_library", {
    order: "name",
    filter: { archived: false },
  });
  const planEx = useList<PlanExercise>("workout_plan_exercises");
  const s = sQ.data;
  const exercises: ExWithSets[] = useMemo(
    () =>
      [...(s?.workout_exercises ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((e) => ({
          ...e,
          workout_sets: [...e.workout_sets].sort((a, b) => a.set_number - b.set_number),
        })),
    [s],
  );
  const exIds = exercises.map((e) => e.exercise_id).filter((x): x is string => !!x);
  const lastQ = useQuery({
    queryKey: qk("workout_exercises", "last", exIds.join(","), s?.session_date),
    enabled: !!s && exIds.length > 0,
    queryFn: () => lastPerformances(exIds, s!.session_date),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["pp"] });
  const [meta, setMeta] = useState({ name: "", date: "", duration: "", rpe: "", notes: "" });
  useEffect(() => {
    if (s)
      setMeta({
        name: s.name,
        date: s.session_date,
        duration: strOf(s.duration_minutes),
        rpe: strOf(s.overall_rpe),
        notes: s.notes ?? "",
      });
  }, [s]);
  const [addEx, setAddEx] = useState("");

  if (sQ.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!s) return <p className="text-sm text-destructive">Workout not found.</p>;

  const totals = sessionTotals(s);

  const saveMeta = async (patch: Record<string, unknown>) => {
    const { error } = await db.from("workout_sessions").update(patch).eq("id", s.id);
    if (error) toast.error(errMsg(error));
    else refresh();
  };

  const finish = async () => {
    const ended = new Date();
    const auto = s.started_at
      ? Math.round((ended.getTime() - new Date(s.started_at).getTime()) / 60000)
      : null;
    const manual = parseOptNum(meta.duration, { min: 0, max: 600, int: true });
    if (manual === undefined) return toast.error("Duration must be 0–600 minutes");
    const duration = manual ?? (auto !== null && auto <= 600 ? auto : null);
    await saveMeta({
      status: "completed",
      ended_at: ended.toISOString(),
      duration_minutes: duration,
    });
    toast.success(`Workout completed: ${totals.sets} sets · ${fmtNum(totals.volume, 0)} kg volume`);
  };

  const addExercise = async () => {
    const ex = exLib.data?.find((e) => e.id === addEx);
    if (!ex) return;
    const { error } = await db.from("workout_exercises").insert({
      session_id: s.id,
      exercise_id: ex.id,
      exercise_name: ex.name,
      muscle_group: ex.muscle_group,
      category: ex.category,
      equipment: ex.equipment,
      measurement_type: ex.measurement_type,
      sort_order: (exercises[exercises.length - 1]?.sort_order ?? 0) + 1,
    });
    if (error) return toast.error(errMsg(error));
    setAddEx("");
    refresh();
  };

  const moveEx = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= exercises.length) return;
    await Promise.all([
      db
        .from("workout_exercises")
        .update({ sort_order: j + 1 })
        .eq("id", exercises[i].id),
      db
        .from("workout_exercises")
        .update({ sort_order: i + 1 })
        .eq("id", exercises[j].id),
    ]);
    refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/fitness/workouts">
            <ArrowLeft className="mr-1 h-4 w-4" /> History
          </Link>
        </Button>
        <span
          className={`rounded px-2 py-0.5 text-xs uppercase ${s.status === "completed" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}
        >
          {s.status.replace("_", " ")}
        </span>
        <div className="ml-auto flex gap-2">
          {s.status !== "completed" ? (
            <Button size="sm" onClick={finish}>
              <Check className="mr-1 h-4 w-4" /> Finish workout
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => saveMeta({ status: "in_progress", ended_at: null })}
            >
              Reopen
            </Button>
          )}
          <ConfirmDelete
            what="this workout and all its sets"
            onConfirm={async () => {
              await db.from("workout_sessions").delete().eq("id", s.id);
              await refresh();
              navigate({ to: "/fitness/workouts" });
            }}
          />
        </div>
      </div>

      <Panel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Field label="Workout" id="s-name" className="col-span-2">
            <Input
              id="s-name"
              value={meta.name}
              onChange={(e) => setMeta({ ...meta, name: e.target.value })}
              onBlur={() =>
                meta.name.trim() && meta.name !== s.name && saveMeta({ name: meta.name.trim() })
              }
            />
          </Field>
          <Field label="Date" id="s-date">
            <Input
              id="s-date"
              type="date"
              value={meta.date}
              onChange={(e) =>
                e.target.value &&
                (setMeta({ ...meta, date: e.target.value }),
                saveMeta({ session_date: e.target.value }))
              }
            />
          </Field>
          <Field
            label="Duration (min)"
            id="s-dur"
            hint={s.status !== "completed" ? "Blank = timed automatically on finish" : undefined}
          >
            <NumInput
              id="s-dur"
              value={meta.duration}
              onChange={(v) => setMeta({ ...meta, duration: v })}
              placeholder={
                s.started_at
                  ? `started ${new Date(s.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : ""
              }
            />
          </Field>
          <Field label="Session RPE (1–10)" id="s-rpe">
            <NumInput id="s-rpe" value={meta.rpe} onChange={(v) => setMeta({ ...meta, rpe: v })} />
          </Field>
          <Field label="Notes" id="s-notes" className="col-span-2 sm:col-span-5">
            <Textarea
              id="s-notes"
              rows={1}
              value={meta.notes}
              onChange={(e) => setMeta({ ...meta, notes: e.target.value })}
            />
          </Field>
        </div>
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const d = parseOptNum(meta.duration, { min: 0, max: 600, int: true });
              const r = parseOptNum(meta.rpe, { min: 1, max: 10 });
              if (d === undefined || r === undefined)
                return toast.error("Duration 0–600 min, RPE 1–10");
              saveMeta({
                duration_minutes: d,
                overall_rpe: r,
                notes: meta.notes.trim() || null,
              }).then(() => toast.success("Saved"));
            }}
          >
            Save details
          </Button>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricCard label="Exercises" value={totals.exercises} kind="calculated" />
        <MetricCard label="Working sets" value={totals.sets} kind="calculated" />
        <MetricCard label="Reps" value={totals.reps} kind="calculated" />
        <MetricCard
          label="Volume"
          value={fmtNum(totals.volume, 0)}
          unit="kg"
          kind="calculated"
          sub="Σ weight × reps, working sets"
        />
      </div>

      {exercises.map((e, i) => (
        <ExerciseCard
          key={e.id}
          ex={e}
          index={i}
          count={exercises.length}
          plan={planEx.data?.find((p) => p.id === e.plan_exercise_id) ?? null}
          last={e.exercise_id ? (lastQ.data?.get(e.exercise_id) ?? null) : null}
          onMove={moveEx}
          refresh={refresh}
        />
      ))}

      <Panel title="Add exercise">
        <div className="flex gap-2">
          <NativeSelect
            className="flex-1"
            value={addEx}
            onChange={setAddEx}
            placeholder="Choose from library…"
            options={(exLib.data ?? []).map((x) => ({
              value: x.id,
              label: `${x.name} (${titleCase(x.muscle_group)})`,
            }))}
          />
          <Button onClick={addExercise} disabled={!addEx}>
            <Plus className="mr-1 h-4 w-4" /> Add
          </Button>
        </div>
      </Panel>
    </div>
  );
}

function ExerciseCard({
  ex,
  index,
  count,
  plan,
  last,
  onMove,
  refresh,
}: {
  ex: ExWithSets;
  index: number;
  count: number;
  plan: PlanExercise | null;
  last: HistoryRow | null;
  onMove: (i: number, d: -1 | 1) => void;
  refresh: () => void;
}) {
  const timed = ex.measurement_type === "time";
  const loaded = ex.measurement_type === "weight_reps" || ex.measurement_type === "assisted_reps";
  const sets = ex.workout_sets;
  const prev = sets[sets.length - 1];
  const [w, setW] = useState("");
  const [r, setR] = useState("");
  const [sec, setSec] = useState("");
  const [warm, setWarm] = useState(false);
  const [rpe, setRpe] = useState("");
  const [details, setDetails] = useState(false);
  const [notes, setNotes] = useState(ex.notes ?? "");
  const [rest, setRest] = useState(strOf(ex.rest_seconds));
  const [dur, setDur] = useState(strOf(ex.duration_minutes));
  useEffect(() => {
    // Pre-fill with the previous set of THIS session (fast repeat); never with assumed numbers.
    if (prev) {
      setW(strOf(prev.weight_kg));
      setR(strOf(prev.reps));
      setSec(strOf(prev.duration_seconds));
    }
  }, [prev?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = exerciseTotals(sets, ex.measurement_type);
  const advice = progressionAdvice({
    measurementType: ex.measurement_type,
    targetSets: plan?.target_sets ?? 3,
    repsMin: plan?.target_reps_min ?? null,
    repsMax: plan?.target_reps_max ?? null,
    incrementKg: Number(plan?.progression_increment_kg ?? 2.5),
    last: last
      ? {
          sets: last.workout_sets,
          pain: last.pain_reported,
          form: last.form_quality,
          difficulty: last.difficulty_rating,
        }
      : null,
  });

  const addSet = async () => {
    const weight = parseOptNum(w, { min: 0, max: 1000 });
    const reps = parseOptNum(r, { min: 0, max: 1000, int: true });
    const seconds = parseOptNum(sec, { min: 0, max: 7200, int: true });
    const setRpeV = parseOptNum(rpe, { min: 1, max: 10 });
    if (
      weight === undefined ||
      reps === undefined ||
      seconds === undefined ||
      setRpeV === undefined
    )
      return toast.error("Check the set values");
    if (timed ? seconds === null : reps === null)
      return toast.error(timed ? "Enter seconds held" : "Enter reps");
    if (ex.measurement_type === "weight_reps" && weight === null)
      return toast.error("Enter the weight lifted (0 for an empty bar or no load)");
    const { error } = await db.from("workout_sets").insert({
      workout_exercise_id: ex.id,
      set_number: (sets[sets.length - 1]?.set_number ?? 0) + 1,
      weight_kg: weight,
      reps,
      duration_seconds: seconds,
      is_warmup: warm,
      rpe: setRpeV,
    });
    if (error) return toast.error(errMsg(error));
    setRpe("");
    refresh();
  };

  const updateSet = async (id: string, patch: Partial<WorkoutSet>) => {
    const { error } = await db.from("workout_sets").update(patch).eq("id", id);
    if (error) toast.error(errMsg(error));
    refresh();
  };
  const moveSet = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= sets.length) return;
    await Promise.all([
      updateSet(sets[i].id, { set_number: sets[j].set_number }),
      updateSet(sets[j].id, { set_number: sets[i].set_number }),
    ]);
  };
  const saveExercise = async (patch: Partial<WorkoutExercise>) => {
    const { error } = await db.from("workout_exercises").update(patch).eq("id", ex.id);
    if (error) toast.error(errMsg(error));
    refresh();
  };

  const target = plan
    ? `${plan.target_sets} × ${plan.target_duration_seconds ? `${plan.target_duration_seconds}s` : plan.target_reps_min && plan.target_reps_max && plan.target_reps_min !== plan.target_reps_max ? `${plan.target_reps_min}–${plan.target_reps_max}` : (plan.target_reps_max ?? plan.target_reps_min)}${plan.suggested_weight_kg !== null ? ` @ ${Number(plan.suggested_weight_kg)} kg (suggested)` : ""}${plan.rest_seconds ? ` · rest ${plan.rest_seconds}s` : ""}`
    : null;

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-muted text-xs">
            {index + 1}
          </span>
          {ex.exercise_name}
          {ex.pain_reported && (
            <span className="rounded bg-destructive/15 px-1.5 text-[10px] uppercase text-destructive">
              pain
            </span>
          )}
        </span>
      }
      description={[titleCase(ex.muscle_group ?? ""), ex.equipment].filter(Boolean).join(" · ")}
      action={
        <div className="flex items-center">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Move exercise up"
            disabled={index === 0}
            onClick={() => onMove(index, -1)}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Move exercise down"
            disabled={index === count - 1}
            onClick={() => onMove(index, 1)}
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
          <ConfirmDelete
            what={`${ex.exercise_name} and its sets`}
            onConfirm={async () => {
              await db.from("workout_exercises").delete().eq("id", ex.id);
              refresh();
            }}
          />
        </div>
      }
    >
      <div className="mb-2 space-y-0.5 text-xs">
        {target && (
          <div>
            <KindBadge kind="planned" /> <span className="text-muted-foreground">{target}</span>
          </div>
        )}
        {last && (
          <div className="text-muted-foreground">
            Last time ({fmtDate(last.workout_sessions.session_date, "d MMM")}):{" "}
            {last.workout_sets
              .map(
                (x) =>
                  `${x.is_warmup ? "W " : ""}${timed ? `${x.duration_seconds}s` : `${x.weight_kg !== null ? `${Number(x.weight_kg)}×` : ""}${x.reps}`}`,
              )
              .join(", ")}
          </div>
        )}
        <div
          className={
            advice.kind === "increase"
              ? "text-[var(--pp-good)]"
              : advice.kind === "hold_pain" || advice.kind === "hold_form"
                ? "text-destructive"
                : "text-muted-foreground"
          }
        >
          Reference only: {advice.message}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="w-8 text-left">#</th>
              {loaded && (
                <th className="text-left">
                  {ex.measurement_type === "assisted_reps" ? "Assist kg" : "kg"}
                </th>
              )}
              {!timed && <th className="text-left">Reps</th>}
              {timed && <th className="text-left">Seconds</th>}
              <th className="text-left">RPE</th>
              <th className="text-left">Warm-up</th>
              {ex.measurement_type === "weight_reps" && <th className="text-right">e1RM*</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {sets.map((st, i) => (
              <SetRow
                key={st.id}
                st={st}
                i={i}
                n={sets.length}
                ex={ex}
                onUpdate={updateSet}
                onMove={moveSet}
                refresh={refresh}
              />
            ))}
            <tr className="border-t bg-muted/30">
              <td className="py-1.5 text-muted-foreground">
                {(sets[sets.length - 1]?.set_number ?? 0) + 1}
              </td>
              {loaded && (
                <td className="pr-1">
                  <NumInput
                    value={w}
                    onChange={setW}
                    className="h-10 w-20 text-base"
                    placeholder={
                      last?.workout_sets[0]?.weight_kg != null
                        ? String(Number(last.workout_sets[0].weight_kg))
                        : "kg"
                    }
                  />
                </td>
              )}
              {!timed && (
                <td className="pr-1">
                  <NumInput
                    value={r}
                    onChange={setR}
                    step="1"
                    className="h-10 w-16 text-base"
                    placeholder="reps"
                  />
                </td>
              )}
              {timed && (
                <td className="pr-1">
                  <NumInput
                    value={sec}
                    onChange={setSec}
                    step="1"
                    className="h-10 w-20 text-base"
                    placeholder="s"
                  />
                </td>
              )}
              <td className="pr-1">
                <NumInput value={rpe} onChange={setRpe} className="h-10 w-14" placeholder="—" />
              </td>
              <td>
                <input
                  type="checkbox"
                  aria-label="Warm-up set"
                  className="h-4 w-4 accent-[var(--primary)]"
                  checked={warm}
                  onChange={(e) => setWarm(e.target.checked)}
                />
              </td>
              {ex.measurement_type === "weight_reps" && <td />}
              <td className="text-right">
                <Button size="sm" onClick={addSet}>
                  <Plus className="mr-1 h-4 w-4" /> Set
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>
          {t.sets} working sets · {t.reps} reps
          {ex.measurement_type === "weight_reps"
            ? ` · ${fmtNum(t.volume, 0)} kg volume · top ${t.maxWeight ?? "—"} kg`
            : ""}
          {timed ? ` · ${t.seconds}s total` : ""}
          {t.warmupSets ? ` · ${t.warmupSets} warm-up` : ""}
        </span>
        {last && sets.length === 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                await copySets(last.workout_sets, ex.id);
                toast.success(
                  "Copied last session's sets — edit any that differ from what you actually did",
                );
                refresh();
              } catch (e) {
                toast.error(errMsg(e));
              }
            }}
          >
            <Copy className="mr-1 h-3.5 w-3.5" /> Copy last session's sets
          </Button>
        )}
        <button type="button" className="underline" onClick={() => setDetails(!details)}>
          {details ? "Hide" : "Difficulty, form, pain & notes"}
        </button>
      </div>

      {details && (
        <div className="mt-3 grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
          <Field label="Difficulty (1–10)">
            <RatingPicker
              max={10}
              value={ex.difficulty_rating}
              onChange={(v) => saveExercise({ difficulty_rating: v })}
            />
          </Field>
          <Field label="Form quality">
            <NativeSelect
              value={ex.form_quality ?? ""}
              onChange={(v) =>
                saveExercise({ form_quality: (v || null) as WorkoutExercise["form_quality"] })
              }
              placeholder="Not rated"
              options={[
                { value: "good", label: "Good" },
                { value: "fair", label: "Fair" },
                { value: "poor", label: "Poor" },
              ]}
            />
          </Field>
          <Toggle
            id={`pain-${ex.id}`}
            checked={ex.pain_reported}
            onChange={(v) => saveExercise({ pain_reported: v })}
            label="Pain or discomfort (blocks weight increases)"
          />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Rest (s)">
              <NumInput value={rest} onChange={setRest} />
            </Field>
            <Field label="Duration (min)">
              <NumInput value={dur} onChange={setDur} />
            </Field>
          </div>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="sm:col-span-2 flex justify-end">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const rs = parseOptNum(rest, { min: 0, max: 900, int: true });
                const dm = parseOptNum(dur, { min: 0, max: 300, int: true });
                if (rs === undefined || dm === undefined)
                  return toast.error("Rest 0–900 s, duration 0–300 min");
                saveExercise({
                  rest_seconds: rs,
                  duration_minutes: dm,
                  notes: notes.trim() || null,
                });
                toast.success("Saved");
              }}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function SetRow({
  st,
  i,
  n,
  ex,
  onUpdate,
  onMove,
  refresh,
}: {
  st: WorkoutSet;
  i: number;
  n: number;
  ex: ExWithSets;
  onUpdate: (id: string, patch: Partial<WorkoutSet>) => Promise<void>;
  onMove: (i: number, d: -1 | 1) => void;
  refresh: () => void;
}) {
  const timed = ex.measurement_type === "time";
  const loaded = ex.measurement_type === "weight_reps" || ex.measurement_type === "assisted_reps";
  const [w, setW] = useState(strOf(st.weight_kg));
  const [r, setR] = useState(strOf(st.reps));
  const [sec, setSec] = useState(strOf(st.duration_seconds));
  const [rpe, setRpe] = useState(strOf(st.rpe));
  useEffect(() => {
    setW(strOf(st.weight_kg));
    setR(strOf(st.reps));
    setSec(strOf(st.duration_seconds));
    setRpe(strOf(st.rpe));
  }, [st]);
  const commit = (field: "weight_kg" | "reps" | "duration_seconds" | "rpe", raw: string) => {
    const opts =
      field === "weight_kg"
        ? { min: 0, max: 1000 }
        : field === "rpe"
          ? { min: 1, max: 10 }
          : { min: 0, max: field === "reps" ? 1000 : 7200, int: true };
    const v = parseOptNum(raw, opts);
    if (v === undefined) return toast.error("Invalid value");
    if (v === (st[field] === null ? null : Number(st[field]))) return;
    if (
      (field === "reps" && !timed && v === null) ||
      (field === "duration_seconds" && timed && v === null)
    )
      return toast.error("A set needs reps or seconds");
    onUpdate(st.id, { [field]: v });
  };
  const e1 =
    ex.measurement_type === "weight_reps" && !st.is_warmup
      ? estimated1RM(st.weight_kg, st.reps)
      : null;
  return (
    <tr className={`border-t ${st.is_warmup ? "text-muted-foreground" : ""}`}>
      <td className="py-1">{st.is_warmup ? "W" : i + 1}</td>
      {loaded && (
        <td className="pr-1">
          <NumInput value={w} onChange={setW} className="h-9 w-20" />
        </td>
      )}
      {!timed && (
        <td className="pr-1">
          <NumInput value={r} onChange={setR} step="1" className="h-9 w-16" />
        </td>
      )}
      {timed && (
        <td className="pr-1">
          <NumInput value={sec} onChange={setSec} step="1" className="h-9 w-20" />
        </td>
      )}
      <td className="pr-1">
        <NumInput value={rpe} onChange={setRpe} className="h-9 w-14" />
      </td>
      <td>
        <input
          type="checkbox"
          aria-label="Warm-up set"
          className="h-4 w-4 accent-[var(--primary)]"
          checked={st.is_warmup}
          onChange={(e) => onUpdate(st.id, { is_warmup: e.target.checked })}
        />
      </td>
      {ex.measurement_type === "weight_reps" && <td className="text-right text-xs">{e1 ?? "—"}</td>}
      <td className="whitespace-nowrap text-right">
        {(w !== strOf(st.weight_kg) ||
          r !== strOf(st.reps) ||
          sec !== strOf(st.duration_seconds) ||
          rpe !== strOf(st.rpe)) && (
          <Button
            size="sm"
            variant="secondary"
            className="h-8"
            onClick={() => {
              if (loaded) commit("weight_kg", w);
              if (!timed) commit("reps", r);
              else commit("duration_seconds", sec);
              commit("rpe", rpe);
            }}
          >
            Save
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          aria-label="Move set up"
          disabled={i === 0}
          onClick={() => onMove(i, -1)}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          aria-label="Move set down"
          disabled={i === n - 1}
          onClick={() => onMove(i, 1)}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          aria-label="Delete set"
          onClick={async () => {
            const { error } = await db.from("workout_sets").delete().eq("id", st.id);
            if (error) toast.error(errMsg(error));
            refresh();
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );
}
