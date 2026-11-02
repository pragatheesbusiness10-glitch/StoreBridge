// Run with: bun test tests/unit
import { describe, expect, test } from "bun:test";
import {
  analyseWeights,
  bestE1RM,
  bmi,
  consistencyPct,
  estimated1RM,
  evaluateAchievements,
  exerciseTotals,
  gramsFromQuantity,
  lowCalorieWarning,
  macroEnergySplit,
  macrosFor,
  milestones,
  movingAverage,
  paceMinPerKm,
  programmeProgress,
  progressionAdvice,
  projectedWeightOn,
  streaks,
  targetStatus,
  trendKgPerWeek,
  weeklyAverages,
} from "../../src/lib/pp/calc";
import type { Program } from "../../src/lib/pp/types";

const program: Program = {
  id: "p",
  user_id: "u",
  name: "Prime Physique",
  start_date: "2026-11-03",
  start_weight_kg: 93.25,
  target_weight_kg: 78,
  duration_weeks: 13,
  is_active: true,
  notes: null,
};

describe("profile maths", () => {
  test("BMI for 93.25 kg / 178 cm", () => {
    expect(bmi(93.25, 178)).toBe(29.4);
    expect(bmi(null, 178)).toBeNull();
  });
  test("programme progress", () => {
    const p = programmeProgress(program, 90.25, "2026-11-24");
    expect(p.totalToLose).toBe(15.25);
    expect(p.lostSoFar).toBe(3);
    expect(p.remaining).toBe(12.25);
    expect(p.progressPct).toBe(19.7);
    expect(p.dayNumber).toBe(22);
    expect(p.completedDays).toBe(21);
    expect(p.totalDays).toBe(91);
    expect(p.remainingDays).toBe(70);
    expect(p.endDate).toBe("2027-02-02");
  });
  test("programme not started yet", () => {
    const p = programmeProgress(program, null, "2026-11-02");
    expect(p.dayNumber).toBe(0);
    expect(p.startsInDays).toBe(1);
    expect(p.lostSoFar).toBeNull();
  });
});

describe("milestones match the specification table", () => {
  const expected: [string, number][] = [
    ["2026-11-03", 93.25],
    ["2026-11-10", 92.08],
    ["2026-11-17", 90.9],
    ["2026-11-24", 89.73],
    ["2026-12-01", 88.56],
    ["2026-12-08", 87.38],
    ["2026-12-15", 86.21],
    ["2026-12-22", 85.04],
    ["2026-12-29", 83.87] /* spec table shows 83.86; exact value 83.8654 rounds to 83.87 */,
    ["2027-01-05", 82.69],
    ["2027-01-12", 81.52],
    ["2027-01-19", 80.35],
    ["2027-01-26", 79.17],
    ["2027-02-02", 78.0],
  ];
  const ms = milestones(program);
  test("14 rows", () => expect(ms.length).toBe(14));
  expected.forEach(([date, kg], i) => {
    test(`week ${i}: ${date} → ${kg}`, () => {
      expect(ms[i].date).toBe(date);
      expect(ms[i].target).toBe(kg);
    });
  });
  test("projection mid-week", () => {
    expect(projectedWeightOn(program, "2026-11-03")).toBe(93.25);
    expect(projectedWeightOn(program, "2030-01-01")).toBe(78);
  });
});

describe("weight series", () => {
  const readings = [
    { date: "2026-11-03", value: 93.2 },
    { date: "2026-11-04", value: 93.6 },
    { date: "2026-11-05", value: 92.9 },
    { date: "2026-11-07", value: 92.7 },
    { date: "2026-11-10", value: 92.5 },
    { date: "2026-11-11", value: 92.1 },
  ];
  test("7-day moving average uses calendar window", () => {
    const ma = movingAverage(readings);
    expect(ma[2].value).toBe(93.23); // (93.2+93.6+92.9)/3
    // window for 11-10 is 11-04..11-10 → 93.6, 92.9, 92.7, 92.5
    expect(ma[4]).toEqual({ date: "2026-11-10", value: 92.93, n: 4 });
  });
  test("analysis diffs", () => {
    const a = analyseWeights(readings, program);
    expect(a[0].diffPrev).toBeNull();
    expect(a[1].diffPrev).toBe(0.4);
    expect(a[3].prevGapDays).toBe(2);
    expect(a[5].diffStart).toBe(-1.15);
    expect(a[5].toTarget).toBe(14.1);
    // prev week window for 11-11 = 10-29..11-04 → 93.2, 93.6 = 93.4; current avg7 (11-05..11-11) = 92.55
    expect(a[5].diffPrevWeekAvg).toBe(-0.85);
  });
  test("weekly averages group by ISO week", () => {
    const w = weeklyAverages(readings);
    expect(w.map((x) => x.key)).toEqual(["2026-11-02", "2026-11-09"]);
    expect(w[0].n).toBe(4);
    expect(w[1].value).toBe(92.3);
  });
  test("trend requires enough data", () => {
    expect(trendKgPerWeek(readings.slice(0, 3))).toBeNull();
    const t = trendKgPerWeek(readings)!;
    expect(t).toBeLessThan(0);
  });
});

describe("nutrition", () => {
  const chickenRaw = {
    kcal_per_100g: 120,
    protein_per_100g: 22.5,
    carbs_per_100g: 0,
    fat_per_100g: 2.6,
    fibre_per_100g: 0,
  };
  const chickenCooked = {
    kcal_per_100g: 165,
    protein_per_100g: 31,
    carbs_per_100g: 0,
    fat_per_100g: 3.6,
    fibre_per_100g: 0,
  };
  test("formula: grams/100 × per-100 g", () => {
    expect(macrosFor(chickenRaw, 250)).toEqual({
      kcal: 300,
      protein: 56.25,
      carbs: 0,
      fat: 6.5,
      fibre: 0,
    });
  });
  test("raw vs cooked give different results for the same grams", () => {
    expect(macrosFor(chickenCooked, 250).kcal).toBe(412.5);
    expect(macrosFor(chickenCooked, 250).protein).not.toBe(macrosFor(chickenRaw, 250).protein);
  });
  test("dry soya chunks", () => {
    expect(
      macrosFor(
        {
          kcal_per_100g: 345,
          protein_per_100g: 52,
          carbs_per_100g: 33,
          fat_per_100g: 0.5,
          fibre_per_100g: 13,
        },
        50,
      ),
    ).toEqual({
      kcal: 172.5,
      protein: 26,
      carbs: 16.5,
      fat: 0.25,
      fibre: 6.5,
    });
  });
  test("unknown fibre stays unknown", () => {
    expect(macrosFor({ ...chickenRaw, fibre_per_100g: null }, 100).fibre).toBeNull();
  });
  test("unit conversions", () => {
    const egg = { unit_weight_g: 50, unit_label: "egg", default_serving_g: 100 };
    expect(gramsFromQuantity(3, "piece", egg)).toBe(150);
    expect(gramsFromQuantity(2, "serving", egg)).toBe(200);
    expect(
      gramsFromQuantity(1, "piece", {
        unit_weight_g: null,
        unit_label: null,
        default_serving_g: null,
      }),
    ).toBeNull();
    expect(
      gramsFromQuantity(1, "tbsp", {
        unit_weight_g: 13.5,
        unit_label: "tbsp",
        default_serving_g: 10,
      }),
    ).toBe(13.5);
    expect(
      gramsFromQuantity(2, "tbsp", {
        unit_weight_g: null,
        unit_label: null,
        default_serving_g: null,
      }),
    ).toBe(30);
    expect(gramsFromQuantity(0, "g", egg)).toBeNull();
  });
  test("macro energy split", () => {
    expect(macroEnergySplit(150, 200, 70)).toEqual({ protein: 30, carbs: 39, fat: 31 }); // 600 + 800 + 630 kcal;
  });
  test("target status", () => {
    expect(targetStatus(2100, 2200, 2300)).toBe("below");
    expect(targetStatus(2250, 2200, 2300)).toBe("within");
    expect(targetStatus(2400, 2200, 2300)).toBe("above");
    expect(targetStatus(2400, null, null)).toBe("none");
  });
  test("low calorie warning ignores unlogged days and today", () => {
    const days = [
      { date: "2026-11-05", kcal: 1200 },
      { date: "2026-11-06", kcal: 1300 },
      { date: "2026-11-08", kcal: 1100 }, // today: excluded
    ];
    expect(lowCalorieWarning(days, "2026-11-08", 1600)).toBeNull(); // only 2 complete days
    days.push({ date: "2026-11-07", kcal: 1400 });
    expect(lowCalorieWarning(days, "2026-11-08", 1600)).toEqual({ avg: 1300, days: 3 });
    expect(lowCalorieWarning(days, "2026-11-08", 1200)).toBeNull();
  });
});

describe("training", () => {
  const bench = [
    { weight_kg: 20, reps: 12, is_warmup: false },
    { weight_kg: 25, reps: 10, is_warmup: false },
    { weight_kg: 30, reps: 8, is_warmup: false },
  ];
  test("volume = Σ weight × reps of working sets", () => {
    expect(exerciseTotals(bench, "weight_reps")).toMatchObject({
      sets: 3,
      reps: 30,
      volume: 730,
      maxWeight: 30,
    });
  });
  test("warm-ups excluded from totals", () => {
    const t = exerciseTotals(
      [{ weight_kg: 10, reps: 15, is_warmup: true }, ...bench],
      "weight_reps",
    );
    expect(t.volume).toBe(730);
    expect(t.warmupSets).toBe(1);
  });
  test("assisted/bodyweight exercises carry no load volume", () => {
    expect(
      exerciseTotals([{ weight_kg: 40, reps: 8, is_warmup: false }], "assisted_reps").volume,
    ).toBe(0);
  });
  test("estimated 1RM (Epley) and limits", () => {
    expect(estimated1RM(30, 8)).toBe(38);
    expect(estimated1RM(100, 1)).toBe(100);
    expect(estimated1RM(50, 20)).toBeNull();
    expect(bestE1RM(bench, "weight_reps")).toBe(38);
  });
  const base = {
    measurementType: "weight_reps" as const,
    targetSets: 3,
    repsMin: 8,
    repsMax: 12,
    incrementKg: 2.5,
  };
  const topSets = [1, 2, 3].map(() => ({ weight_kg: 20, reps: 12, is_warmup: false }));
  test("progression: increase only when all sets hit top of range", () => {
    const a = progressionAdvice({
      ...base,
      last: { sets: topSets, pain: false, form: "good", difficulty: 7 },
    });
    expect(a.kind).toBe("increase");
    if (a.kind === "increase") expect(a.nextWeight).toBe(22.5);
  });
  test("progression: hold when reps fall short", () => {
    const a = progressionAdvice({
      ...base,
      last: { sets: bench, pain: false, form: "good", difficulty: 7 },
    });
    expect(a.kind).toBe("hold_reps");
  });
  test("progression: never increase after pain, poor form or max effort", () => {
    expect(
      progressionAdvice({
        ...base,
        last: { sets: topSets, pain: true, form: "good", difficulty: 6 },
      }).kind,
    ).toBe("hold_pain");
    expect(
      progressionAdvice({
        ...base,
        last: { sets: topSets, pain: false, form: "poor", difficulty: 6 },
      }).kind,
    ).toBe("hold_form");
    expect(
      progressionAdvice({
        ...base,
        last: { sets: topSets, pain: false, form: "good", difficulty: 10 },
      }).kind,
    ).toBe("hold_effort");
  });
  test("progression: no history", () => {
    expect(progressionAdvice({ ...base, last: null }).kind).toBe("no_history");
  });
});

describe("cardio, consistency, achievements", () => {
  test("pace", () => {
    expect(paceMinPerKm(30, 5)).toBe("6:00");
    expect(paceMinPerKm(25, 4)).toBe("6:15");
    expect(paceMinPerKm(30, null)).toBeNull();
  });
  test("streaks", () => {
    const s = streaks(
      ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06"],
      "2026-11-07",
    );
    expect(s).toEqual({ current: 2, longest: 3 });
    expect(streaks([], "2026-11-07")).toEqual({ current: 0, longest: 0 });
  });
  test("consistency %", () => {
    expect(consistencyPct(["2026-11-01", "2026-11-03"], "2026-11-01", "2026-11-04")).toBe(50);
  });
  test("achievements only from real records", () => {
    expect(
      evaluateAchievements({ program, weights: [], workoutDates: [], loggedDates: [] }),
    ).toEqual([]);
    const weights = [
      { date: "2026-11-03", value: 93.2 },
      { date: "2026-11-04", value: 91.0 }, // single low reading: must not award 1 kg on its own
      { date: "2026-11-10", value: 92.4 },
      { date: "2026-11-11", value: 92.2 },
      { date: "2026-11-12", value: 92.0 },
    ];
    const loggedDates = [
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
      "2026-11-09",
    ];
    const r = evaluateAchievements({ program, weights, workoutDates: ["2026-11-04"], loggedDates });
    const codes = r.map((x) => x.code);
    expect(codes).toContain("first_workout");
    expect(codes).toContain("seven_day_consistency");
    expect(r.find((x) => x.code === "seven_day_consistency")!.achieved_on).toBe("2026-11-09");
    // 11-12 window (11-06..11-12): 92.4, 92.2, 92.0 → 92.2 → 1.05 kg below 93.25
    expect(r.find((x) => x.code === "lost_1kg")!.achieved_on).toBe("2026-11-12");
    expect(codes).not.toContain("lost_5kg");
    expect(codes).not.toContain("day_30");
  });
});
