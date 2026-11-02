import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Bell, Dumbbell, Plus, Scale, Trophy, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TimeChart } from "@/components/pp/charts";
import { DateRangeFilter, useDateRange } from "@/components/pp/date-range";
import { useQuick } from "@/components/pp/shell";
import { StrengthChart } from "@/components/pp/strength-chart";
import { MetricCard, Panel, fmtNum } from "@/components/pp/ui";
import { WaterQuickAdd } from "@/components/pp/water-quick";
import { useAchievementSync } from "@/lib/pp/achievements";
import {
  bmi,
  bmiCategory,
  lowCalorieWarning,
  minutesToHM,
  programmeProgress,
  projectedWeightOn,
  targetStatus,
  weeklyAverages,
} from "@/lib/pp/calc";
import { latestOnOrBefore, useDaily } from "@/lib/pp/daily";
import { addDaysStr, fmtDate, isoWeekday, nowTimeStr, todayStr } from "@/lib/pp/dates";
import { targetFor, useList, useProfile, useProgram, useTargets } from "@/lib/pp/db";
import {
  BODY_FAT_METHODS,
  type Achievement,
  type PlanExercise,
  type Reminder,
  type WorkoutPlan,
} from "@/lib/pp/types";

export const Route = createFileRoute("/fitness/")({
  component: Dashboard,
});

function rangeLabel(min: number | null, max: number | null, unit: string) {
  if (min === null && max === null) return "No target set";
  if (min !== null && max !== null) return `Target ${fmtNum(min, 0)}–${fmtNum(max, 0)} ${unit}`;
  return `Target ${min !== null ? "≥ " + fmtNum(min, 0) : "≤ " + fmtNum(max, 0)} ${unit}`;
}
const pctOf = (v: number | null, t: number | null) => (v === null || !t ? null : (v / t) * 100);

function Dashboard() {
  const today = todayStr();
  const quick = useQuick();
  const range = useDateRange("30");
  const profileQ = useProfile();
  const programQ = useProgram();
  const targetsQ = useTargets();
  const program = programQ.data ?? null;
  const profile = profileQ.data ?? null;
  const target = targetFor(targetsQ.data, today);

  // Window covering the chart range, the low-intake check and the whole programme so far (for achievements).
  const from = [
    range.range.from,
    addDaysStr(today, -7),
    program && program.start_date <= today ? program.start_date : today,
  ].sort()[0];
  const dailyQ = useDaily(from, today);
  const achQ = useList<Achievement>("achievements", { order: "achieved_on" });
  const plansQ = useList<WorkoutPlan>("workout_plans", { order: "sort_order" });
  const planExQ = useList<PlanExercise>("workout_plan_exercises");
  const remindersQ = useList<Reminder>("reminders", {
    order: "time_of_day",
    filter: { enabled: true },
  });
  useAchievementSync(dailyQ.data, program, achQ.data);

  const b = dailyQ.data;
  const todayRow = b?.days.find((d) => d.date === today);
  const latestW = b
    ? latestOnOrBefore(
        b.weights,
        (w) => w.log_date,
        (w) => Number(w.morning_weight_kg),
        today,
      )
    : null;
  const latestWaist = b
    ? latestOnOrBefore(
        b.measurements,
        (m) => m.measured_on,
        (m) => (m.waist_cm === null ? null : Number(m.waist_cm)),
        today,
      )
    : null;
  const latestBfRow = b?.measurements
    .filter((m) => m.body_fat_pct !== null)
    .sort((a, z) => z.measured_on.localeCompare(a.measured_on))[0];
  const bfMeasured = latestBfRow
    ? (BODY_FAT_METHODS.find((m) => m.value === latestBfRow.body_fat_method)?.measured ?? false)
    : false;
  const prog = program ? programmeProgress(program, latestW?.value ?? null, today) : null;
  const curBmi = bmi(latestW?.value ?? null, profile?.height_cm ?? null);
  const totalWorkoutDays = b
    ? new Set(
        b.sessions
          .filter(
            (s) => s.status === "completed" && (!program || s.session_date >= program.start_date),
          )
          .map((s) => s.session_date),
      ).size
    : null;

  const todaysPlan = plansQ.data?.find((p) => p.day_of_week === isoWeekday(today));
  const todaysSessions = b?.sessions.filter((s) => s.session_date === today) ?? [];
  const workoutStatus = todaysSessions.some((s) => s.status === "completed")
    ? "Completed"
    : todaysSessions.some((s) => s.status === "in_progress")
      ? "In progress"
      : todaysPlan?.is_rest_day
        ? "Rest day"
        : todaysPlan
          ? `Planned: ${todaysPlan.name}`
          : "Nothing planned";

  const lowWarn =
    b && profile
      ? lowCalorieWarning(
          b.days.filter((d) => d.kcal !== null).map((d) => ({ date: d.date, kcal: d.kcal! })),
          today,
          profile.low_calorie_warning_kcal,
        )
      : null;

  const chartDays = useMemo(
    () => (b?.days ?? []).filter((d) => d.date >= range.range.from && d.date <= range.range.to),
    [b, range.range.from, range.range.to],
  );
  const weeklyW = useMemo(
    () =>
      weeklyAverages(
        chartDays.filter((d) => d.weight !== null).map((d) => ({ date: d.date, value: d.weight! })),
      ).map((w) => ({
        date: w.key,
        avg: w.value,
        n: w.n,
      })),
    [chartDays],
  );
  const targetVsActual = chartDays.map((d) => ({
    date: d.date,
    actual: d.avg7,
    projected: program && d.date >= program.start_date ? projectedWeightOn(program, d.date) : null,
  }));
  const bodyFatSeries = (b?.measurements ?? [])
    .filter(
      (m) =>
        m.body_fat_pct !== null &&
        m.measured_on >= range.range.from &&
        m.measured_on <= range.range.to,
    )
    .map((m) => {
      const measured =
        BODY_FAT_METHODS.find((x) => x.value === m.body_fat_method)?.measured ?? false;
      return {
        date: m.measured_on,
        measured: measured ? Number(m.body_fat_pct) : null,
        estimate: measured ? null : Number(m.body_fat_pct),
      };
    });
  const waistSeries = (b?.measurements ?? [])
    .filter(
      (m) =>
        m.waist_cm !== null && m.measured_on >= range.range.from && m.measured_on <= range.range.to,
    )
    .map((m) => ({ date: m.measured_on, waist: Number(m.waist_cm) }));

  const now = nowTimeStr();
  const dueReminders = (remindersQ.data ?? [])
    .filter((r) => r.days_of_week.includes(isoWeekday(today)) && r.time_of_day.slice(0, 5) <= now)
    .filter((r) => {
      if (!todayRow) return true;
      switch (r.reminder_type) {
        case "weight":
          return todayRow.weight === null;
        case "food":
          return todayRow.foodEntries === 0;
        case "water":
          return todayRow.waterMl === null;
        case "workout":
          return todayRow.workouts === 0 && !todaysPlan?.is_rest_day;
        case "sleep":
          return todayRow.sleepMin === null;
        case "steps":
          return todayRow.steps === null;
        case "measurements":
          return todayRow.waist === null;
        default:
          return true;
      }
    });

  const tones = (s: ReturnType<typeof targetStatus>) =>
    s === "within" ? "good" : s === "none" ? undefined : "warn";
  const plannedExercises = todaysPlan
    ? (planExQ.data ?? []).filter((p) => p.plan_id === todaysPlan.id).length
    : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-widest text-primary">
            {prog
              ? prog.startsInDays > 0
                ? `Programme starts in ${prog.startsInDays} day${prog.startsInDays === 1 ? "" : "s"}`
                : `Day ${prog.dayNumber} of ${prog.totalDays}`
              : "Prime Physique"}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {profile?.display_name ? `Hi ${profile.display_name}` : "Dashboard"} ·{" "}
            {fmtDate(today, "EEEE d MMM")}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2 pp-no-print">
          <Button size="sm" onClick={() => quick.openWeight()}>
            <Scale className="mr-1 h-4 w-4" /> Weight
          </Button>
          <Button size="sm" variant="secondary" onClick={() => quick.openFood()}>
            <Utensils className="mr-1 h-4 w-4" /> Food
          </Button>
          <Button size="sm" variant="secondary" onClick={() => quick.startOrResumeWorkout()}>
            <Dumbbell className="mr-1 h-4 w-4" /> Workout
          </Button>
        </div>
      </div>

      {dueReminders.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 text-sm">
          <Bell className="h-4 w-4 text-primary" />
          {dueReminders.map((r) => (
            <span key={r.id} className="rounded-full bg-muted px-2 py-0.5 text-xs">
              {r.title}
            </span>
          ))}
        </div>
      )}

      {lowWarn && (
        <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
          <div>
            <div className="font-medium">Persistently low intake</div>
            <div className="text-muted-foreground">
              Your average over the last {lowWarn.days} logged days is {fmtNum(lowWarn.avg, 0)}{" "}
              kcal, below your warning level of {profile?.low_calorie_warning_kcal} kcal. Very low
              intakes can cost muscle, energy and recovery. If this is intentional, set targets with
              a registered dietitian or doctor; otherwise check that all meals were logged.{" "}
              <Link to="/fitness/settings" className="underline">
                Adjust targets
              </Link>
            </div>
          </div>
        </div>
      )}

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Body
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <MetricCard
            label="Starting weight"
            value={program ? fmtNum(program.start_weight_kg, 2) : null}
            unit="kg"
            kind="entered"
            sub={program ? fmtDate(program.start_date) : undefined}
          />
          <MetricCard
            label="Today's weight"
            value={
              todayRow?.weight !== null && todayRow?.weight !== undefined
                ? fmtNum(todayRow.weight, 2)
                : null
            }
            unit="kg"
            kind="measured"
            sub={
              todayRow?.weight == null
                ? latestW
                  ? `Last: ${fmtNum(latestW.value, 2)} kg on ${fmtDate(latestW.date, "d MMM")}`
                  : "Not logged"
                : todayRow.avg7 !== null
                  ? `7-day avg ${fmtNum(todayRow.avg7, 2)} kg`
                  : undefined
            }
          />
          <MetricCard
            label="Target weight"
            value={program ? fmtNum(program.target_weight_kg, 2) : null}
            unit="kg"
            kind="planned"
            sub={prog ? `by ${fmtDate(prog.endDate)}` : undefined}
          />
          <MetricCard
            label="Total lost"
            value={
              prog?.lostSoFar !== null && prog?.lostSoFar !== undefined
                ? fmtNum(prog.lostSoFar, 2)
                : null
            }
            unit="kg"
            kind="calculated"
            progress={prog?.progressPct}
            sub={
              prog?.progressPct !== null && prog?.progressPct !== undefined
                ? `${prog.progressPct}% of ${prog.totalToLose} kg`
                : "Needs a weigh-in"
            }
          />
          <MetricCard
            label="Remaining"
            value={
              prog?.remaining !== null && prog?.remaining !== undefined
                ? fmtNum(prog.remaining, 2)
                : null
            }
            unit="kg"
            kind="calculated"
          />
          <MetricCard
            label="Current BMI"
            value={curBmi}
            kind="calculated"
            sub={
              curBmi
                ? `${bmiCategory(curBmi)} · does not reflect muscle mass`
                : "Needs weight & height"
            }
          />
          <MetricCard
            label="Waist"
            value={
              latestWaist
                ? fmtNum(latestWaist.value)
                : profile?.initial_waist_cm
                  ? fmtNum(profile.initial_waist_cm)
                  : null
            }
            unit="cm"
            kind="measured"
            sub={
              latestWaist
                ? fmtDate(latestWaist.date, "d MMM")
                : profile?.initial_waist_cm
                  ? "Initial (profile)"
                  : "Unknown — not measured yet"
            }
          />
          <MetricCard
            label="Body fat"
            value={latestBfRow ? fmtNum(latestBfRow.body_fat_pct) : null}
            unit="%"
            kind={bfMeasured ? "measured" : "estimated"}
            sub={
              latestBfRow
                ? `${BODY_FAT_METHODS.find((m) => m.value === latestBfRow.body_fat_method)?.label} · ${fmtDate(latestBfRow.measured_on, "d MMM")}`
                : "Unknown — not measured"
            }
          />
          <MetricCard
            label="Workout days"
            value={totalWorkoutDays}
            kind="calculated"
            sub="Completed since programme start"
          />
          <MetricCard
            label="Transformation day"
            value={prog ? (prog.startsInDays > 0 ? "—" : prog.dayNumber) : null}
            kind="calculated"
            sub={
              prog ? `${prog.completedDays} completed · ${prog.remainingDays} remaining` : undefined
            }
          />
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Nutrition today
          </h2>
          <Link to="/fitness/nutrition" className="text-xs text-primary pp-no-print">
            Open nutrition →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <MetricCard
            label="Calories"
            value={todayRow?.kcal != null ? fmtNum(todayRow.kcal, 0) : null}
            unit="kcal"
            kind="calculated"
            progress={pctOf(todayRow?.kcal ?? null, target?.kcal_max ?? target?.kcal_min ?? null)}
            tone={tones(
              targetStatus(
                todayRow?.kcal ?? null,
                target?.kcal_min ?? null,
                target?.kcal_max ?? null,
              ),
            )}
            sub={rangeLabel(target?.kcal_min ?? null, target?.kcal_max ?? null, "kcal")}
          />
          <MetricCard
            label="Protein"
            value={todayRow?.protein != null ? fmtNum(todayRow.protein) : null}
            unit="g"
            kind="calculated"
            progress={pctOf(todayRow?.protein ?? null, target?.protein_min_g ?? null)}
            tone={tones(
              targetStatus(
                todayRow?.protein ?? null,
                target?.protein_min_g ?? null,
                target?.protein_max_g ?? null,
              ),
            )}
            sub={rangeLabel(target?.protein_min_g ?? null, target?.protein_max_g ?? null, "g")}
          />
          <MetricCard
            label="Carbohydrates"
            value={todayRow?.carbs != null ? fmtNum(todayRow.carbs) : null}
            unit="g"
            kind="calculated"
            sub={rangeLabel(target?.carbs_min_g ?? null, target?.carbs_max_g ?? null, "g")}
          />
          <MetricCard
            label="Fat"
            value={todayRow?.fat != null ? fmtNum(todayRow.fat) : null}
            unit="g"
            kind="calculated"
            tone={tones(
              targetStatus(
                todayRow?.fat ?? null,
                target?.fat_min_g ?? null,
                target?.fat_max_g ?? null,
              ),
            )}
            sub={rangeLabel(target?.fat_min_g ?? null, target?.fat_max_g ?? null, "g")}
          />
          <MetricCard
            label="Food weight"
            value={todayRow?.foodG != null ? fmtNum(todayRow.foodG, 0) : null}
            unit="g"
            kind="calculated"
            sub={todayRow?.foodEntries ? `${todayRow.foodEntries} entries` : "No food logged"}
          />
          <MetricCard
            label="Water"
            value={todayRow?.waterMl != null ? fmtNum(todayRow.waterMl / 1000, 2) : null}
            unit="L"
            kind="entered"
            progress={pctOf(todayRow?.waterMl ?? null, target?.water_min_ml ?? null)}
            sub={rangeLabel(
              target?.water_min_ml ? target.water_min_ml / 1000 : null,
              target?.water_max_ml ? target.water_max_ml / 1000 : null,
              "L",
            )}
          />
          <MetricCard
            label="Chicken"
            value={todayRow?.chickenG != null ? fmtNum(todayRow.chickenG, 0) : null}
            unit="g"
            kind="entered"
          />
          <MetricCard
            label="Whole eggs"
            value={todayRow?.eggs != null ? fmtNum(todayRow.eggs, 1) : null}
            kind="entered"
            sub={
              todayRow?.eggWhiteG ? `+ ${fmtNum(todayRow.eggWhiteG, 0)} g egg whites` : undefined
            }
          />
          <MetricCard
            label="Tofu"
            value={todayRow?.tofuG != null ? fmtNum(todayRow.tofuG, 0) : null}
            unit="g"
            kind="entered"
          />
          <MetricCard
            label="Soya"
            value={todayRow?.soyaG != null ? fmtNum(todayRow.soyaG, 0) : null}
            unit="g"
            kind="entered"
            sub="Dry and cooked entries are listed separately in Nutrition"
          />
          <MetricCard
            label="Protein powder"
            value={todayRow?.powderG != null ? fmtNum(todayRow.powderG, 0) : null}
            unit="g"
            kind="entered"
          />
          <div className="rounded-xl border bg-card p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Add water
            </div>
            <div className="mt-2">
              <WaterQuickAdd date={today} compact />
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Training today
          </h2>
          <Link to="/fitness/workouts" className="text-xs text-primary pp-no-print">
            Workout history →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <MetricCard
            label="Workout status"
            value={<span className="text-base">{workoutStatus}</span>}
            sub={
              todaysPlan && !todaysPlan.is_rest_day
                ? `${plannedExercises} planned exercises`
                : undefined
            }
          />
          <MetricCard label="Exercises done" value={todayRow?.exercises ?? 0} kind="calculated" />
          <MetricCard
            label="Sets"
            value={todayRow?.sets ?? 0}
            kind="calculated"
            sub="Working sets"
          />
          <MetricCard label="Reps" value={todayRow?.reps ?? 0} kind="calculated" />
          <MetricCard
            label="Volume"
            value={todayRow?.volume != null ? fmtNum(todayRow.volume, 0) : 0}
            unit="kg"
            kind="calculated"
            sub="Σ weight × reps"
          />
          <MetricCard
            label="Cardio"
            value={todayRow?.cardioMin != null ? fmtNum(todayRow.cardioMin, 0) : null}
            unit="min"
            kind="entered"
            sub={todayRow?.cardioKm ? `${fmtNum(todayRow.cardioKm, 2)} km` : undefined}
          />
          <MetricCard
            label="Steps"
            value={todayRow?.steps != null ? fmtNum(todayRow.steps, 0) : null}
            kind="entered"
            sub={target?.steps_target ? `Target ${fmtNum(target.steps_target, 0)}` : undefined}
          />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Progress charts
          </h2>
          <DateRangeFilter state={range} />
        </div>
        {dailyQ.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading records…</div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            <Panel
              title="Daily weight"
              description="Daily readings fluctuate with water, food and digestion — the 7-day average shows the trend."
            >
              <TimeChart
                data={chartDays}
                unit="kg"
                series={[
                  { key: "weight", label: "Morning weight", dot: true, color: "var(--chart-2)" },
                  { key: "avg7", label: "7-day average", color: "var(--chart-1)" },
                ]}
              />
            </Panel>
            <Panel title="Weekly average weight">
              <TimeChart
                data={weeklyW}
                unit="kg"
                series={[{ key: "avg", label: "Weekly average", type: "bar" }]}
                yDomain={["dataMin - 1", "dataMax + 1"]}
              />
            </Panel>
            <Panel
              title="Target vs actual"
              description="Projection is a straight line from start to target — not a mandatory rate."
            >
              <TimeChart
                data={targetVsActual}
                unit="kg"
                series={[
                  { key: "actual", label: "Actual (7-day avg)" },
                  {
                    key: "projected",
                    label: "Projection",
                    dashed: true,
                    color: "var(--muted-foreground)",
                  },
                ]}
              />
            </Panel>
            <Panel title="Daily calories">
              <TimeChart
                data={chartDays}
                unit="kcal"
                band={
                  target?.kcal_min && target?.kcal_max
                    ? { y1: target.kcal_min, y2: target.kcal_max }
                    : undefined
                }
                series={[{ key: "kcal", label: "Calories", type: "bar", color: "var(--chart-3)" }]}
              />
            </Panel>
            <Panel title="Daily protein">
              <TimeChart
                data={chartDays}
                unit="g"
                band={
                  target?.protein_min_g && target?.protein_max_g
                    ? { y1: target.protein_min_g, y2: target.protein_max_g }
                    : undefined
                }
                series={[
                  { key: "protein", label: "Protein", type: "bar", color: "var(--chart-1)" },
                ]}
              />
            </Panel>
            <Panel title="Carbohydrates & fat">
              <TimeChart
                data={chartDays}
                unit="g"
                series={[
                  { key: "carbs", label: "Carbohydrates", color: "var(--chart-2)", dot: true },
                  { key: "fat", label: "Fat", color: "var(--chart-5)", dot: true },
                ]}
              />
            </Panel>
            <Panel title="Daily water">
              <TimeChart
                data={chartDays}
                unit="ml"
                refLines={
                  target?.water_min_ml ? [{ y: target.water_min_ml, label: "Target" }] : undefined
                }
                series={[{ key: "waterMl", label: "Water", type: "bar", color: "var(--chart-2)" }]}
              />
            </Panel>
            <Panel title="Waist circumference">
              <TimeChart
                data={waistSeries}
                unit="cm"
                series={[{ key: "waist", label: "Waist", dot: true }]}
                emptyText="No waist measurements in this period."
              />
            </Panel>
            <Panel
              title="Body fat"
              description="Estimates are shown separately from measured values."
            >
              <TimeChart
                data={bodyFatSeries}
                unit="%"
                series={[
                  { key: "measured", label: "Measured", dot: true },
                  {
                    key: "estimate",
                    label: "Estimate",
                    dashed: true,
                    dot: true,
                    color: "var(--chart-3)",
                  },
                ]}
                emptyText="No body fat values recorded. Prime Physique never estimates body fat from weight."
              />
            </Panel>
            <Panel title="Training volume">
              <TimeChart
                data={chartDays}
                unit="kg"
                series={[
                  {
                    key: "volume",
                    label: "Volume (Σ weight × reps)",
                    type: "bar",
                    color: "var(--chart-4)",
                  },
                ]}
                emptyText="No sets recorded in this period."
              />
            </Panel>
            <Panel title="Strength progression">
              <StrengthChart from={range.range.from} to={range.range.to} />
            </Panel>
            <Panel title="Sleep duration">
              <TimeChart
                data={chartDays.map((d) => ({
                  date: d.date,
                  hours: d.sleepMin === null ? null : Math.round((d.sleepMin / 60) * 100) / 100,
                }))}
                unit="h"
                refLines={
                  target?.sleep_target_hours
                    ? [{ y: Number(target.sleep_target_hours), label: "Target" }]
                    : undefined
                }
                series={[{ key: "hours", label: "Sleep", type: "bar", color: "var(--chart-4)" }]}
              />
            </Panel>
          </div>
        )}
      </section>

      <Panel
        title={
          <span className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-primary" /> Achievements
          </span>
        }
        action={
          <Link to="/fitness/analytics" className="text-xs text-primary">
            All →
          </Link>
        }
      >
        {achQ.data?.length ? (
          <div className="flex flex-wrap gap-2">
            {achQ.data.map((a) => (
              <span
                key={a.id}
                title={a.evidence}
                className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium"
              >
                {a.title} · {fmtDate(a.achieved_on, "d MMM")}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No achievements yet — they are awarded only when your records support them.{" "}
            <button
              type="button"
              className="text-primary underline"
              onClick={() => quick.openWeight()}
            >
              <Plus className="inline h-3 w-3" /> Log today's weight
            </button>
          </p>
        )}
      </Panel>
      {todayRow?.sleepMin != null && (
        <p className="text-xs text-muted-foreground">
          Last night: {minutesToHM(todayRow.sleepMin)} sleep.
        </p>
      )}
    </div>
  );
}
