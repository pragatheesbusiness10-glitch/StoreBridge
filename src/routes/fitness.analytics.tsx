import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, FileText, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TimeChart } from "@/components/pp/charts";
import { DateRangeFilter, useDateRange } from "@/components/pp/date-range";
import {
  KindBadge,
  MetricCard,
  PageHeader,
  Panel,
  Segmented,
  fmtNum,
  signed,
} from "@/components/pp/ui";
import { loggedDatesOf } from "@/lib/pp/achievements";
import {
  ACHIEVEMENT_CATALOG,
  averageBetween,
  bestE1RM,
  consistencyPct,
  mean,
  milestones,
  minutesToHM,
  round,
  streaks,
  sum,
} from "@/lib/pp/calc";
import { downloadCsv, printToPdf } from "@/lib/pp/csv";
import { useDaily, type DayRow } from "@/lib/pp/daily";
import {
  addDaysStr,
  eachDay,
  fmtDate,
  monthStartStr,
  todayStr,
  weekStartStr,
} from "@/lib/pp/dates";
import { useList, useProfile, useProgram } from "@/lib/pp/db";
import { BODY_FAT_METHODS, type Achievement, type ProgressPhoto } from "@/lib/pp/types";

export const Route = createFileRoute("/fitness/analytics")({
  component: AnalyticsPage,
});

type Tab = "daily" | "weekly" | "monthly" | "milestones" | "consistency";

function AnalyticsPage() {
  const today = todayStr();
  const range = useDateRange("90");
  const [tab, setTab] = useState<Tab>("weekly");
  const programQ = useProgram();
  const profileQ = useProfile();
  const program = programQ.data ?? null;
  // Load 7 extra days before the range so the first week's "starting average" is available.
  const loadFrom = addDaysStr(range.range.from, -7);
  const dailyQ = useDaily(loadFrom, range.range.to);
  const achQ = useList<Achievement>("achievements", { order: "achieved_on" });
  const photosQ = useList<ProgressPhoto>("progress_photos", { order: "photo_date" });
  const b = dailyQ.data;
  const days = (b?.days ?? []).filter((d) => d.date >= range.range.from);
  const readings = (b?.weights ?? []).map((w) => ({
    date: w.log_date,
    value: Number(w.morning_weight_kg),
  }));

  const dailyRows = days.map((d) => ({
    date: d.date,
    weight_kg: d.weight,
    weight_7day_avg_kg: d.avg7,
    calories_kcal: d.kcal,
    protein_g: d.protein,
    carbs_g: d.carbs,
    fat_g: d.fat,
    fibre_g: d.fibre,
    food_g: d.foodG,
    water_ml: d.waterMl,
    steps: d.steps,
    cardio_min: d.cardioMin,
    workouts_completed: d.workouts,
    working_sets: d.sets,
    reps: d.reps,
    volume_kg: d.volume,
    sleep_min: d.sleepMin,
    sleep_quality: d.sleepQuality,
    waist_cm: d.waist,
    body_fat_pct: d.bodyFat,
    body_fat_method: d.bodyFatMethod,
  }));

  const weekly = useMemo(() => {
    const weeks = [...new Set(days.map((d) => weekStartStr(d.date)))];
    return weeks.map((wk) => {
      const end = addDaysStr(wk, 6);
      const wd = (b?.days ?? []).filter((d) => d.date >= wk && d.date <= end);
      const food = wd.filter((d) => d.foodEntries > 0);
      const stepDays = wd.filter((d) => d.steps !== null);
      const startAvg = averageBetween(readings, addDaysStr(wk, -7), addDaysStr(wk, -1));
      const endAvg = averageBetween(readings, wk, end);
      const waists = (b?.measurements ?? [])
        .filter((m) => m.waist_cm !== null && m.measured_on <= end)
        .sort((a, z) => a.measured_on.localeCompare(z.measured_on));
      const inWeek = waists.filter((m) => m.measured_on >= wk);
      const before = waists.filter((m) => m.measured_on < wk).pop();
      const lastW = inWeek[inWeek.length - 1];
      return {
        week_start: wk,
        start_avg_weight_kg: startAvg,
        end_avg_weight_kg: endAvg,
        weight_trend_kg: startAvg !== null && endAvg !== null ? round(endAvg - startAvg, 2) : null,
        weigh_ins: wd.filter((d) => d.weight !== null).length,
        avg_calories_kcal: food.length ? round(mean(food.map((d) => d.kcal!))!, 0) : null,
        avg_protein_g: food.length ? round(mean(food.map((d) => d.protein!))!, 1) : null,
        food_days_logged: food.length,
        avg_steps: stepDays.length ? round(mean(stepDays.map((d) => d.steps!))!, 0) : null,
        workouts: sum(wd.map((d) => d.workouts)),
        volume_kg: round(sum(wd.map((d) => d.volume ?? 0)), 0),
        cardio_min: round(sum(wd.map((d) => d.cardioMin ?? 0)), 0),
        avg_sleep_min: wd.some((d) => d.sleepMin !== null)
          ? round(mean(wd.filter((d) => d.sleepMin !== null).map((d) => d.sleepMin!))!, 0)
          : null,
        waist_change_cm:
          lastW && (before || inWeek.length > 1)
            ? round(Number(lastW.waist_cm) - Number((before ?? inWeek[0]).waist_cm), 1)
            : null,
      };
    });
  }, [days, b, readings]);

  const monthly = useMemo(() => {
    const months = [...new Set(days.map((d) => monthStartStr(d.date)))];
    return months.map((m, idx) => {
      const md = days.filter((d) => monthStartStr(d.date) === m);
      const first = md[0].date;
      const last = md[md.length - 1].date;
      const w = readings
        .filter((r) => r.date >= first && r.date <= last)
        .sort((a, z) => a.date.localeCompare(z.date));
      const meas = (b?.measurements ?? []).filter(
        (x) => x.measured_on >= first && x.measured_on <= last,
      );
      const waist = meas.filter((x) => x.waist_cm !== null);
      const bf = meas.filter((x) => x.body_fat_pct !== null);
      // Strength: best estimated 1RM per exercise this month vs previous month in the loaded data.
      const best = (from: string, to: string) => {
        const map = new Map<string, number>();
        for (const s of b?.sessions ?? []) {
          if (s.session_date < from || s.session_date > to || s.status === "skipped") continue;
          for (const e of s.workout_exercises) {
            const v = bestE1RM(e.workout_sets, e.measurement_type);
            if (v !== null) map.set(e.exercise_name, Math.max(map.get(e.exercise_name) ?? 0, v));
          }
        }
        return map;
      };
      const cur = best(first, last);
      const prevMonth = idx > 0 ? months[idx - 1] : null;
      const prev = prevMonth ? best(prevMonth, addDaysStr(m, -1)) : new Map<string, number>();
      const improvements = [...cur.entries()]
        .filter(([k]) => prev.has(k))
        .map(([k, v]) => ({ name: k, from: prev.get(k)!, to: v, diff: round(v - prev.get(k)!, 1) }))
        .sort((a, z) => z.diff - a.diff);
      const trainingPlanned = profileQ.data?.training_days_per_week
        ? round((profileQ.data.training_days_per_week / 7) * md.length, 0)
        : null;
      const workoutDays = new Set(md.filter((d) => d.workouts > 0).map((d) => d.date)).size;
      return {
        month: m,
        days: md.length,
        firstWeight: w[0] ?? null,
        lastWeight: w[w.length - 1] ?? null,
        avgWeight: w.length ? round(mean(w.map((x) => x.value))!, 2) : null,
        waistFrom: waist[0] ? Number(waist[0].waist_cm) : null,
        waistTo: waist.length > 1 ? Number(waist[waist.length - 1].waist_cm) : null,
        bfFrom: bf[0] ?? null,
        bfTo: bf.length > 1 ? bf[bf.length - 1] : null,
        improvements,
        workoutDays,
        trainingPlanned,
        foodDays: md.filter((d) => d.foodEntries > 0).length,
        photos: (photosQ.data ?? []).filter((p) => p.photo_date >= first && p.photo_date <= last)
          .length,
      };
    });
  }, [days, b, readings, photosQ.data, profileQ.data]);

  const ms = program ? milestones(program) : [];
  const msRows = ms.map((m) => {
    const actual = averageBetween(readings, addDaysStr(m.date, -6), m.date);
    return {
      ...m,
      actual,
      diff: actual !== null ? round(actual - m.target, 2) : null,
      future: m.date > today,
    };
  });

  const allLogged = b ? loggedDatesOf(b) : [];
  const streakOf = (pred: (d: DayRow) => boolean) =>
    streaks(
      (b?.days ?? []).filter(pred).map((d) => d.date),
      today,
    );
  const cons = [
    {
      label: "Any logging",
      s: streaks(allLogged, today),
      pct: consistencyPct(allLogged, range.range.from, range.range.to),
    },
    {
      label: "Weigh-ins",
      s: streakOf((d) => d.weight !== null),
      pct: consistencyPct(
        days.filter((d) => d.weight !== null).map((d) => d.date),
        range.range.from,
        range.range.to,
      ),
    },
    {
      label: "Nutrition",
      s: streakOf((d) => d.foodEntries > 0),
      pct: consistencyPct(
        days.filter((d) => d.foodEntries > 0).map((d) => d.date),
        range.range.from,
        range.range.to,
      ),
    },
    {
      label: "Water",
      s: streakOf((d) => d.waterMl !== null),
      pct: consistencyPct(
        days.filter((d) => d.waterMl !== null).map((d) => d.date),
        range.range.from,
        range.range.to,
      ),
    },
    {
      label: "Sleep",
      s: streakOf((d) => d.sleepMin !== null),
      pct: consistencyPct(
        days.filter((d) => d.sleepMin !== null).map((d) => d.date),
        range.range.from,
        range.range.to,
      ),
    },
  ];
  const weeksInRange = [...new Set(eachDay(range.range.from, range.range.to).map(weekStartStr))];
  const workoutWeeks = weeksInRange.map((wk) => ({
    date: wk,
    workouts: sum(
      (b?.days ?? []).filter((d) => weekStartStr(d.date) === wk).map((d) => d.workouts),
    ),
  }));
  const target = profileQ.data?.training_days_per_week ?? null;
  const weeksOnTarget = target ? workoutWeeks.filter((w) => w.workouts >= target).length : null;
  const earned = new Map((achQ.data ?? []).map((a) => [a.code, a]));

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Reports built only from your stored records. Empty cells mean nothing was recorded."
        actions={
          <>
            <DateRangeFilter state={range} />
            <Button size="sm" variant="secondary" onClick={printToPdf}>
              <FileText className="mr-1 h-4 w-4" /> PDF
            </Button>
          </>
        }
      />
      <div className="pp-print-only mb-4">
        <h1 className="text-xl font-bold">Prime Physique report</h1>
        <p className="text-sm">
          {fmtDate(range.range.from)} – {fmtDate(range.range.to)} · generated {fmtDate(today)}
        </p>
      </div>
      <Segmented
        className="mb-4 pp-no-print"
        value={tab}
        onChange={setTab}
        options={[
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly" },
          { value: "monthly", label: "Monthly" },
          { value: "milestones", label: "Milestones" },
          { value: "consistency", label: "Consistency" },
        ]}
      />
      {dailyQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {tab === "daily" && (
        <Panel
          title="Daily report"
          action={
            <Button
              size="sm"
              variant="outline"
              className="pp-no-print"
              onClick={() =>
                downloadCsv(
                  `prime-physique-daily-${range.range.from}-${range.range.to}.csv`,
                  dailyRows,
                )
              }
            >
              <Download className="mr-1 h-4 w-4" /> CSV
            </Button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead className="text-muted-foreground">
                <tr>
                  {[
                    "Date",
                    "Weight",
                    "7d avg",
                    "kcal",
                    "Protein",
                    "Carbs",
                    "Fat",
                    "Water L",
                    "Steps",
                    "Workout",
                    "Volume",
                    "Sleep",
                    "Waist",
                  ].map((h) => (
                    <th key={h} className="p-1 text-right first:text-left">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...days].reverse().map((d) => (
                  <tr key={d.date} className="border-t">
                    <td className="p-1 whitespace-nowrap">{fmtDate(d.date, "EEE d MMM")}</td>
                    <td className="p-1 text-right">
                      {d.weight !== null ? d.weight.toFixed(2) : ""}
                    </td>
                    <td className="p-1 text-right text-muted-foreground">
                      {d.avg7 !== null && d.weight !== null ? d.avg7.toFixed(2) : ""}
                    </td>
                    <td className="p-1 text-right">{d.kcal !== null ? fmtNum(d.kcal, 0) : ""}</td>
                    <td className="p-1 text-right">
                      {d.protein !== null ? fmtNum(d.protein, 0) : ""}
                    </td>
                    <td className="p-1 text-right">{d.carbs !== null ? fmtNum(d.carbs, 0) : ""}</td>
                    <td className="p-1 text-right">{d.fat !== null ? fmtNum(d.fat, 0) : ""}</td>
                    <td className="p-1 text-right">
                      {d.waterMl !== null ? fmtNum(d.waterMl / 1000, 2) : ""}
                    </td>
                    <td className="p-1 text-right">{d.steps !== null ? fmtNum(d.steps, 0) : ""}</td>
                    <td className="p-1 text-right">
                      {d.workouts ? `${d.workouts} · ${d.sets} sets` : ""}
                    </td>
                    <td className="p-1 text-right">{d.volume ? fmtNum(d.volume, 0) : ""}</td>
                    <td className="p-1 text-right">
                      {d.sleepMin !== null ? minutesToHM(d.sleepMin) : ""}
                    </td>
                    <td className="p-1 text-right">{d.waist !== null ? fmtNum(d.waist) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {tab === "weekly" && (
        <div className="space-y-4">
          <Panel
            title="Weekly weight trend"
            description="Ending weekly average vs the average of the previous 7 days."
          >
            <TimeChart
              data={weekly.map((w) => ({
                date: w.week_start,
                avg: w.end_avg_weight_kg,
                change: w.weight_trend_kg,
              }))}
              unit="kg"
              rightUnit="kg"
              series={[
                { key: "avg", label: "Weekly average", dot: true },
                {
                  key: "change",
                  label: "Change",
                  type: "bar",
                  yAxis: "right",
                  color: "var(--chart-3)",
                },
              ]}
            />
          </Panel>
          <Panel
            title="Weekly report"
            action={
              <Button
                size="sm"
                variant="outline"
                className="pp-no-print"
                onClick={() =>
                  downloadCsv(
                    `prime-physique-weekly-${range.range.from}-${range.range.to}.csv`,
                    weekly,
                  )
                }
              >
                <Download className="mr-1 h-4 w-4" /> CSV
              </Button>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs tabular-nums">
                <thead className="text-muted-foreground">
                  <tr>
                    {[
                      "Week of",
                      "Start avg",
                      "End avg",
                      "Trend",
                      "Avg kcal",
                      "Avg protein",
                      "Avg steps",
                      "Workouts",
                      "Volume kg",
                      "Cardio min",
                      "Avg sleep",
                      "Waist Δ",
                    ].map((h) => (
                      <th key={h} className="p-1 text-right first:text-left">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...weekly].reverse().map((w) => (
                    <tr key={w.week_start} className="border-t">
                      <td className="p-1">{fmtDate(w.week_start, "d MMM yy")}</td>
                      <td className="p-1 text-right">{w.start_avg_weight_kg?.toFixed(2) ?? "—"}</td>
                      <td className="p-1 text-right">{w.end_avg_weight_kg?.toFixed(2) ?? "—"}</td>
                      <td className="p-1 text-right">{signed(w.weight_trend_kg)}</td>
                      <td className="p-1 text-right">{w.avg_calories_kcal ?? "—"}</td>
                      <td className="p-1 text-right">{w.avg_protein_g ?? "—"}</td>
                      <td className="p-1 text-right">
                        {w.avg_steps !== null ? fmtNum(w.avg_steps, 0) : "—"}
                      </td>
                      <td className="p-1 text-right">{w.workouts}</td>
                      <td className="p-1 text-right">{fmtNum(w.volume_kg, 0)}</td>
                      <td className="p-1 text-right">{w.cardio_min}</td>
                      <td className="p-1 text-right">
                        {w.avg_sleep_min !== null ? minutesToHM(w.avg_sleep_min) : "—"}
                      </td>
                      <td className="p-1 text-right">{signed(w.waist_change_cm, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Averages use only days with records (e.g. average calories over days with food
              logged). Weight change reflects water, food and tissue — it is not a direct measure of
              fat change.
            </p>
          </Panel>
        </div>
      )}

      {tab === "monthly" && (
        <div className="space-y-4">
          <div className="flex justify-end pp-no-print">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                downloadCsv(
                  `prime-physique-monthly-${range.range.from}-${range.range.to}.csv`,
                  monthly.map((m) => ({
                    month: m.month,
                    days_in_range: m.days,
                    first_weight_kg: m.firstWeight?.value ?? null,
                    last_weight_kg: m.lastWeight?.value ?? null,
                    weight_change_kg:
                      m.firstWeight && m.lastWeight
                        ? round(m.lastWeight.value - m.firstWeight.value, 2)
                        : null,
                    avg_weight_kg: m.avgWeight,
                    waist_change_cm:
                      m.waistFrom !== null && m.waistTo !== null
                        ? round(m.waistTo - m.waistFrom, 1)
                        : null,
                    body_fat_change_pct:
                      m.bfFrom && m.bfTo
                        ? round(Number(m.bfTo.body_fat_pct) - Number(m.bfFrom.body_fat_pct), 1)
                        : null,
                    workout_days: m.workoutDays,
                    planned_training_days: m.trainingPlanned,
                    food_days_logged: m.foodDays,
                    progress_photos: m.photos,
                    strength_improvements: m.improvements
                      .map((i) => `${i.name} ${i.from}->${i.to}kg e1RM`)
                      .join("; "),
                  })),
                )
              }
            >
              <Download className="mr-1 h-4 w-4" /> CSV
            </Button>
          </div>
          {monthly.map((m) => (
            <Panel
              key={m.month}
              title={fmtDate(m.month, "MMMM yyyy")}
              description={`${m.days} days in selected range`}
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <MetricCard
                  label="Weight change"
                  value={
                    m.firstWeight && m.lastWeight && m.firstWeight.date !== m.lastWeight.date
                      ? signed(m.lastWeight.value - m.firstWeight.value)
                      : null
                  }
                  unit="kg"
                  kind="calculated"
                  sub={
                    m.firstWeight && m.lastWeight
                      ? `${m.firstWeight.value} → ${m.lastWeight.value} kg`
                      : "Needs 2 weigh-ins"
                  }
                />
                <MetricCard
                  label="Waist change"
                  value={
                    m.waistFrom !== null && m.waistTo !== null
                      ? signed(m.waistTo - m.waistFrom, 1)
                      : null
                  }
                  unit="cm"
                  kind="calculated"
                />
                <MetricCard
                  label="Body fat change"
                  value={
                    m.bfFrom && m.bfTo
                      ? signed(Number(m.bfTo.body_fat_pct) - Number(m.bfFrom.body_fat_pct), 1)
                      : null
                  }
                  unit="%"
                  kind={
                    m.bfFrom &&
                    BODY_FAT_METHODS.find((x) => x.value === m.bfFrom!.body_fat_method)?.measured
                      ? "measured"
                      : "estimated"
                  }
                  sub={
                    m.bfFrom && m.bfTo
                      ? m.bfFrom.body_fat_method !== m.bfTo.body_fat_method
                        ? "Different methods — not comparable"
                        : undefined
                      : "Not available"
                  }
                />
                <MetricCard
                  label="Workout consistency"
                  value={
                    m.trainingPlanned ? `${m.workoutDays}/${m.trainingPlanned}` : m.workoutDays
                  }
                  kind="calculated"
                  sub="Training days vs planned"
                />
                <MetricCard
                  label="Nutrition consistency"
                  value={`${m.foodDays}/${m.days}`}
                  kind="calculated"
                  sub="Days with food logged"
                />
                <MetricCard label="Progress photos" value={m.photos} kind="calculated" />
              </div>
              <div className="mt-3 text-sm">
                <div className="mb-1 font-medium">
                  Strength improvements (best estimated 1RM vs previous month)
                </div>
                {m.improvements.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No exercise was recorded in both this and the previous month within the selected
                    range.
                  </p>
                ) : (
                  <ul className="grid gap-1 text-xs sm:grid-cols-2">
                    {m.improvements.map((i) => (
                      <li key={i.name} className="tabular-nums">
                        {i.name}: {i.from} → {i.to} kg{" "}
                        <span
                          className={
                            i.diff > 0
                              ? "text-[var(--pp-good)]"
                              : i.diff < 0
                                ? "text-destructive"
                                : ""
                          }
                        >
                          ({signed(i.diff, 1)} kg)
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}

      {tab === "milestones" && (
        <Panel
          title="Weekly weight milestones"
          description="Linear mathematical projection from start to target — not a required rate or a guarantee. Never use crash dieting, dehydration or excessive exercise to meet a milestone."
          action={
            <Button
              size="sm"
              variant="outline"
              className="pp-no-print"
              onClick={() =>
                downloadCsv(
                  "prime-physique-milestones.csv",
                  msRows.map((m) => ({
                    week: m.week,
                    date: m.date,
                    projected_kg: m.target,
                    actual_7day_avg_kg: m.actual,
                    difference_kg: m.diff,
                  })),
                )
              }
            >
              <Download className="mr-1 h-4 w-4" /> CSV
            </Button>
          }
        >
          {!program ? (
            <p className="text-sm text-muted-foreground">Set up your programme in Settings.</p>
          ) : (
            <>
              <TimeChart
                data={msRows.map((m) => ({ date: m.date, projected: m.target, actual: m.actual }))}
                unit="kg"
                series={[
                  {
                    key: "projected",
                    label: "Projection",
                    dashed: true,
                    dot: true,
                    color: "var(--muted-foreground)",
                  },
                  { key: "actual", label: "Actual 7-day avg", dot: true },
                ]}
              />
              <table className="mt-3 w-full text-sm tabular-nums">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left">Week</th>
                    <th className="text-left">Date</th>
                    <th className="text-right">Projection</th>
                    <th className="text-right">Actual (7-day avg)</th>
                    <th className="text-right">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {msRows.map((m) => (
                    <tr
                      key={m.week}
                      className={`border-t ${m.future ? "text-muted-foreground" : ""}`}
                    >
                      <td className="py-1">{m.week === 0 ? "Start" : m.week}</td>
                      <td>{fmtDate(m.date, "dd MMM yyyy")}</td>
                      <td className="text-right">{m.target.toFixed(2)} kg</td>
                      <td className="text-right">
                        {m.actual !== null
                          ? `${m.actual.toFixed(2)} kg`
                          : m.future
                            ? "—"
                            : "no weigh-ins"}
                      </td>
                      <td className="text-right">
                        {m.diff !== null ? (
                          <span className={m.diff <= 0 ? "text-[var(--pp-good)]" : ""}>
                            {signed(m.diff)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 flex gap-2">
                <KindBadge kind="planned" /> <KindBadge kind="calculated" />
              </div>
            </>
          )}
        </Panel>
      )}

      {tab === "consistency" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {cons.map((c) => (
              <MetricCard
                key={c.label}
                label={c.label}
                value={c.s.current}
                unit="day streak"
                kind="calculated"
                sub={`Longest ${c.s.longest} · ${c.pct}% of days in range`}
              />
            ))}
            <MetricCard
              label="Workout weeks on plan"
              value={weeksOnTarget !== null ? `${weeksOnTarget}/${workoutWeeks.length}` : null}
              kind="calculated"
              sub={target ? `≥ ${target} workouts/week` : undefined}
            />
          </div>
          <Panel title="Workouts per week">
            <TimeChart
              data={workoutWeeks}
              series={[{ key: "workouts", label: "Workouts", type: "bar" }]}
              refLines={target ? [{ y: target, label: "Plan" }] : undefined}
            />
          </Panel>
          <Panel
            title={
              <span className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-primary" /> Achievements
              </span>
            }
            description="Awarded only when your stored records support them."
          >
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {ACHIEVEMENT_CATALOG.map((a) => {
                const e = earned.get(a.code);
                return (
                  <div
                    key={a.code}
                    className={`rounded-lg border p-3 ${e ? "border-primary/50 bg-primary/10" : "opacity-60"}`}
                  >
                    <div className="text-sm font-semibold">{a.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {e ? `${fmtDate(e.achieved_on)} — ${e.evidence}` : a.rule}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
