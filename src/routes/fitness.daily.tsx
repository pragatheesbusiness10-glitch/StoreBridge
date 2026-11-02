import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Dumbbell, Footprints, Moon, Ruler, Scale, Utensils } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DayNav } from "@/components/pp/day-nav";
import { useQuick } from "@/components/pp/shell";
import {
  Field,
  MetricCard,
  PageHeader,
  Panel,
  RatingPicker,
  fmtNum,
  signed,
} from "@/components/pp/ui";
import { WaterQuickAdd } from "@/components/pp/water-quick";
import { minutesToHM } from "@/lib/pp/calc";
import { sessionTotals, useDaily } from "@/lib/pp/daily";
import { addDaysStr, fmtDate, isoWeekday, todayStr } from "@/lib/pp/dates";
import { db, errMsg, targetFor, useList, useTableMutations, useTargets } from "@/lib/pp/db";
import type { DailyNote, WorkoutPlan } from "@/lib/pp/types";

export const Route = createFileRoute("/fitness/daily")({
  component: DailyLog,
});

function DailyLog() {
  const [date, setDate] = useState(todayStr());
  const quick = useQuick();
  const dailyQ = useDaily(addDaysStr(date, -1), date);
  const targetsQ = useTargets();
  const target = targetFor(targetsQ.data, date);
  const plansQ = useList<WorkoutPlan>("workout_plans");
  const notesMut = useTableMutations("daily_notes");
  const [note, setNote] = useState<{
    energy: number | null;
    hunger: number | null;
    mood: number | null;
    stress: number | null;
    note: string;
  }>({ energy: null, hunger: null, mood: null, stress: null, note: "" });
  const [noteRow, setNoteRow] = useState<DailyNote | null>(null);

  useEffect(() => {
    db.from("daily_notes")
      .select("*")
      .eq("note_date", date)
      .maybeSingle()
      .then(({ data }) => {
        const n = data as DailyNote | null;
        setNoteRow(n);
        setNote({
          energy: n?.energy ?? null,
          hunger: n?.hunger ?? null,
          mood: n?.mood ?? null,
          stress: n?.stress ?? null,
          note: n?.note ?? "",
        });
      });
  }, [date]);

  const b = dailyQ.data;
  const d = b?.days.find((x) => x.date === date);
  const prev = b?.days.find((x) => x.date === addDaysStr(date, -1));
  const sessions = b?.sessions.filter((s) => s.session_date === date) ?? [];
  const cardio = b?.cardio.filter((c) => c.log_date === date) ?? [];
  const plan = plansQ.data?.find((p) => p.day_of_week === isoWeekday(date));
  const meas = b?.measurements.find((m) => m.measured_on === date);

  const saveNote = async () => {
    try {
      await notesMut.upsert.mutateAsync({
        row: { note_date: date, ...note, note: note.note.trim() || null },
        onConflict: "user_id,note_date",
      });
      toast.success("Daily note saved");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div>
      <PageHeader
        title="Daily Log"
        description="Everything recorded for one day, with one-tap entry."
      />
      <div className="mb-4">
        <DayNav date={date} onChange={setDate} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title={
            <span className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-primary" /> Weight
            </span>
          }
          action={
            <Button size="sm" variant="secondary" onClick={() => quick.openWeight(date)}>
              {d?.weight != null ? "Edit" : "Log"}
            </Button>
          }
        >
          {d?.weight != null ? (
            <div className="grid grid-cols-3 gap-2">
              <MetricCard label="Morning" value={fmtNum(d.weight, 2)} unit="kg" kind="measured" />
              <MetricCard
                label="vs yesterday"
                value={prev?.weight != null ? signed(d.weight - prev.weight) : null}
                unit="kg"
                kind="calculated"
                sub="Daily noise is normal"
              />
              <MetricCard
                label="7-day avg"
                value={d.avg7 !== null ? fmtNum(d.avg7, 2) : null}
                unit="kg"
                kind="calculated"
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Not logged.</p>
          )}
        </Panel>

        <Panel
          title={
            <span className="flex items-center gap-2">
              <Utensils className="h-4 w-4 text-primary" /> Nutrition
            </span>
          }
          action={
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" onClick={() => quick.openFood({ date })}>
                Add food
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <Link to="/fitness/nutrition">Details</Link>
              </Button>
            </div>
          }
        >
          {d && d.foodEntries > 0 ? (
            <div className="grid grid-cols-4 gap-2">
              <MetricCard
                label="kcal"
                value={fmtNum(d.kcal, 0)}
                sub={target?.kcal_min ? `${target.kcal_min}–${target.kcal_max}` : undefined}
              />
              <MetricCard
                label="Protein"
                value={fmtNum(d.protein)}
                unit="g"
                sub={
                  target?.protein_min_g
                    ? `${target.protein_min_g}–${target.protein_max_g}`
                    : undefined
                }
              />
              <MetricCard label="Carbs" value={fmtNum(d.carbs)} unit="g" />
              <MetricCard label="Fat" value={fmtNum(d.fat)} unit="g" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No food logged.</p>
          )}
          <div className="mt-3">
            <div className="mb-1 text-xs text-muted-foreground">
              Water: {d?.waterMl ? `${fmtNum(d.waterMl / 1000, 2)} L` : "none"}
              {target?.water_min_ml ? ` of ${fmtNum(target.water_min_ml / 1000, 1)} L target` : ""}
            </div>
            <WaterQuickAdd date={date} compact />
          </div>
        </Panel>

        <Panel
          title={
            <span className="flex items-center gap-2">
              <Dumbbell className="h-4 w-4 text-primary" /> Training
            </span>
          }
          action={
            <Button size="sm" variant="secondary" onClick={() => quick.startOrResumeWorkout()}>
              Workout
            </Button>
          }
        >
          {plan && (
            <p className="mb-2 text-xs text-muted-foreground">
              Planned: {plan.is_rest_day ? "Rest day" : plan.name}
            </p>
          )}
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No workout recorded.</p>
          ) : (
            sessions.map((s) => {
              const t = sessionTotals(s);
              return (
                <Link
                  key={s.id}
                  to="/fitness/workouts/$id"
                  params={{ id: s.id }}
                  className="mb-2 block rounded-lg border p-2 text-sm hover:bg-muted"
                >
                  <b>{s.name}</b> · {s.status.replace("_", " ")} · {t.exercises} exercises ·{" "}
                  {t.sets} sets · {t.reps} reps · {fmtNum(t.volume, 0)} kg
                </Link>
              );
            })
          )}
        </Panel>

        <Panel
          title={
            <span className="flex items-center gap-2">
              <Footprints className="h-4 w-4 text-primary" /> Cardio & steps
            </span>
          }
          action={
            <Button size="sm" variant="ghost" asChild>
              <Link to="/fitness/cardio">Log</Link>
            </Button>
          }
        >
          <div className="grid grid-cols-3 gap-2">
            <MetricCard
              label="Steps"
              value={d?.steps != null ? fmtNum(d.steps, 0) : null}
              kind="entered"
            />
            <MetricCard label="Cardio" value={d?.cardioMin ?? null} unit="min" kind="entered" />
            <MetricCard
              label="Distance"
              value={d?.cardioKm != null ? fmtNum(d.cardioKm, 2) : null}
              unit="km"
              kind="entered"
            />
          </div>
          {cardio.map((c) => (
            <div key={c.id} className="mt-1 text-xs text-muted-foreground">
              {c.activity_type} · {fmtNum(c.duration_minutes)} min
              {c.distance_km ? ` · ${fmtNum(c.distance_km, 2)} km` : ""}
            </div>
          ))}
        </Panel>

        <Panel
          title={
            <span className="flex items-center gap-2">
              <Moon className="h-4 w-4 text-primary" /> Sleep
            </span>
          }
          action={
            <Button size="sm" variant="ghost" asChild>
              <Link to="/fitness/sleep-water">Log</Link>
            </Button>
          }
        >
          {d?.sleepMin != null ? (
            <p className="text-sm">
              {minutesToHM(d.sleepMin)}
              {d.sleepQuality ? ` · quality ${d.sleepQuality}/5` : ""}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Not logged.</p>
          )}
        </Panel>

        <Panel
          title={
            <span className="flex items-center gap-2">
              <Ruler className="h-4 w-4 text-primary" /> Measurements
            </span>
          }
          action={
            <Button size="sm" variant="ghost" asChild>
              <Link to="/fitness/measurements" search={{ new: 1 }}>
                Log
              </Link>
            </Button>
          }
        >
          {meas ? (
            <p className="text-sm">
              {[
                meas.waist_cm && `Waist ${fmtNum(meas.waist_cm)} cm`,
                meas.chest_cm && `Chest ${fmtNum(meas.chest_cm)} cm`,
                meas.body_fat_pct && `Body fat ${fmtNum(meas.body_fat_pct)}%`,
              ]
                .filter(Boolean)
                .join(" · ") || "Recorded"}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">None recorded.</p>
          )}
        </Panel>

        <Panel
          title="Daily notes"
          className="lg:col-span-2"
          description={noteRow ? `Saved ${fmtDate(date, "d MMM")}` : undefined}
        >
          <div className="grid gap-3 sm:grid-cols-4">
            {(["energy", "hunger", "mood", "stress"] as const).map((k) => (
              <Field key={k} label={`${k[0].toUpperCase()}${k.slice(1)} (1–5)`}>
                <RatingPicker value={note[k]} onChange={(v) => setNote({ ...note, [k]: v })} />
              </Field>
            ))}
            <Field label="Notes" className="sm:col-span-4">
              <Textarea
                rows={3}
                value={note.note}
                onChange={(e) => setNote({ ...note, note: e.target.value })}
                placeholder="How did today go? Digestion, cravings, soreness, stress…"
              />
            </Field>
          </div>
          <div className="mt-2 flex justify-end">
            <Button size="sm" onClick={saveNote} disabled={notesMut.upsert.isPending}>
              Save note
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
