import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Dumbbell, Play, Repeat } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TimeChart } from "@/components/pp/charts";
import {
  ConfirmDelete,
  EmptyHint,
  Field,
  MetricCard,
  NativeSelect,
  PageHeader,
  Panel,
  fmtNum,
} from "@/components/pp/ui";
import { consistencyPct, round, sum } from "@/lib/pp/calc";
import { sessionTotals, type SessionWithSets } from "@/lib/pp/daily";
import { WEEKDAYS, addDaysStr, fmtDate, isoWeekday, todayStr, weekStartStr } from "@/lib/pp/dates";
import { errMsg, useList, useProfile, useRange, useTableMutations } from "@/lib/pp/db";
import type { WorkoutPlan } from "@/lib/pp/types";
import { repeatSession, startSession } from "@/lib/pp/workouts";

export const Route = createFileRoute("/fitness/workouts/")({
  validateSearch: (s: Record<string, unknown>): { start?: "today" } =>
    s.start === "today" ? { start: "today" } : {},
  component: WorkoutsPage,
});

function WorkoutsPage() {
  const { start } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const today = todayStr();
  const [days, setDays] = useState(90);
  const sessionsQ = useRange<SessionWithSets>(
    "workout_sessions",
    "session_date",
    addDaysStr(today, -(days - 1)),
    today,
    {
      select: "*, workout_exercises(*, workout_sets(*))",
      ascending: false,
    },
  );
  const plansQ = useList<WorkoutPlan>("workout_plans", { order: "day_of_week" });
  const profileQ = useProfile();
  const { remove } = useTableMutations("workout_sessions");
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState("");
  const [date, setDate] = useState(today);
  const [repeatId, setRepeatId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (start === "today") {
      setOpen(true);
      navigate({ to: "/fitness/workouts", search: {}, replace: true });
    }
  }, [start, navigate]);
  useEffect(() => {
    const todays = plansQ.data?.find((p) => p.day_of_week === isoWeekday(date) && !p.is_rest_day);
    setPlanId(todays?.id ?? "");
  }, [plansQ.data, date, open]);

  const sessions = useMemo(() => sessionsQ.data ?? [], [sessionsQ.data]);
  const inProgress = sessions.filter((s) => s.status === "in_progress");

  const weekly = useMemo(() => {
    const m = new Map<string, { done: number; volume: number; sets: number }>();
    for (let i = 7; i >= 0; i--)
      m.set(weekStartStr(addDaysStr(today, -7 * i)), { done: 0, volume: 0, sets: 0 });
    for (const s of sessions) {
      const k = weekStartStr(s.session_date);
      if (!m.has(k) || s.status !== "completed") continue;
      const t = sessionTotals(s);
      const cur = m.get(k)!;
      m.set(k, { done: cur.done + 1, volume: cur.volume + t.volume, sets: cur.sets + t.sets });
    }
    return [...m.entries()].map(([date, v]) => ({
      date,
      workouts: v.done,
      volume: round(v.volume, 0),
      sets: v.sets,
    }));
  }, [sessions, today]);
  const completedDates = sessions
    .filter((s) => s.status === "completed")
    .map((s) => s.session_date);
  const target = profileQ.data?.training_days_per_week ?? null;
  const last28 = new Set(completedDates.filter((d) => d >= addDaysStr(today, -27))).size;

  const begin = async (mode: "plan" | "blank" | "repeat") => {
    setBusy(true);
    try {
      let id: string;
      if (mode === "repeat") {
        if (!repeatId) throw new Error("Choose a previous workout");
        id = await repeatSession(repeatId, date);
      } else {
        const plan =
          mode === "plan" ? ((plansQ.data ?? []).find((p) => p.id === planId) ?? null) : null;
        id = await startSession({ date, plan, name: plan ? undefined : "Custom workout" });
      }
      await qc.invalidateQueries({ queryKey: ["pp"] });
      navigate({ to: "/fitness/workouts/$id", params: { id } });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Workout History"
        description="Every session you have actually performed, with each set stored individually."
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Play className="mr-1 h-4 w-4" /> Start workout
          </Button>
        }
      />
      {inProgress.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-primary/50 bg-primary/10 p-3 text-sm">
          <Dumbbell className="h-4 w-4 text-primary" /> In progress:
          {inProgress.map((s) => (
            <Link
              key={s.id}
              to="/fitness/workouts/$id"
              params={{ id: s.id }}
              className="font-medium underline"
            >
              {s.name} ({fmtDate(s.session_date, "d MMM")})
            </Link>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricCard
          label="Workouts (28 days)"
          value={last28}
          kind="calculated"
          sub={target ? `Plan: ${target}/week → ${target * 4}` : undefined}
        />
        <MetricCard
          label="Weekly consistency"
          value={target ? Math.min(100, round((last28 / (target * 4)) * 100, 0)) : null}
          unit="%"
          kind="calculated"
          sub="Completed vs planned training days, 28 days"
        />
        <MetricCard
          label="Days trained (28d)"
          value={consistencyPct(completedDates, addDaysStr(today, -27), today)}
          unit="%"
          kind="calculated"
        />
        <MetricCard
          label="Volume this week"
          value={fmtNum(weekly[weekly.length - 1]?.volume ?? 0, 0)}
          unit="kg"
          kind="calculated"
        />
      </div>
      <Panel className="mt-4" title="Weekly workouts & volume">
        <TimeChart
          data={weekly}
          unit="workouts"
          rightUnit="kg"
          series={[
            { key: "workouts", label: "Workouts", type: "bar" },
            {
              key: "volume",
              label: "Volume (kg)",
              yAxis: "right",
              color: "var(--chart-4)",
              dot: true,
            },
          ]}
          refLines={target ? [{ y: target, label: "Planned" }] : undefined}
        />
      </Panel>
      <Panel className="mt-4" title="Sessions">
        {sessionsQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : sessions.length === 0 ? (
          <EmptyHint
            action={
              <Button size="sm" onClick={() => setOpen(true)}>
                Start your first workout
              </Button>
            }
          >
            No workouts in the last {days} days.
          </EmptyHint>
        ) : (
          <div className="divide-y">
            {sessions.map((s) => {
              const t = sessionTotals(s);
              return (
                <div key={s.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <Link to="/fitness/workouts/$id" params={{ id: s.id }} className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {s.name}{" "}
                      <span
                        className={`ml-1 rounded px-1.5 py-0.5 text-[10px] uppercase ${s.status === "completed" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : s.status === "skipped" ? "bg-zinc-500/15" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}
                      >
                        {s.status.replace("_", " ")}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDate(s.session_date, "EEE d MMM yyyy")}
                      {s.duration_minutes ? ` · ${s.duration_minutes} min` : ""}
                    </div>
                  </Link>
                  <div className="grid grid-cols-4 gap-3 text-right text-xs tabular-nums">
                    <div>
                      <b className="text-sm">{t.exercises}</b>
                      <div>exercises</div>
                    </div>
                    <div>
                      <b className="text-sm">{t.sets}</b>
                      <div>sets</div>
                    </div>
                    <div>
                      <b className="text-sm">{t.reps}</b>
                      <div>reps</div>
                    </div>
                    <div>
                      <b className="text-sm">{fmtNum(t.volume, 0)}</b>
                      <div>kg vol.</div>
                    </div>
                  </div>
                  <ConfirmDelete
                    what={`workout "${s.name}" and all its sets`}
                    onConfirm={() => remove.mutateAsync(s.id)}
                  />
                </div>
              );
            })}
            <div className="pt-3 text-center">
              <Button size="sm" variant="ghost" onClick={() => setDays(days + 90)}>
                Load older
              </Button>
            </div>
          </div>
        )}
      </Panel>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Start a workout</DialogTitle>
            <DialogDescription>
              Planned exercises are added as a checklist. You record the weight and reps you
              actually do.
            </DialogDescription>
          </DialogHeader>
          <Field label="Date" id="ws-date">
            <Input
              id="ws-date"
              type="date"
              value={date}
              max={today}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          </Field>
          <div className="space-y-2 rounded-lg border p-3">
            <Field label="From plan" id="ws-plan">
              <NativeSelect
                id="ws-plan"
                value={planId}
                onChange={setPlanId}
                placeholder="Choose a plan…"
                options={(plansQ.data ?? [])
                  .filter((p) => !p.is_rest_day)
                  .map((p) => ({
                    value: p.id,
                    label: `${p.day_of_week ? WEEKDAYS[p.day_of_week] + " · " : ""}${p.name}`,
                  }))}
              />
            </Field>
            <Button className="w-full" disabled={busy || !planId} onClick={() => begin("plan")}>
              <Play className="mr-1 h-4 w-4" /> Start planned workout
            </Button>
          </div>
          <div className="space-y-2 rounded-lg border p-3">
            <Field label="Repeat a previous workout (exercises only)" id="ws-repeat">
              <NativeSelect
                id="ws-repeat"
                value={repeatId}
                onChange={setRepeatId}
                placeholder="Choose…"
                options={sessions.slice(0, 30).map((s) => ({
                  value: s.id,
                  label: `${fmtDate(s.session_date, "d MMM")} · ${s.name} (${sum(s.workout_exercises.map((e) => e.workout_sets.length))} sets)`,
                }))}
              />
            </Field>
            <Button
              className="w-full"
              variant="secondary"
              disabled={busy || !repeatId}
              onClick={() => begin("repeat")}
            >
              <Repeat className="mr-1 h-4 w-4" /> Repeat workout
            </Button>
          </div>
          <Button variant="outline" disabled={busy} onClick={() => begin("blank")}>
            Start an empty workout
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
