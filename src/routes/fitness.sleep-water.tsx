import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { TimeChart } from "@/components/pp/charts";
import { DayNav } from "@/components/pp/day-nav";
import {
  ConfirmDelete,
  Field,
  KindBadge,
  MetricCard,
  NumInput,
  PageHeader,
  Panel,
  RatingPicker,
  fmtNum,
  parseOptNum,
  strOf,
} from "@/components/pp/ui";
import { WaterQuickAdd } from "@/components/pp/water-quick";
import { mean, minutesToHM, round, sleepWindow, sum } from "@/lib/pp/calc";
import { addDaysStr, fmtDate, todayStr, weekStartStr } from "@/lib/pp/dates";
import { errMsg, targetFor, useRange, useTableMutations, useTargets } from "@/lib/pp/db";
import type { SleepLog, WaterLog } from "@/lib/pp/types";

export const Route = createFileRoute("/fitness/sleep-water")({
  component: SleepWaterPage,
});

function SleepWaterPage() {
  const today = todayStr();
  const [date, setDate] = useState(today);
  const from = addDaysStr(today, -55);
  const waterQ = useRange<WaterLog>("water_logs", "log_date", from, today, { order: "logged_at" });
  const sleepQ = useRange<SleepLog>("sleep_logs", "sleep_date", from, today);
  const targetsQ = useTargets();
  const target = targetFor(targetsQ.data, date);
  const waterMut = useTableMutations("water_logs");
  const sleepMut = useTableMutations("sleep_logs");

  const water = useMemo(() => waterQ.data ?? [], [waterQ.data]);
  const dayWater = water.filter((w) => w.log_date === date);
  const dayTotal = sum(dayWater.map((w) => w.amount_ml));
  const waterByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of water) m.set(w.log_date, (m.get(w.log_date) ?? 0) + w.amount_ml);
    return Array.from({ length: 14 }, (_, i) => addDaysStr(today, -13 + i)).map((d) => ({
      date: d,
      ml: m.get(d) ?? null,
    }));
  }, [water, today]);
  const waterDays = [
    ...new Set(water.filter((w) => w.log_date > addDaysStr(today, -7)).map((w) => w.log_date)),
  ];
  const avgWater7 = waterDays.length
    ? round(
        sum(water.filter((w) => w.log_date > addDaysStr(today, -7)).map((w) => w.amount_ml)) /
          waterDays.length,
        0,
      )
    : null;

  const sleeps = useMemo(() => sleepQ.data ?? [], [sleepQ.data]);
  const existing = sleeps.find((s) => s.sleep_date === date) ?? null;
  const [bed, setBed] = useState("23:00");
  const [wake, setWake] = useState("07:00");
  const [quality, setQuality] = useState<number | null>(null);
  const [awake, setAwake] = useState("");
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState<SleepLog | null>(null);
  const loadSleep = (s: SleepLog | null) => {
    setEditing(s);
    if (s) {
      setBed(format(new Date(s.bedtime), "HH:mm"));
      setWake(format(new Date(s.wake_time), "HH:mm"));
      setQuality(s.quality_rating);
      setAwake(strOf(s.awakenings));
      setNotes(s.notes ?? "");
    } else {
      setQuality(null);
      setAwake("");
      setNotes("");
    }
  };
  const changeDate = (d: string) => {
    setDate(d);
    loadSleep(sleeps.find((s) => s.sleep_date === d) ?? null);
  };
  const win = sleepWindow(date, bed, wake);

  const saveSleep = async () => {
    const aw = parseOptNum(awake, { min: 0, max: 50, int: true });
    if (aw === undefined) return toast.error("Awakenings must be 0–50");
    if (!(win.minutes > 0) || win.minutes > 20 * 60)
      return toast.error("Check bedtime and wake time");
    const row = {
      sleep_date: date,
      bedtime: win.bedtime.toISOString(),
      wake_time: win.wakeTime.toISOString(),
      quality_rating: quality,
      awakenings: aw,
      notes: notes.trim() || null,
    };
    try {
      const current = editing ?? existing;
      if (current) await sleepMut.update.mutateAsync({ id: current.id, patch: row });
      else await sleepMut.insert.mutateAsync(row);
      toast.success(`Sleep saved: ${minutesToHM(win.minutes)}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const sleepChart = Array.from({ length: 14 }, (_, i) => addDaysStr(today, -13 + i)).map((d) => {
    const s = sleeps.find((x) => x.sleep_date === d);
    return {
      date: d,
      hours: s ? round(s.duration_minutes / 60, 2) : null,
      quality: s?.quality_rating ?? null,
    };
  });
  const weeklySleep = useMemo(() => {
    const m = new Map<string, SleepLog[]>();
    for (const s of sleeps)
      m.set(weekStartStr(s.sleep_date), [...(m.get(weekStartStr(s.sleep_date)) ?? []), s]);
    return [...m.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([wk, list]) => ({
        wk,
        nights: list.length,
        avgMin: round(mean(list.map((s) => s.duration_minutes))!, 0),
        avgQ: mean(list.filter((s) => s.quality_rating !== null).map((s) => s.quality_rating!)),
        avgAwake: mean(list.filter((s) => s.awakenings !== null).map((s) => s.awakenings!)),
      }));
  }, [sleeps]);

  return (
    <div>
      <PageHeader
        title="Sleep & Water"
        description="Log each glass and each night. Totals and averages use only what you recorded."
      />
      <div className="mb-4">
        <DayNav date={date} onChange={changeDate} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Water" action={<KindBadge kind="entered" />}>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-3xl font-semibold tabular-nums">
              {fmtNum(dayTotal / 1000, 2)}{" "}
              <span className="text-base text-muted-foreground">L</span>
            </span>
            <span className="text-sm text-muted-foreground">
              {target?.water_min_ml
                ? `Target ${fmtNum(target.water_min_ml / 1000, 1)}–${fmtNum((target.water_max_ml ?? target.water_min_ml) / 1000, 1)} L`
                : "No target"}
            </span>
          </div>
          {target?.water_min_ml ? (
            <Progress
              value={Math.min((dayTotal / target.water_min_ml) * 100, 100)}
              className="mb-3 h-2"
            />
          ) : null}
          <WaterQuickAdd date={date} />
          <div className="mt-3 divide-y text-sm">
            {dayWater.length === 0 && (
              <p className="py-2 text-muted-foreground">No water logged.</p>
            )}
            {dayWater.map((w) => (
              <div key={w.id} className="flex items-center justify-between py-1.5">
                <span className="tabular-nums">{format(new Date(w.logged_at), "HH:mm")}</span>
                <span className="font-medium tabular-nums">{w.amount_ml} ml</span>
                <ConfirmDelete
                  what={`${w.amount_ml} ml entry`}
                  onConfirm={() => waterMut.remove.mutateAsync(w.id)}
                />
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title={editing || existing ? "Sleep (editing)" : "Sleep"}
          description={`Night ending on the morning of ${fmtDate(date, "EEE d MMM")}`}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bedtime" id="sl-bed">
              <Input id="sl-bed" type="time" value={bed} onChange={(e) => setBed(e.target.value)} />
            </Field>
            <Field label="Wake-up time" id="sl-wake">
              <Input
                id="sl-wake"
                type="time"
                value={wake}
                onChange={(e) => setWake(e.target.value)}
              />
            </Field>
            <div className="col-span-2 text-sm">
              Duration:{" "}
              <b className="tabular-nums">{win.minutes > 0 ? minutesToHM(win.minutes) : "—"}</b>{" "}
              <KindBadge kind="calculated" />
            </div>
            <Field label="Quality (1 = poor, 5 = great)" className="col-span-2">
              <RatingPicker value={quality} onChange={setQuality} />
            </Field>
            <Field label="Awakenings" id="sl-aw">
              <NumInput id="sl-aw" step="1" value={awake} onChange={setAwake} />
            </Field>
            <Field label="Notes" id="sl-notes" className="col-span-2">
              <Textarea
                id="sl-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            {existing && !editing && (
              <Button variant="outline" size="sm" onClick={() => loadSleep(existing)}>
                <Pencil className="mr-1 h-4 w-4" /> Load saved entry
              </Button>
            )}
            <Button
              size="sm"
              onClick={saveSleep}
              disabled={sleepMut.insert.isPending || sleepMut.update.isPending}
            >
              {existing ? "Update sleep" : "Save sleep"}
            </Button>
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricCard
          label="Avg water (7d)"
          value={avgWater7 !== null ? fmtNum(avgWater7 / 1000, 2) : null}
          unit="L"
          kind="calculated"
          sub={`${waterDays.length} of 7 days logged`}
        />
        <MetricCard
          label="Avg sleep (this week)"
          value={
            weeklySleep[0] && weeklySleep[0].wk === weekStartStr(today)
              ? minutesToHM(weeklySleep[0].avgMin)
              : null
          }
          kind="calculated"
          sub={
            weeklySleep[0]?.wk === weekStartStr(today)
              ? `${weeklySleep[0].nights} nights`
              : undefined
          }
        />
        <MetricCard
          label="Avg quality (this week)"
          value={
            weeklySleep[0]?.wk === weekStartStr(today) && weeklySleep[0].avgQ !== null
              ? fmtNum(weeklySleep[0].avgQ, 1)
              : null
          }
          unit="/ 5"
          kind="calculated"
        />
        <MetricCard label="Nights logged (8 wks)" value={sleeps.length} kind="calculated" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Water — last 14 days">
          <TimeChart
            data={waterByDay}
            unit="ml"
            series={[{ key: "ml", label: "Water", type: "bar", color: "var(--chart-2)" }]}
            refLines={
              target?.water_min_ml ? [{ y: target.water_min_ml, label: "Target" }] : undefined
            }
          />
        </Panel>
        <Panel title="Sleep — last 14 nights">
          <TimeChart
            data={sleepChart}
            unit="h"
            rightUnit="/5"
            series={[
              { key: "hours", label: "Hours", type: "bar", color: "var(--chart-4)" },
              {
                key: "quality",
                label: "Quality",
                yAxis: "right",
                dot: true,
                color: "var(--chart-3)",
              },
            ]}
            refLines={
              target?.sleep_target_hours
                ? [{ y: Number(target.sleep_target_hours), label: "Target" }]
                : undefined
            }
          />
        </Panel>
      </div>

      <Panel className="mt-4" title="Weekly sleep averages">
        {weeklySleep.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sleep logged yet.</p>
        ) : (
          <table className="w-full text-sm tabular-nums">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="text-left">Week of</th>
                <th className="text-right">Nights</th>
                <th className="text-right">Avg duration</th>
                <th className="text-right">Avg quality</th>
                <th className="text-right">Avg awakenings</th>
              </tr>
            </thead>
            <tbody>
              {weeklySleep.map((w) => (
                <tr key={w.wk} className="border-t">
                  <td className="py-1">{fmtDate(w.wk, "d MMM")}</td>
                  <td className="text-right">{w.nights}</td>
                  <td className="text-right">{minutesToHM(w.avgMin)}</td>
                  <td className="text-right">{w.avgQ !== null ? w.avgQ.toFixed(1) : "—"}</td>
                  <td className="text-right">
                    {w.avgAwake !== null ? w.avgAwake.toFixed(1) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-3 divide-y text-sm">
          {[...sleeps]
            .sort((a, b) => b.sleep_date.localeCompare(a.sleep_date))
            .slice(0, 14)
            .map((s) => (
              <div key={s.id} className="flex items-center gap-2 py-1.5">
                <span className="w-28">{fmtDate(s.sleep_date, "EEE d MMM")}</span>
                <span className="flex-1 tabular-nums">
                  {format(new Date(s.bedtime), "HH:mm")}–{format(new Date(s.wake_time), "HH:mm")} ·{" "}
                  {minutesToHM(s.duration_minutes)}
                  {s.quality_rating ? ` · ${s.quality_rating}/5` : ""}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Edit"
                  onClick={() => (setDate(s.sleep_date), loadSleep(s))}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <ConfirmDelete
                  what="sleep entry"
                  onConfirm={() => sleepMut.remove.mutateAsync(s.id)}
                />
              </div>
            ))}
        </div>
      </Panel>
    </div>
  );
}
