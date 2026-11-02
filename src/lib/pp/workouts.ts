import { db, unwrap } from "./db";
import type {
  Exercise,
  PlanExercise,
  WorkoutExercise,
  WorkoutPlan,
  WorkoutSession,
  WorkoutSet,
} from "./types";

/** Start a new (actual) session. Planned exercises are copied as an empty checklist; no sets are invented. */
export async function startSession(opts: {
  date: string;
  plan?: WorkoutPlan | null;
  name?: string;
}): Promise<string> {
  const [session] = await unwrap<WorkoutSession[]>(
    db
      .from("workout_sessions")
      .insert({
        session_date: opts.date,
        plan_id: opts.plan?.id ?? null,
        name: opts.name ?? opts.plan?.name ?? "Workout",
        status: "in_progress",
        started_at: new Date().toISOString(),
      })
      .select(),
  );
  if (opts.plan) {
    const pes = await unwrap<(PlanExercise & { exercise_library: Exercise })[]>(
      db
        .from("workout_plan_exercises")
        .select("*, exercise_library(*)")
        .eq("plan_id", opts.plan.id)
        .order("sort_order"),
    );
    if (pes.length) {
      await unwrap(
        db.from("workout_exercises").insert(
          pes.map((pe, i) => ({
            session_id: session.id,
            exercise_id: pe.exercise_id,
            plan_exercise_id: pe.id,
            exercise_name: pe.exercise_library.name,
            muscle_group: pe.exercise_library.muscle_group,
            category: pe.exercise_library.category,
            equipment: pe.exercise_library.equipment,
            measurement_type: pe.exercise_library.measurement_type,
            sort_order: i + 1,
            rest_seconds: pe.rest_seconds,
          })),
        ),
      );
    }
  }
  return session.id;
}

/** Repeat a previous session's exercise list (not its sets) on a new date. */
export async function repeatSession(sourceId: string, date: string): Promise<string> {
  const src = await unwrap<WorkoutSession>(
    db.from("workout_sessions").select("*").eq("id", sourceId).single(),
  );
  const exs = await unwrap<WorkoutExercise[]>(
    db.from("workout_exercises").select("*").eq("session_id", sourceId).order("sort_order"),
  );
  const [session] = await unwrap<WorkoutSession[]>(
    db
      .from("workout_sessions")
      .insert({
        session_date: date,
        plan_id: src.plan_id,
        name: src.name,
        status: "in_progress",
        started_at: new Date().toISOString(),
      })
      .select(),
  );
  if (exs.length) {
    await unwrap(
      db.from("workout_exercises").insert(
        exs.map((e) => ({
          session_id: session.id,
          exercise_id: e.exercise_id,
          plan_exercise_id: e.plan_exercise_id,
          exercise_name: e.exercise_name,
          muscle_group: e.muscle_group,
          category: e.category,
          equipment: e.equipment,
          measurement_type: e.measurement_type,
          sort_order: e.sort_order,
          rest_seconds: e.rest_seconds,
        })),
      ),
    );
  }
  return session.id;
}

export type HistoryRow = WorkoutExercise & {
  workout_sessions: Pick<WorkoutSession, "id" | "session_date" | "status" | "name">;
  workout_sets: WorkoutSet[];
};

/** All recorded performances of an exercise, newest first (completed or in-progress sessions). */
export async function exerciseHistory(exerciseId: string, limit = 50): Promise<HistoryRow[]> {
  const rows = await unwrap<HistoryRow[]>(
    db
      .from("workout_exercises")
      .select("*, workout_sessions!inner(id, session_date, status, name), workout_sets(*)")
      .eq("exercise_id", exerciseId)
      .neq("workout_sessions.status", "skipped")
      .limit(limit),
  );
  return rows
    .filter((r) => r.workout_sets.length > 0)
    .map((r) => ({
      ...r,
      workout_sets: [...r.workout_sets].sort((a, b) => a.set_number - b.set_number),
    }))
    .sort(
      (a, b) =>
        b.workout_sessions.session_date.localeCompare(a.workout_sessions.session_date) ||
        (b.created_at ?? "").localeCompare(a.created_at ?? ""),
    );
}

/** Copy the sets of a previous performance into an exercise of the current session (explicit user action). */
export async function copySets(fromSets: WorkoutSet[], toWorkoutExerciseId: string, startAt = 1) {
  if (!fromSets.length) return;
  await unwrap(
    db.from("workout_sets").insert(
      fromSets.map((s, i) => ({
        workout_exercise_id: toWorkoutExerciseId,
        set_number: startAt + i,
        weight_kg: s.weight_kg,
        reps: s.reps,
        duration_seconds: s.duration_seconds,
        is_warmup: s.is_warmup,
      })),
    ),
  );
}

/** Latest recorded performance per exercise (one query for many exercises). */
export async function lastPerformances(
  exerciseIds: string[],
  beforeDate?: string,
): Promise<Map<string, HistoryRow>> {
  const out = new Map<string, HistoryRow>();
  if (!exerciseIds.length) return out;
  let q = db
    .from("workout_exercises")
    .select("*, workout_sessions!inner(id, session_date, status, name), workout_sets(*)")
    .in("exercise_id", exerciseIds)
    .neq("workout_sessions.status", "skipped");
  if (beforeDate) q = q.lt("workout_sessions.session_date", beforeDate);
  const rows = await unwrap<HistoryRow[]>(q.limit(2000));
  rows
    .filter((r) => r.workout_sets.length > 0)
    .sort(
      (a, b) =>
        b.workout_sessions.session_date.localeCompare(a.workout_sessions.session_date) ||
        (b.created_at ?? "").localeCompare(a.created_at ?? ""),
    )
    .forEach((r) => {
      if (r.exercise_id && !out.has(r.exercise_id))
        out.set(r.exercise_id, {
          ...r,
          workout_sets: [...r.workout_sets].sort((a, b) => a.set_number - b.set_number),
        });
    });
  return out;
}
