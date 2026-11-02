import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { bestE1RM, exerciseTotals } from "@/lib/pp/calc";
import { qk, useList } from "@/lib/pp/db";
import type { Exercise } from "@/lib/pp/types";
import { exerciseHistory } from "@/lib/pp/workouts";
import { TimeChart } from "./charts";
import { NativeSelect } from "./ui";

export function useExerciseHistory(exerciseId: string | null) {
  return useQuery({
    queryKey: qk("workout_exercises", "history", exerciseId),
    enabled: !!exerciseId,
    queryFn: () => exerciseHistory(exerciseId!, 200),
  });
}

/** Strength progression per session for one exercise: top working weight + estimated 1RM. */
export function StrengthChart({
  from,
  to,
  initialExerciseId,
}: {
  from?: string;
  to?: string;
  initialExerciseId?: string;
}) {
  const exQ = useList<Exercise>("exercise_library", { order: "name", filter: { archived: false } });
  const [exId, setExId] = useState<string>(initialExerciseId ?? "");
  const loadable = (exQ.data ?? []).filter((e) => e.measurement_type === "weight_reps");
  useEffect(() => {
    if (!exId && loadable.length)
      setExId(loadable.find((e) => e.name === "Bench press")?.id ?? loadable[0].id);
  }, [exId, loadable]);
  const hQ = useExerciseHistory(exId || null);
  const data = useMemo(() => {
    const rows = (hQ.data ?? [])
      .filter(
        (h) =>
          (!from || h.workout_sessions.session_date >= from) &&
          (!to || h.workout_sessions.session_date <= to),
      )
      .map((h) => {
        const t = exerciseTotals(h.workout_sets, h.measurement_type);
        return {
          date: h.workout_sessions.session_date,
          top: t.maxWeight,
          e1rm: bestE1RM(h.workout_sets, h.measurement_type),
          volume: t.volume,
        };
      });
    // one point per date: keep the best
    const m = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const p = m.get(r.date);
      if (!p || (r.e1rm ?? 0) > (p.e1rm ?? 0)) m.set(r.date, r);
    }
    return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [hQ.data, from, to]);
  return (
    <div className="space-y-2">
      <NativeSelect
        className="h-8"
        value={exId}
        onChange={setExId}
        options={loadable.map((e) => ({ value: e.id, label: e.name }))}
      />
      <TimeChart
        data={data}
        unit="kg"
        series={[
          { key: "top", label: "Top working weight", dot: true },
          { key: "e1rm", label: "Est. 1RM (estimate)", dashed: true, dot: true },
        ]}
        emptyText="No recorded sets for this exercise in this period."
      />
    </div>
  );
}
