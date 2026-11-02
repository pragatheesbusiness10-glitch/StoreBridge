// Pure calculation helpers for Prime Physique. No I/O; fully unit-tested in tests/unit.
import {
  addDaysStr,
  daysBetween,
  eachDay,
  monthStartStr,
  weekStartStr,
  type DateStr,
} from "./dates";
import type { FoodItem, MeasurementType, Program, QuantityUnit } from "./types";

export const round = (n: number, dp = 1) => {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
};
export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);

// ------------------------------------------------------------------ body

export function bmi(weightKg: number | null, heightCm: number | null): number | null {
  if (!weightKg || !heightCm) return null;
  const m = heightCm / 100;
  return round(weightKg / (m * m), 1);
}

export function bmiCategory(b: number | null): string | null {
  if (b === null) return null;
  if (b < 18.5) return "Underweight";
  if (b < 25) return "Healthy range";
  if (b < 30) return "Overweight";
  return "Obese range";
}

export interface ProgrammeProgress {
  totalToLose: number;
  lostSoFar: number | null;
  remaining: number | null;
  progressPct: number | null;
  totalDays: number;
  dayNumber: number; // 0 if not started yet
  completedDays: number;
  remainingDays: number;
  startsInDays: number; // > 0 if start is in the future
  endDate: DateStr;
}

/** Progress against the programme. `currentWeight` is the latest measured weight (or null). */
export function programmeProgress(
  p: Program,
  currentWeight: number | null,
  today: DateStr,
): ProgrammeProgress {
  const start = Number(p.start_weight_kg);
  const target = Number(p.target_weight_kg);
  const totalToLose = round(start - target, 2);
  const lostSoFar = currentWeight === null ? null : round(start - currentWeight, 2);
  const remaining = currentWeight === null ? null : round(currentWeight - target, 2);
  const progressPct =
    lostSoFar === null || totalToLose === 0
      ? null
      : Math.max(0, round((lostSoFar / totalToLose) * 100, 1));
  const totalDays = p.duration_weeks * 7;
  const diff = daysBetween(p.start_date, today);
  const dayNumber = diff < 0 ? 0 : diff + 1;
  const completedDays = Math.min(Math.max(diff, 0), totalDays);
  return {
    totalToLose,
    lostSoFar,
    remaining,
    progressPct,
    totalDays,
    dayNumber,
    completedDays,
    remainingDays: Math.max(totalDays - completedDays, 0),
    startsInDays: diff < 0 ? -diff : 0,
    endDate: addDaysStr(p.start_date, totalDays),
  };
}

export interface Milestone {
  week: number;
  date: DateStr;
  target: number;
}

/** Linear mathematical projection from start to target weight. Not a prescription. */
export function milestones(p: Program): Milestone[] {
  const start = Number(p.start_weight_kg);
  const target = Number(p.target_weight_kg);
  const out: Milestone[] = [];
  for (let w = 0; w <= p.duration_weeks; w++) {
    out.push({
      week: w,
      date: addDaysStr(p.start_date, w * 7),
      target: round(start - ((start - target) * w) / p.duration_weeks, 2),
    });
  }
  return out;
}

/** Projected target weight on any date (clamped to the programme window). */
export function projectedWeightOn(p: Program, date: DateStr): number {
  const totalDays = p.duration_weeks * 7;
  const d = Math.min(Math.max(daysBetween(p.start_date, date), 0), totalDays);
  const start = Number(p.start_weight_kg);
  const target = Number(p.target_weight_kg);
  return round(start - ((start - target) * d) / totalDays, 2);
}

export function weeklyRateKg(p: Program): number {
  return round((Number(p.start_weight_kg) - Number(p.target_weight_kg)) / p.duration_weeks, 2);
}

/** Percent of body weight per week the plan implies (for safety messaging). */
export function weeklyRatePct(p: Program): number {
  return round((weeklyRateKg(p) / Number(p.start_weight_kg)) * 100, 2);
}

// ------------------------------------------------------------------ weight series

export interface Reading {
  date: DateStr;
  value: number;
}

/** Trailing calendar-window average (default 7 days) for each reading date. */
export function movingAverage(
  readings: Reading[],
  windowDays = 7,
): { date: DateStr; value: number; n: number }[] {
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((r) => {
    const from = addDaysStr(r.date, -(windowDays - 1));
    const inWin = sorted.filter((x) => x.date >= from && x.date <= r.date);
    return { date: r.date, value: round(mean(inWin.map((x) => x.value))!, 2), n: inWin.length };
  });
}

export function averageBetween(readings: Reading[], from: DateStr, to: DateStr): number | null {
  const vals = readings.filter((r) => r.date >= from && r.date <= to).map((r) => r.value);
  const m = mean(vals);
  return m === null ? null : round(m, 2);
}

export function groupAverage(
  readings: Reading[],
  keyFn: (d: DateStr) => DateStr,
): { key: DateStr; value: number; n: number; min: number; max: number }[] {
  const map = new Map<DateStr, number[]>();
  for (const r of readings) {
    const k = keyFn(r.date);
    map.set(k, [...(map.get(k) ?? []), r.value]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, vals]) => ({
      key,
      value: round(mean(vals)!, 2),
      n: vals.length,
      min: Math.min(...vals),
      max: Math.max(...vals),
    }));
}
export const weeklyAverages = (r: Reading[]) => groupAverage(r, weekStartStr);
export const monthlyAverages = (r: Reading[]) => groupAverage(r, monthStartStr);

/** Least-squares slope in kg per week. Needs ≥ 5 readings spanning ≥ 7 days to be meaningful. */
export function trendKgPerWeek(readings: Reading[]): number | null {
  if (readings.length < 5) return null;
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  const t0 = sorted[0].date;
  if (daysBetween(t0, sorted[sorted.length - 1].date) < 7) return null;
  const xs = sorted.map((r) => daysBetween(t0, r.date));
  const ys = sorted.map((r) => r.value);
  const mx = mean(xs)!;
  const my = mean(ys)!;
  let numr = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    numr += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return null;
  return round((numr / den) * 7, 2);
}

export function describeTrend(kgPerWeek: number | null): string {
  if (kgPerWeek === null) return "Not enough data yet (needs ≥ 5 weigh-ins over ≥ 7 days)";
  if (Math.abs(kgPerWeek) < 0.1) return "Stable";
  return kgPerWeek < 0
    ? `Trending down ${Math.abs(kgPerWeek).toFixed(2)} kg/week`
    : `Trending up ${kgPerWeek.toFixed(2)} kg/week`;
}

export interface WeightRowAnalysis {
  date: DateStr;
  weight: number;
  diffPrev: number | null;
  prevGapDays: number | null;
  diffStart: number | null;
  avg7: number;
  avg7n: number;
  diffPrevWeekAvg: number | null;
  toTarget: number | null;
}

export function analyseWeights(readings: Reading[], program: Program | null): WeightRowAnalysis[] {
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  const ma = movingAverage(sorted);
  return sorted.map((r, i) => {
    const prev = i > 0 ? sorted[i - 1] : null;
    const prevWeekAvg = averageBetween(sorted, addDaysStr(r.date, -13), addDaysStr(r.date, -7));
    return {
      date: r.date,
      weight: r.value,
      diffPrev: prev ? round(r.value - prev.value, 2) : null,
      prevGapDays: prev ? daysBetween(prev.date, r.date) : null,
      diffStart: program ? round(r.value - Number(program.start_weight_kg), 2) : null,
      avg7: ma[i].value,
      avg7n: ma[i].n,
      diffPrevWeekAvg: prevWeekAvg === null ? null : round(ma[i].value - prevWeekAvg, 2),
      toTarget: program ? round(r.value - Number(program.target_weight_kg), 2) : null,
    };
  });
}

// ------------------------------------------------------------------ nutrition

/** Nutrient amount = (grams / 100) × value per 100 g */
export const scalePer100 = (grams: number, per100: number) => (grams / 100) * per100;

export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number | null;
}

export function macrosFor(
  food: Pick<
    FoodItem,
    "kcal_per_100g" | "protein_per_100g" | "carbs_per_100g" | "fat_per_100g" | "fibre_per_100g"
  >,
  grams: number,
): Macros {
  return {
    kcal: round(scalePer100(grams, Number(food.kcal_per_100g)), 1),
    protein: round(scalePer100(grams, Number(food.protein_per_100g)), 2),
    carbs: round(scalePer100(grams, Number(food.carbs_per_100g)), 2),
    fat: round(scalePer100(grams, Number(food.fat_per_100g)), 2),
    fibre:
      food.fibre_per_100g === null
        ? null
        : round(scalePer100(grams, Number(food.fibre_per_100g)), 2),
  };
}

/**
 * Convert a quantity in the chosen unit to grams for a given food.
 * Returns null if the conversion is not defined (e.g. "piece" for a food with no unit weight),
 * in which case the user must enter grams directly. Volume units assume 1 ml ≈ 1 g unless the
 * food defines its own unit weight for that unit.
 */
export function gramsFromQuantity(
  quantity: number,
  unit: QuantityUnit,
  food: Pick<FoodItem, "unit_weight_g" | "unit_label" | "default_serving_g">,
): number | null {
  if (!(quantity > 0)) return null;
  const uw = food.unit_weight_g === null ? null : Number(food.unit_weight_g);
  switch (unit) {
    case "g":
    case "ml":
      return round(quantity, 1);
    case "piece":
      return uw ? round(quantity * uw, 1) : null;
    case "serving":
      return food.default_serving_g ? round(quantity * Number(food.default_serving_g), 1) : null;
    case "tbsp":
      return round(quantity * (food.unit_label === "tbsp" && uw ? uw : 15), 1);
    case "tsp":
      return round(quantity * (food.unit_label === "tsp" && uw ? uw : 5), 1);
    case "cup":
      return round(quantity * (food.unit_label === "cup" && uw ? uw : 240), 1);
  }
}

/** Macro energy split (protein/carbs 4 kcal/g, fat 9 kcal/g). */
export function macroEnergySplit(protein: number, carbs: number, fat: number) {
  const p = protein * 4;
  const c = carbs * 4;
  const f = fat * 9;
  const total = p + c + f;
  if (total === 0) return { protein: 0, carbs: 0, fat: 0 };
  return {
    protein: round((p / total) * 100, 0),
    carbs: round((c / total) * 100, 0),
    fat: round((f / total) * 100, 0),
  };
}

export type TargetStatus = "none" | "below" | "within" | "above";
export function targetStatus(
  value: number | null,
  min: number | null,
  max: number | null,
): TargetStatus {
  if (value === null || (min === null && max === null)) return "none";
  if (min !== null && value < min) return "below";
  if (max !== null && value > max) return "above";
  return "within";
}

/**
 * Persistent low intake warning: average over the days that actually have food logged in the
 * last 7 days, requiring at least 3 logged days. Unlogged days are not treated as zero.
 */
export function lowCalorieWarning(
  dailyKcal: { date: DateStr; kcal: number }[],
  today: DateStr,
  thresholdKcal: number,
): { avg: number; days: number } | null {
  const from = addDaysStr(today, -6);
  // Exclude today: it is usually incomplete.
  const days = dailyKcal.filter((d) => d.date >= from && d.date < today && d.kcal > 0);
  if (days.length < 3) return null;
  const avg = round(mean(days.map((d) => d.kcal))!, 0);
  return avg < thresholdKcal ? { avg, days: days.length } : null;
}

// ------------------------------------------------------------------ training

export interface SetLike {
  weight_kg: number | null;
  reps: number | null;
  duration_seconds?: number | null;
  is_warmup: boolean;
}

/** Load-volume counts only working sets of load-bearing exercises (weight × reps). */
export function countsTowardVolume(mt: MeasurementType) {
  return mt === "weight_reps";
}

export function setVolume(s: SetLike, mt: MeasurementType): number {
  if (s.is_warmup || !countsTowardVolume(mt)) return 0;
  return (Number(s.weight_kg) || 0) * (Number(s.reps) || 0);
}

export function exerciseTotals(sets: SetLike[], mt: MeasurementType) {
  const working = sets.filter((s) => !s.is_warmup);
  return {
    sets: working.length,
    warmupSets: sets.length - working.length,
    reps: sum(working.map((s) => Number(s.reps) || 0)),
    volume: round(sum(sets.map((s) => setVolume(s, mt))), 1),
    maxWeight:
      countsTowardVolume(mt) && working.length
        ? Math.max(...working.map((s) => Number(s.weight_kg) || 0))
        : null,
    seconds: sum(working.map((s) => Number(s.duration_seconds) || 0)),
  };
}

/**
 * Estimated one-repetition maximum (Epley: w × (1 + reps / 30)).
 * An ESTIMATE only; returns null outside 1–12 reps where the formula is unreliable.
 */
export function estimated1RM(weight: number | null, reps: number | null): number | null {
  const w = Number(weight);
  const r = Number(reps);
  if (!(w > 0) || !(r >= 1) || r > 12) return null;
  if (r === 1) return round(w, 1);
  return round(w * (1 + r / 30), 1);
}

export function bestE1RM(sets: SetLike[], mt: MeasurementType): number | null {
  if (!countsTowardVolume(mt)) return null;
  const vals = sets
    .filter((s) => !s.is_warmup)
    .map((s) => estimated1RM(s.weight_kg, s.reps))
    .filter((v): v is number => v !== null);
  return vals.length ? Math.max(...vals) : null;
}

export type ProgressionAdvice =
  | { kind: "no_history"; message: string }
  | { kind: "hold_pain"; message: string }
  | { kind: "hold_form"; message: string }
  | { kind: "hold_effort"; message: string }
  | { kind: "hold_reps"; message: string; referenceWeight: number | null }
  | { kind: "increase"; message: string; referenceWeight: number; nextWeight: number }
  | { kind: "time_progress"; message: string };

/**
 * Gradual double-progression advice from the LAST actual performance. It is a reference only:
 * never applied automatically, and never suggests an increase after pain, poor form or a
 * near-maximal effort rating.
 */
export function progressionAdvice(args: {
  measurementType: MeasurementType;
  targetSets: number;
  repsMin: number | null;
  repsMax: number | null;
  incrementKg: number;
  last: {
    sets: SetLike[];
    pain: boolean;
    form: "good" | "fair" | "poor" | null;
    difficulty: number | null;
  } | null;
}): ProgressionAdvice {
  const { last } = args;
  if (!last || last.sets.filter((s) => !s.is_warmup).length === 0) {
    return {
      kind: "no_history",
      message:
        "No previous performance. Choose a weight you can control for the full rep range; record what you actually lift.",
    };
  }
  if (last.pain)
    return {
      kind: "hold_pain",
      message:
        "Pain was reported last time. Do not increase load. Reduce or skip this exercise and seek professional advice if pain persists.",
    };
  if (last.form === "poor")
    return {
      kind: "hold_form",
      message:
        "Form was rated poor last time. Keep the same weight (or reduce) and focus on technique.",
    };
  if (last.difficulty !== null && last.difficulty >= 9) {
    return {
      kind: "hold_effort",
      message:
        "Last session was rated near-maximal effort (≥ 9/10). Repeat the weight before progressing.",
    };
  }
  const working = last.sets.filter((s) => !s.is_warmup);
  if (args.measurementType === "time") {
    return {
      kind: "time_progress",
      message: "Try adding a few seconds per hold when the previous duration felt controlled.",
    };
  }
  if (args.measurementType !== "weight_reps") {
    return {
      kind: "hold_reps",
      message: "Aim to add a rep (or reduce assistance) while keeping good form.",
      referenceWeight: null,
    };
  }
  const topWeight = Math.max(...working.map((s) => Number(s.weight_kg) || 0));
  const atTop = working.filter((s) => (Number(s.weight_kg) || 0) === topWeight);
  const enoughSets = atTop.length >= args.targetSets;
  const allHitTop =
    args.repsMax !== null && atTop.every((s) => (Number(s.reps) || 0) >= args.repsMax!);
  if (enoughSets && allHitTop && args.incrementKg > 0 && topWeight > 0) {
    return {
      kind: "increase",
      referenceWeight: topWeight,
      nextWeight: round(topWeight + args.incrementKg, 2),
      message: `All ${args.targetSets} sets reached ${args.repsMax} reps at ${topWeight} kg. You may try ${round(topWeight + args.incrementKg, 2)} kg if recovery is good.`,
    };
  }
  return {
    kind: "hold_reps",
    referenceWeight: topWeight || null,
    message: `Stay at ${topWeight} kg and aim for ${args.repsMax ?? "more"} reps on all ${args.targetSets} sets before adding weight.`,
  };
}

// ------------------------------------------------------------------ cardio / sleep

/** Average pace in minutes per km, formatted m:ss. */
export function paceMinPerKm(durationMin: number, distanceKm: number | null): string | null {
  if (!distanceKm || distanceKm <= 0 || !(durationMin > 0)) return null;
  const pace = durationMin / distanceKm;
  const m = Math.floor(pace);
  const s = Math.round((pace - m) * 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`;
}

/** Bedtime on the evening before the wake date when the clock time is later than the wake time. */
export function sleepWindow(wakeDate: string, bed: string, wake: string) {
  const bedDate = bed >= wake ? addDaysStr(wakeDate, -1) : wakeDate;
  const bedtime = new Date(`${bedDate}T${bed}:00`);
  const wakeTime = new Date(`${wakeDate}T${wake}:00`);
  return {
    bedtime,
    wakeTime,
    minutes: Math.round((wakeTime.getTime() - bedtime.getTime()) / 60000),
  };
}

export const minutesToHM = (min: number | null) => {
  if (min === null || !Number.isFinite(min)) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
};

// ------------------------------------------------------------------ consistency

/** Current (ending today, or yesterday if today has nothing yet) and longest daily streaks. */
export function streaks(dates: Iterable<DateStr>, today: DateStr) {
  const set = new Set(dates);
  const sorted = [...set].sort();
  let longest = 0;
  let run = 0;
  let prev: DateStr | null = null;
  for (const d of sorted) {
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  let current = 0;
  let cursor = set.has(today) ? today : addDaysStr(today, -1);
  while (set.has(cursor)) {
    current++;
    cursor = addDaysStr(cursor, -1);
  }
  return { current, longest };
}

export function consistencyPct(dates: Iterable<DateStr>, from: DateStr, to: DateStr) {
  const set = new Set(dates);
  const days = eachDay(from, to);
  if (!days.length) return 0;
  return round((days.filter((d) => set.has(d)).length / days.length) * 100, 0);
}

// ------------------------------------------------------------------ achievements

export interface AchievementResult {
  code: string;
  title: string;
  achieved_on: DateStr;
  evidence: string;
}

/**
 * Achievements are derived strictly from stored records. Weight-loss milestones use the 7-day
 * moving average (with at least 3 weigh-ins in the window) so a single low reading cannot award one.
 */
export function evaluateAchievements(input: {
  program: Program | null;
  weights: Reading[];
  workoutDates: DateStr[]; // completed sessions with ≥ 1 recorded set
  loggedDates: DateStr[]; // any record of any kind
}): AchievementResult[] {
  const out: AchievementResult[] = [];
  const wd = [...input.workoutDates].sort();
  if (wd.length)
    out.push({
      code: "first_workout",
      title: "First workout",
      achieved_on: wd[0],
      evidence: `Completed workout on ${wd[0]}`,
    });

  const logged = [...new Set(input.loggedDates)].sort();
  let run = 0;
  for (let i = 0; i < logged.length; i++) {
    run = i > 0 && daysBetween(logged[i - 1], logged[i]) === 1 ? run + 1 : 1;
    if (run === 7) {
      out.push({
        code: "seven_day_consistency",
        title: "Seven-day consistency",
        achieved_on: logged[i],
        evidence: `Records logged on 7 consecutive days ending ${logged[i]}`,
      });
      break;
    }
  }

  const p = input.program;
  if (p) {
    const ma = movingAverage(input.weights).filter((m) => m.n >= 3 && m.date >= p.start_date);
    const firstAt = (pred: (v: number) => boolean) => ma.find((m) => pred(m.value));
    const start = Number(p.start_weight_kg);
    for (const kg of [1, 5, 10]) {
      const hit = firstAt((v) => start - v >= kg);
      if (hit)
        out.push({
          code: `lost_${kg}kg`,
          title: `First ${kg} kg lost`,
          achieved_on: hit.date,
          evidence: `7-day average ${hit.value} kg on ${hit.date} (${hit.n} weigh-ins) vs start ${start} kg`,
        });
    }
    for (const kg of [85, 80, 78]) {
      if (start <= kg) continue;
      const hit = firstAt((v) => v <= kg);
      if (hit)
        out.push({
          code: `reached_${kg}kg`,
          title: `${kg} kg milestone`,
          achieved_on: hit.date,
          evidence: `7-day average ${hit.value} kg on ${hit.date} (${hit.n} weigh-ins)`,
        });
    }
    for (const d of [30, 60, 90]) {
      const dayDate = addDaysStr(p.start_date, d - 1);
      const rec = logged.find((x) => x >= dayDate);
      if (rec)
        out.push({
          code: `day_${d}`,
          title: `${d}-day milestone`,
          achieved_on: rec,
          evidence: `Records logged on programme day ${daysBetween(p.start_date, rec) + 1}`,
        });
    }
  }
  return out;
}

export const ACHIEVEMENT_CATALOG: { code: string; title: string; rule: string }[] = [
  {
    code: "first_workout",
    title: "First workout",
    rule: "Complete a workout with at least one recorded set.",
  },
  {
    code: "seven_day_consistency",
    title: "Seven-day consistency",
    rule: "Log any record on 7 consecutive days.",
  },
  {
    code: "lost_1kg",
    title: "First 1 kg lost",
    rule: "7-day average (≥ 3 weigh-ins) 1 kg below start.",
  },
  {
    code: "lost_5kg",
    title: "First 5 kg lost",
    rule: "7-day average (≥ 3 weigh-ins) 5 kg below start.",
  },
  {
    code: "lost_10kg",
    title: "First 10 kg lost",
    rule: "7-day average (≥ 3 weigh-ins) 10 kg below start.",
  },
  { code: "day_30", title: "30-day milestone", rule: "Log records on or after programme day 30." },
  { code: "day_60", title: "60-day milestone", rule: "Log records on or after programme day 60." },
  { code: "day_90", title: "90-day milestone", rule: "Log records on or after programme day 90." },
  { code: "reached_85kg", title: "85 kg milestone", rule: "7-day average at or below 85 kg." },
  { code: "reached_80kg", title: "80 kg milestone", rule: "7-day average at or below 80 kg." },
  { code: "reached_78kg", title: "78 kg milestone", rule: "7-day average at or below 78 kg." },
];
