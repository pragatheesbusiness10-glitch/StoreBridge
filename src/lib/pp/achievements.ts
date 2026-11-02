import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { evaluateAchievements } from "./calc";
import type { DailyBundle } from "./daily";
import { db } from "./db";
import type { Achievement, Program } from "./types";

export function loggedDatesOf(b: DailyBundle): string[] {
  const s = new Set<string>();
  b.weights.forEach((w) => s.add(w.log_date));
  b.measurements.forEach((m) => s.add(m.measured_on));
  b.days.forEach((d) => {
    if (
      d.foodEntries > 0 ||
      d.waterMl !== null ||
      d.sleepMin !== null ||
      d.cardioMin !== null ||
      d.steps !== null ||
      d.workouts > 0 ||
      d.sets > 0
    )
      s.add(d.date);
  });
  return [...s];
}

export function workoutDatesOf(b: DailyBundle): string[] {
  return b.sessions
    .filter(
      (s) => s.status === "completed" && s.workout_exercises.some((e) => e.workout_sets.length > 0),
    )
    .map((s) => s.session_date);
}

/**
 * Keep the achievements table in sync with what the records actually support:
 * award newly supported achievements and revoke any whose supporting records were deleted.
 */
export function useAchievementSync(
  bundle: DailyBundle | undefined,
  program: Program | null | undefined,
  existing: Achievement[] | undefined,
) {
  const qc = useQueryClient();
  const running = useRef(false);
  useEffect(() => {
    if (!bundle || !program || !existing || running.current) return;
    const computed = evaluateAchievements({
      program,
      weights: bundle.weights.map((w) => ({
        date: w.log_date,
        value: Number(w.morning_weight_kg),
      })),
      workoutDates: workoutDatesOf(bundle),
      loggedDates: loggedDatesOf(bundle),
    });
    const have = new Map(existing.map((a) => [a.code, a]));
    const want = new Map(computed.map((a) => [a.code, a]));
    const toAdd = computed.filter(
      (a) => !have.has(a.code) || have.get(a.code)!.achieved_on !== a.achieved_on,
    );
    const toRemove = existing.filter((a) => !want.has(a.code));
    if (!toAdd.length && !toRemove.length) return;
    running.current = true;
    (async () => {
      if (toRemove.length)
        await db
          .from("achievements")
          .delete()
          .in(
            "id",
            toRemove.map((a) => a.id),
          );
      if (toAdd.length) {
        await db.from("achievements").upsert(toAdd, { onConflict: "user_id,code" });
        const fresh = toAdd.filter((a) => !have.has(a.code));
        if (fresh.length)
          toast.success(`Achievement unlocked: ${fresh.map((a) => a.title).join(", ")}`);
      }
      await qc.invalidateQueries({ queryKey: ["pp", "achievements"] });
    })().finally(() => {
      running.current = false;
    });
  }, [bundle, program, existing, qc]);
}
