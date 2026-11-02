import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Footprints, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TimeChart } from "@/components/pp/charts";
import { DateRangeFilter, useDateRange } from "@/components/pp/date-range";
import {
  ConfirmDelete,
  EmptyHint,
  Field,
  KindBadge,
  MetricCard,
  NativeSelect,
  NumInput,
  PageHeader,
  Panel,
  fmtNum,
  parseOptNum,
  strOf,
} from "@/components/pp/ui";
import { mean, paceMinPerKm, round, sum } from "@/lib/pp/calc";
import { useDaily } from "@/lib/pp/daily";
import { addDaysStr, fmtDate, todayStr, weekStartStr } from "@/lib/pp/dates";
import { errMsg, targetFor, useTableMutations, useTargets } from "@/lib/pp/db";
import { CARDIO_TYPES, titleCase, type CardioLog, type StepLog } from "@/lib/pp/types";

export const Route = createFileRoute("/fitness/cardio")({
  validateSearch: (s: Record<string, unknown>): { new?: number } => (s.new ? { new: 1 } : {}),
  component: CardioPage,
});

const emptyCardio = {
  date: todayStr(),
  type: "walking",
  label: "",
  time: "",
  duration: "",
  distance: "",
  steps: "",
  hr: "",
  hrMax: "",
  kcal: "",
  kcalSrc: "",
  notes: "",
};

function CardioPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const today = todayStr();
  const range = useDateRange("30");
  const from = [range.range.from, addDaysStr(today, -13)].sort()[0];
  const dailyQ = useDaily(from, range.range.to > today ? range.range.to : today);
  const targetsQ = useTargets();
  const target = targetFor(targetsQ.data, today);
  const cardioMut = useTableMutations("cardio_logs");
  const stepMut = useTableMutations("step_logs");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<CardioLog | null>(null);
  const [f, setF] = useState(emptyCardio);
  const [stepDate, setStepDate] = useState(today);
  const [steps, setSteps] = useState("");
  const [stepSource, setStepSource] = useState("phone");

  useEffect(() => {
    if (search.new) {
      setEdit(null);
      setF({ ...emptyCardio, date: todayStr() });
      setOpen(true);
      navigate({ to: "/fitness/cardio", search: {}, replace: true });
    }
  }, [search.new, navigate]);

  const b = dailyQ.data;
  const days = (b?.days ?? []).filter(
    (d) => d.date >= range.range.from && d.date <= range.range.to,
  );
  const last7 = (b?.days ?? []).filter((d) => d.date > addDaysStr(today, -7) && d.date <= today);
  const prev7 = (b?.days ?? []).filter(
    (d) => d.date > addDaysStr(today, -14) && d.date <= addDaysStr(today, -7),
  );
  const stepDays7 = last7.filter((d) => d.steps !== null);
  const avgSteps7 = mean(stepDays7.map((d) => d.steps!));
  const cardioWeek = round(sum(last7.map((d) => d.cardioMin ?? 0)), 0);
  const cardioPrevWeek = round(sum(prev7.map((d) => d.cardioMin ?? 0)), 0);
  const todayRow = b?.days.find((d) => d.date === today);
  const weekly = useMemo(() => {
    const m = new Map<string, { min: number; km: number; steps: number[] }>();
    for (const d of days) {
      const k = weekStartStr(d.date);
      const cur = m.get(k) ?? { min: 0, km: 0, steps: [] };
      cur.min += d.cardioMin ?? 0;
      cur.km += d.cardioKm ?? 0;
      if (d.steps !== null) cur.steps.push(d.steps);
      m.set(k, cur);
    }
    return [...m.entries()].map(([date, v]) => ({
      date,
      minutes: round(v.min, 0),
      km: round(v.km, 2),
      avgSteps: v.steps.length ? round(mean(v.steps)!, 0) : null,
    }));
  }, [days]);
  const sessions = [...(b?.cardio ?? [])]
    .filter((c) => c.log_date >= range.range.from && c.log_date <= range.range.to)
    .sort((a, z) => z.log_date.localeCompare(a.log_date));
  const distanceSeries = [...sessions]
    .reverse()
    .filter((c) => c.distance_km !== null)
    .map((c) => ({ date: c.log_date, km: Number(c.distance_km), type: c.activity_type }));
  const stepLogs = [...(b?.steps ?? [])].sort((a, z) => z.log_date.localeCompare(a.log_date));

  const openEdit = (c: CardioLog) => {
    setEdit(c);
    setF({
      date: c.log_date,
      type: c.activity_type,
      label: c.activity_label ?? "",
      time: c.started_at?.slice(0, 5) ?? "",
      duration: strOf(c.duration_minutes),
      distance: strOf(c.distance_km),
      steps: strOf(c.steps),
      hr: strOf(c.avg_heart_rate),
      hrMax: strOf(c.max_heart_rate),
      kcal: strOf(c.calories_burned),
      kcalSrc: c.calories_source ?? "",
      notes: c.notes ?? "",
    });
    setOpen(true);
  };
  const save = async () => {
    const dur = parseOptNum(f.duration, { min: 0.1, max: 1440 });
    const dist = parseOptNum(f.distance, { min: 0, max: 500 });
    const st = parseOptNum(f.steps, { min: 0, max: 200000, int: true });
    const hr = parseOptNum(f.hr, { min: 30, max: 240, int: true });
    const hrMax = parseOptNum(f.hrMax, { min: 30, max: 240, int: true });
    const kcal = parseOptNum(f.kcal, { min: 0, max: 10000, int: true });
    if (!dur) return toast.error("Duration (minutes) is required");
    if ([dist, st, hr, hrMax, kcal].some((v) => v === undefined))
      return toast.error("Check distance, steps, heart rate and calories");
    if (kcal !== null && !f.kcalSrc) return toast.error("Say where the calorie figure came from");
    const row = {
      log_date: f.date,
      activity_type: f.type,
      activity_label: f.label.trim() || null,
      started_at: f.time || null,
      duration_minutes: dur,
      distance_km: dist,
      steps: st,
      avg_heart_rate: hr,
      max_heart_rate: hrMax,
      calories_burned: kcal,
      calories_source: kcal === null ? null : f.kcalSrc,
      notes: f.notes.trim() || null,
    };
    try {
      if (edit) await cardioMut.update.mutateAsync({ id: edit.id, patch: row });
      else await cardioMut.insert.mutateAsync(row);
      toast.success("Cardio saved");
      setOpen(false);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const saveSteps = async () => {
    const v = parseOptNum(steps, { min: 0, max: 200000, int: true });
    if (v === null || v === undefined) return toast.error("Enter steps (0–200,000)");
    await stepMut.upsert.mutateAsync({
      row: { log_date: stepDate, steps: v, source: stepSource },
      onConflict: "user_id,log_date",
    });
    toast.success(`Steps saved for ${fmtDate(stepDate, "d MMM")}`);
    setSteps("");
  };

  return (
    <div>
      <PageHeader
        title="Cardio & Steps"
        description="Exercise calories are never added to your food target, and steps are not converted into a fixed calorie burn."
        actions={
          <Button
            size="sm"
            onClick={() => {
              setEdit(null);
              setF({ ...emptyCardio, date: todayStr() });
              setOpen(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> Log cardio
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title={
            <span className="flex items-center gap-2">
              <Footprints className="h-4 w-4 text-primary" /> Daily steps
            </span>
          }
          description="Enter your whole-day total from your phone or watch."
        >
          <div className="grid grid-cols-2 gap-2">
            <Field label="Date" id="st-date">
              <Input
                id="st-date"
                type="date"
                value={stepDate}
                max={today}
                onChange={(e) => e.target.value && setStepDate(e.target.value)}
              />
            </Field>
            <Field label="Source" id="st-src">
              <NativeSelect
                id="st-src"
                value={stepSource}
                onChange={setStepSource}
                options={[
                  { value: "phone", label: "Phone" },
                  { value: "watch", label: "Watch" },
                  { value: "other_device", label: "Other device" },
                  { value: "manual", label: "Manual count" },
                ]}
              />
            </Field>
            <Field label="Steps" id="st-n" className="col-span-2">
              <NumInput
                id="st-n"
                step="1"
                value={steps}
                onChange={setSteps}
                placeholder={
                  b?.steps.find((s) => s.log_date === stepDate)?.steps.toString() ?? "e.g. 9500"
                }
                className="h-11 text-lg"
              />
            </Field>
          </div>
          <Button className="mt-3 w-full" onClick={saveSteps} disabled={stepMut.upsert.isPending}>
            Save steps
          </Button>
        </Panel>
        <div className="grid grid-cols-2 gap-2 lg:col-span-2 lg:grid-cols-3 content-start">
          <MetricCard
            label="Steps today"
            value={todayRow?.steps != null ? fmtNum(todayRow.steps, 0) : null}
            kind="entered"
            sub={
              todayRow?.stepsSource === "cardio_sum"
                ? "Sum of cardio sessions (no daily total entered)"
                : target?.steps_target
                  ? `Target ${fmtNum(target.steps_target, 0)}`
                  : undefined
            }
          />
          <MetricCard
            label="7-day avg steps"
            value={avgSteps7 !== null ? fmtNum(avgSteps7, 0) : null}
            kind="calculated"
            sub={`${stepDays7.length} of 7 days logged`}
          />
          <MetricCard
            label="Cardio this week"
            value={cardioWeek}
            unit="min"
            kind="calculated"
            sub={`Previous 7 days: ${cardioPrevWeek} min`}
          />
          <MetricCard
            label="Cardio in range"
            value={round(sum(days.map((d) => d.cardioMin ?? 0)), 0)}
            unit="min"
            kind="calculated"
          />
          <MetricCard
            label="Distance in range"
            value={fmtNum(sum(days.map((d) => d.cardioKm ?? 0)), 2)}
            unit="km"
            kind="calculated"
          />
          <MetricCard label="Sessions in range" value={sessions.length} kind="calculated" />
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <DateRangeFilter state={range} />
      </div>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <Panel title="Daily steps">
          <TimeChart
            data={days}
            series={[{ key: "steps", label: "Steps", type: "bar" }]}
            refLines={
              target?.steps_target ? [{ y: target.steps_target, label: "Target" }] : undefined
            }
          />
        </Panel>
        <Panel title="Weekly cardio duration & average steps">
          <TimeChart
            data={weekly}
            unit="min"
            series={[
              { key: "minutes", label: "Cardio minutes", type: "bar", color: "var(--chart-3)" },
              {
                key: "avgSteps",
                label: "Avg daily steps",
                yAxis: "right",
                dot: true,
                color: "var(--chart-1)",
              },
            ]}
          />
        </Panel>
        <Panel title="Distance progression" className="lg:col-span-2">
          <TimeChart
            data={distanceSeries}
            unit="km"
            series={[
              { key: "km", label: "Distance per session", dot: true, color: "var(--chart-2)" },
            ]}
            emptyText="No sessions with distance in this period."
          />
        </Panel>
      </div>

      <Panel className="mt-4" title="Cardio sessions">
        {sessions.length === 0 ? (
          <EmptyHint>No cardio sessions in this period.</EmptyHint>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="p-1 text-left">Date</th>
                  <th className="p-1 text-left">Activity</th>
                  <th className="p-1 text-right">Minutes</th>
                  <th className="p-1 text-right">km</th>
                  <th className="p-1 text-right">Pace</th>
                  <th className="p-1 text-right">Steps</th>
                  <th className="p-1 text-right">Avg HR</th>
                  <th className="p-1 text-right">kcal</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessions.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="p-1 whitespace-nowrap">{fmtDate(c.log_date, "d MMM")}</td>
                    <td className="p-1">
                      {titleCase(c.activity_type)}
                      {c.activity_label ? ` · ${c.activity_label}` : ""}
                    </td>
                    <td className="p-1 text-right">{fmtNum(c.duration_minutes)}</td>
                    <td className="p-1 text-right">
                      {c.distance_km !== null ? fmtNum(c.distance_km, 2) : "—"}
                    </td>
                    <td className="p-1 text-right">
                      {paceMinPerKm(
                        Number(c.duration_minutes),
                        c.distance_km ? Number(c.distance_km) : null,
                      ) ?? "—"}
                    </td>
                    <td className="p-1 text-right">
                      {c.steps !== null ? fmtNum(c.steps, 0) : "—"}
                    </td>
                    <td className="p-1 text-right">{c.avg_heart_rate ?? "—"}</td>
                    <td className="p-1 text-right">
                      {c.calories_burned ?? "—"}
                      {c.calories_burned !== null && (
                        <div className="text-[9px] text-muted-foreground">
                          {c.calories_source === "user_estimate" ? "estimate" : c.calories_source}
                        </div>
                      )}
                    </td>
                    <td className="p-1">
                      <div className="flex justify-end">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Edit"
                          onClick={() => openEdit(c)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <ConfirmDelete
                          what="cardio session"
                          onConfirm={() => cardioMut.remove.mutateAsync(c.id)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Pace = minutes ÷ km. Calories are shown only when you or your device recorded them.
            </p>
          </div>
        )}
      </Panel>

      <Panel className="mt-4" title="Step log" action={<KindBadge kind="entered" />}>
        {stepLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No daily step totals logged.</p>
        ) : (
          <div className="divide-y text-sm">
            {stepLogs.map((s: StepLog) => (
              <div key={s.id} className="flex items-center gap-2 py-1.5">
                <span className="w-28">{fmtDate(s.log_date, "EEE d MMM")}</span>
                <span className="flex-1 font-medium tabular-nums">{fmtNum(s.steps, 0)}</span>
                <span className="text-xs text-muted-foreground">{titleCase(s.source)}</span>
                <ConfirmDelete
                  what="step entry"
                  onConfirm={() => stepMut.remove.mutateAsync(s.id)}
                />
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{edit ? "Edit cardio" : "Log cardio"}</DialogTitle>
            <DialogDescription>
              Only duration is required. Leave anything you didn't measure blank.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Date" id="c-date">
              <Input
                id="c-date"
                type="date"
                value={f.date}
                max={today}
                onChange={(e) => e.target.value && setF({ ...f, date: e.target.value })}
              />
            </Field>
            <Field label="Activity" id="c-type">
              <NativeSelect
                id="c-type"
                value={f.type}
                onChange={(v) => setF({ ...f, type: v })}
                options={CARDIO_TYPES.map((t) => ({ value: t, label: titleCase(t) }))}
              />
            </Field>
            <Field label="Start time" id="c-time">
              <Input
                id="c-time"
                type="time"
                value={f.time}
                onChange={(e) => setF({ ...f, time: e.target.value })}
              />
            </Field>
            {f.type === "other" && (
              <Field label="Activity name" id="c-label" className="col-span-2 sm:col-span-3">
                <Input
                  id="c-label"
                  value={f.label}
                  onChange={(e) => setF({ ...f, label: e.target.value })}
                />
              </Field>
            )}
            <Field label="Duration (min)" id="c-dur">
              <NumInput
                id="c-dur"
                value={f.duration}
                onChange={(v) => setF({ ...f, duration: v })}
                autoFocus
              />
            </Field>
            <Field label="Distance (km)" id="c-dist">
              <NumInput
                id="c-dist"
                value={f.distance}
                onChange={(v) => setF({ ...f, distance: v })}
              />
            </Field>
            <Field label="Steps" id="c-steps" hint="Leave blank if included in your daily total">
              <NumInput
                id="c-steps"
                step="1"
                value={f.steps}
                onChange={(v) => setF({ ...f, steps: v })}
              />
            </Field>
            <Field label="Avg heart rate" id="c-hr">
              <NumInput id="c-hr" step="1" value={f.hr} onChange={(v) => setF({ ...f, hr: v })} />
            </Field>
            <Field label="Max heart rate" id="c-hrmax">
              <NumInput
                id="c-hrmax"
                step="1"
                value={f.hrMax}
                onChange={(v) => setF({ ...f, hrMax: v })}
              />
            </Field>
            <Field label="Calories burned" id="c-kcal">
              <NumInput
                id="c-kcal"
                step="1"
                value={f.kcal}
                onChange={(v) => setF({ ...f, kcal: v })}
              />
            </Field>
            {f.kcal && (
              <Field label="Calorie source" id="c-ksrc">
                <NativeSelect
                  id="c-ksrc"
                  value={f.kcalSrc}
                  onChange={(v) => setF({ ...f, kcalSrc: v })}
                  placeholder="Choose…"
                  options={[
                    { value: "device", label: "Watch / tracker" },
                    { value: "machine", label: "Gym machine" },
                    { value: "user_estimate", label: "My estimate" },
                  ]}
                />
              </Field>
            )}
            {f.duration && f.distance && Number(f.distance) > 0 && (
              <div className="col-span-2 self-end text-sm text-muted-foreground sm:col-span-3">
                Pace: {paceMinPerKm(Number(f.duration), Number(f.distance))} min/km
              </div>
            )}
            <Field label="Notes" id="c-notes" className="col-span-2 sm:col-span-3">
              <Textarea
                id="c-notes"
                rows={2}
                value={f.notes}
                onChange={(e) => setF({ ...f, notes: e.target.value })}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button
              onClick={save}
              disabled={cardioMut.insert.isPending || cardioMut.update.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
