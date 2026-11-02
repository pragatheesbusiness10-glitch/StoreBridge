import { useQuery } from "@tanstack/react-query";
import { exerciseTotals, movingAverage, round, sum } from "./calc";
import { addDaysStr, eachDay, type DateStr } from "./dates";
import { db, qk, unwrap } from "./db";
import type {
  BodyMeasurement,
  CardioLog,
  NutritionSummary,
  SleepLog,
  StepLog,
  WaterLog,
  WeightLog,
  WorkoutExercise,
  WorkoutSession,
  WorkoutSet,
} from "./types";

export type SessionWithSets = WorkoutSession & {
  workout_exercises: (WorkoutExercise & { workout_sets: WorkoutSet[] })[];
};

export interface DayRow {
  date: DateStr;
  weight: number | null;
  eveningWeight: number | null;
  avg7: number | null;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fibre: number | null;
  foodG: number | null;
  foodEntries: number;
  chickenG: number | null;
  eggs: number | null;
  eggWhiteG: number | null;
  tofuG: number | null;
  soyaG: number | null;
  powderG: number | null;
  waterMl: number | null;
  steps: number | null;
  stepsSource: "daily_total" | "cardio_sum" | null;
  cardioMin: number | null;
  cardioKm: number | null;
  workouts: number;
  workoutsInProgress: number;
  exercises: number;
  sets: number;
  reps: number;
  volume: number | null;
  sleepMin: number | null;
  sleepQuality: number | null;
  waist: number | null;
  bodyFat: number | null;
  bodyFatMethod: string | null;
}

export interface DailyBundle {
  days: DayRow[];
  weights: WeightLog[]; // all weights (for trends beyond the window)
  measurements: BodyMeasurement[]; // all
  sessions: SessionWithSets[];
  cardio: CardioLog[];
  sleep: SleepLog[];
  water: WaterLog[];
  steps: StepLog[];
  nutrition: NutritionSummary[];
}

/** Totals of a session (working sets only). */
export function sessionTotals(s: SessionWithSets) {
  let sets = 0;
  let reps = 0;
  let volume = 0;
  let exercises = 0;
  for (const e of s.workout_exercises) {
    const t = exerciseTotals(e.workout_sets, e.measurement_type);
    if (e.workout_sets.length) exercises++;
    sets += t.sets;
    reps += t.reps;
    volume += t.volume;
  }
  return { sets, reps, volume: round(volume, 1), exercises };
}

export async function fetchDaily(from: DateStr, to: DateStr): Promise<DailyBundle> {
  const [weights, measurements, nutrition, water, sessions, cardio, steps, sleep] =
    await Promise.all([
      unwrap<WeightLog[]>(db.from("daily_weight_logs").select("*").order("log_date").limit(5000)),
      unwrap<BodyMeasurement[]>(
        db.from("daily_body_measurements").select("*").order("measured_on").limit(5000),
      ),
      unwrap<NutritionSummary[]>(
        db
          .from("daily_nutrition_summaries")
          .select("*")
          .gte("entry_date", from)
          .lte("entry_date", to),
      ),
      unwrap<WaterLog[]>(
        db.from("water_logs").select("*").gte("log_date", from).lte("log_date", to),
      ),
      unwrap<SessionWithSets[]>(
        db
          .from("workout_sessions")
          .select("*, workout_exercises(*, workout_sets(*))")
          .gte("session_date", from)
          .lte("session_date", to)
          .order("session_date"),
      ),
      unwrap<CardioLog[]>(
        db.from("cardio_logs").select("*").gte("log_date", from).lte("log_date", to),
      ),
      unwrap<StepLog[]>(db.from("step_logs").select("*").gte("log_date", from).lte("log_date", to)),
      unwrap<SleepLog[]>(
        db.from("sleep_logs").select("*").gte("sleep_date", from).lte("sleep_date", to),
      ),
    ]);

  const ma = new Map(
    movingAverage(
      weights.map((w) => ({ date: w.log_date, value: Number(w.morning_weight_kg) })),
    ).map((m) => [m.date, m.value]),
  );
  const byDate = <T>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return m;
  };
  const wMap = new Map(weights.map((w) => [w.log_date, w]));
  const mMap = new Map(measurements.map((m) => [m.measured_on, m]));
  const nMap = new Map(nutrition.map((n) => [n.entry_date, n]));
  const waterMap = byDate(water, (w) => w.log_date);
  const sessMap = byDate(sessions, (s) => s.session_date);
  const cardioMap = byDate(cardio, (c) => c.log_date);
  const stepMap = new Map(steps.map((s) => [s.log_date, s]));
  const sleepMap = new Map(sleep.map((s) => [s.sleep_date, s]));

  const days: DayRow[] = eachDay(from, to).map((date) => {
    const w = wMap.get(date);
    const n = nMap.get(date);
    const meas = mMap.get(date);
    const wl = waterMap.get(date);
    const ss = sessMap.get(date) ?? [];
    const done = ss.filter((s) => s.status === "completed");
    const counted = ss.filter((s) => s.status !== "skipped");
    const totals = counted.map(sessionTotals);
    const cl = cardioMap.get(date);
    const st = stepMap.get(date);
    const cardioSteps = cl ? sum(cl.map((c) => Number(c.steps) || 0)) : 0;
    const sl = sleepMap.get(date);
    return {
      date,
      weight: w ? Number(w.morning_weight_kg) : null,
      eveningWeight: w?.evening_weight_kg ? Number(w.evening_weight_kg) : null,
      avg7: ma.get(date) ?? null,
      kcal: n ? Number(n.kcal) : null,
      protein: n ? Number(n.protein_g) : null,
      carbs: n ? Number(n.carbs_g) : null,
      fat: n ? Number(n.fat_g) : null,
      fibre: n && n.fibre_g !== null ? Number(n.fibre_g) : null,
      foodG: n ? Number(n.total_food_g) : null,
      foodEntries: n ? n.entry_count : 0,
      chickenG: n ? Number(n.chicken_g) : null,
      eggs: n ? Number(n.whole_egg_count) : null,
      eggWhiteG: n ? Number(n.egg_white_g) : null,
      tofuG: n ? Number(n.tofu_g) : null,
      soyaG: n ? Number(n.soya_g) : null,
      powderG: n ? Number(n.protein_powder_g) : null,
      waterMl: wl ? sum(wl.map((x) => x.amount_ml)) : null,
      // A whole-day step count (from phone/watch) already includes walking sessions, so it wins;
      // otherwise fall back to the sum of steps recorded on cardio sessions. Never both (no double counting).
      steps: st ? st.steps : cardioSteps > 0 ? cardioSteps : null,
      stepsSource: st ? "daily_total" : cardioSteps > 0 ? "cardio_sum" : null,
      cardioMin: cl ? round(sum(cl.map((c) => Number(c.duration_minutes))), 1) : null,
      cardioKm:
        cl && cl.some((c) => c.distance_km !== null)
          ? round(sum(cl.map((c) => Number(c.distance_km) || 0)), 2)
          : null,
      workouts: done.length,
      workoutsInProgress: ss.filter((s) => s.status === "in_progress").length,
      exercises: sum(totals.map((t) => t.exercises)),
      sets: sum(totals.map((t) => t.sets)),
      reps: sum(totals.map((t) => t.reps)),
      volume: totals.length ? round(sum(totals.map((t) => t.volume)), 1) : null,
      sleepMin: sl ? sl.duration_minutes : null,
      sleepQuality: sl?.quality_rating ?? null,
      waist: meas?.waist_cm ? Number(meas.waist_cm) : null,
      bodyFat: meas?.body_fat_pct ? Number(meas.body_fat_pct) : null,
      bodyFatMethod: meas?.body_fat_method ?? null,
    };
  });

  return { days, weights, measurements, sessions, cardio, sleep, water, steps, nutrition };
}

export function useDaily(from: DateStr, to: DateStr) {
  return useQuery({ queryKey: qk("daily", from, to), queryFn: () => fetchDaily(from, to) });
}

/** Latest non-null value on or before a date. */
export function latestOnOrBefore<T>(
  rows: T[],
  dateOf: (r: T) => string,
  valueOf: (r: T) => number | null,
  date: DateStr,
) {
  const c = rows
    .filter((r) => dateOf(r) <= date && valueOf(r) !== null)
    .sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  return c.length ? { date: dateOf(c[0]), value: valueOf(c[0]) as number } : null;
}

export const yesterday = (d: DateStr) => addDaysStr(d, -1);
