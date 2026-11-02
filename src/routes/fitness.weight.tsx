import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TimeChart } from "@/components/pp/charts";
import { DateRangeFilter, useDateRange } from "@/components/pp/date-range";
import {
  ConfirmDelete,
  KindBadge,
  MetricCard,
  PageHeader,
  Panel,
  fmtNum,
  signed,
} from "@/components/pp/ui";
import { WeightDialog } from "@/components/pp/weight-dialog";
import {
  analyseWeights,
  averageBetween,
  describeTrend,
  monthlyAverages,
  projectedWeightOn,
  trendKgPerWeek,
  weeklyAverages,
} from "@/lib/pp/calc";
import { addDaysStr, fmtDate, todayStr } from "@/lib/pp/dates";
import { useList, useProgram, useTableMutations } from "@/lib/pp/db";
import type { WeightLog } from "@/lib/pp/types";

export const Route = createFileRoute("/fitness/weight")({
  component: WeightPage,
});

function WeightPage() {
  const today = todayStr();
  const range = useDateRange("30");
  const logsQ = useList<WeightLog>("daily_weight_logs", { order: "log_date" });
  const programQ = useProgram();
  const program = programQ.data ?? null;
  const { remove } = useTableMutations("daily_weight_logs");
  const [dlg, setDlg] = useState<{ open: boolean; edit?: WeightLog | null }>({ open: false });

  const logs = useMemo(() => logsQ.data ?? [], [logsQ.data]);
  const readings = useMemo(
    () => logs.map((l) => ({ date: l.log_date, value: Number(l.morning_weight_kg) })),
    [logs],
  );
  const analysis = useMemo(() => analyseWeights(readings, program), [readings, program]);
  const byDate = new Map(analysis.map((a) => [a.date, a]));
  const latest = analysis[analysis.length - 1];
  const inRange = analysis.filter((a) => a.date >= range.range.from && a.date <= range.range.to);
  const trend = trendKgPerWeek(readings.filter((r) => r.date >= addDaysStr(today, -27)));
  const thisWeekAvg = averageBetween(readings, addDaysStr(today, -6), today);
  const lastWeekAvg = averageBetween(readings, addDaysStr(today, -13), addDaysStr(today, -7));
  const monthAvg = averageBetween(readings, addDaysStr(today, -29), today);
  const weekly = weeklyAverages(readings).slice(-12);
  const monthly = monthlyAverages(readings).slice(-6);
  const chart = inRange.map((a) => ({
    date: a.date,
    weight: a.weight,
    avg7: a.avg7,
    projected: program && a.date >= program.start_date ? projectedWeightOn(program, a.date) : null,
  }));

  return (
    <div>
      <PageHeader
        title="Daily Weight"
        description="Daily weight moves with water, food, salt and digestion. A single day's increase is not fat gain — judge progress by the 7-day average and weekly trend."
        actions={
          <Button size="sm" onClick={() => setDlg({ open: true })}>
            <Plus className="mr-1 h-4 w-4" /> Log weight
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label="Latest"
          value={latest ? fmtNum(latest.weight, 2) : null}
          unit="kg"
          kind="measured"
          sub={latest ? fmtDate(latest.date, "d MMM") : "No weigh-ins"}
        />
        <MetricCard
          label="vs previous"
          value={
            latest?.diffPrev !== null && latest?.diffPrev !== undefined
              ? signed(latest.diffPrev)
              : null
          }
          unit="kg"
          kind="calculated"
          sub={
            latest?.prevGapDays && latest.prevGapDays > 1
              ? `${latest.prevGapDays} days apart`
              : "Day-to-day noise is normal"
          }
        />
        <MetricCard
          label="vs start"
          value={
            latest?.diffStart !== null && latest?.diffStart !== undefined
              ? signed(latest.diffStart)
              : null
          }
          unit="kg"
          kind="calculated"
        />
        <MetricCard
          label="To target"
          value={
            latest?.toTarget !== null && latest?.toTarget !== undefined
              ? fmtNum(latest.toTarget, 2)
              : null
          }
          unit="kg"
          kind="calculated"
        />
        <MetricCard
          label="7-day average"
          value={thisWeekAvg !== null ? fmtNum(thisWeekAvg, 2) : null}
          unit="kg"
          kind="calculated"
          sub={
            lastWeekAvg !== null && thisWeekAvg !== null
              ? `${signed(thisWeekAvg - lastWeekAvg)} kg vs previous 7 days`
              : "Needs readings in both weeks"
          }
        />
        <MetricCard
          label="30-day average"
          value={monthAvg !== null ? fmtNum(monthAvg, 2) : null}
          unit="kg"
          kind="calculated"
          sub={describeTrend(trend)}
        />
      </div>

      <Panel className="mt-4" title="Weight trend" action={<DateRangeFilter state={range} />}>
        <TimeChart
          data={chart}
          unit="kg"
          height={280}
          series={[
            { key: "weight", label: "Daily (measured)", dot: true, color: "var(--chart-2)" },
            { key: "avg7", label: "7-day moving average", color: "var(--chart-1)" },
            {
              key: "projected",
              label: "Target projection",
              dashed: true,
              color: "var(--muted-foreground)",
            },
          ]}
        />
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Weekly averages" description="Monday–Sunday">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="text-left">Week of</th>
                <th className="text-right">Average</th>
                <th className="text-right">Change</th>
                <th className="text-right">Range</th>
                <th className="text-right">Weigh-ins</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[...weekly].reverse().map((w, i, arr) => (
                <tr key={w.key} className="border-t">
                  <td className="py-1">{fmtDate(w.key, "d MMM")}</td>
                  <td className="text-right">{w.value.toFixed(2)}</td>
                  <td className="text-right">
                    {arr[i + 1] ? signed(w.value - arr[i + 1].value) : "—"}
                  </td>
                  <td className="text-right text-muted-foreground">
                    {w.min}–{w.max}
                  </td>
                  <td className="text-right">{w.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Monthly averages">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="text-left">Month</th>
                <th className="text-right">Average</th>
                <th className="text-right">Change</th>
                <th className="text-right">Weigh-ins</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[...monthly].reverse().map((m, i, arr) => (
                <tr key={m.key} className="border-t">
                  <td className="py-1">{fmtDate(m.key, "MMMM yyyy")}</td>
                  <td className="text-right">{m.value.toFixed(2)}</td>
                  <td className="text-right">
                    {arr[i + 1] ? signed(m.value - arr[i + 1].value) : "—"}
                  </td>
                  <td className="text-right">{m.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel className="mt-4" title="All weigh-ins" action={<KindBadge kind="measured" />}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="p-1 text-left">Date</th>
                <th className="p-1 text-right">Morning</th>
                <th className="p-1 text-right">Δ prev</th>
                <th className="p-1 text-right">Δ start</th>
                <th className="p-1 text-right">7-day avg</th>
                <th className="p-1 text-right">Δ prev week avg</th>
                <th className="p-1 text-right hidden sm:table-cell">Evening</th>
                <th className="p-1 text-left hidden md:table-cell">Conditions</th>
                <th className="p-1" />
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[...logs].reverse().map((l) => {
                const a = byDate.get(l.log_date)!;
                return (
                  <tr key={l.id} className="border-t">
                    <td className="p-1">
                      {fmtDate(l.log_date, "EEE d MMM")}
                      {l.notes && (
                        <div className="text-[11px] text-muted-foreground">{l.notes}</div>
                      )}
                    </td>
                    <td className="p-1 text-right font-medium">
                      {Number(l.morning_weight_kg).toFixed(2)}
                    </td>
                    <td className="p-1 text-right">{signed(a.diffPrev)}</td>
                    <td className="p-1 text-right">{signed(a.diffStart)}</td>
                    <td className="p-1 text-right">
                      {a.avg7.toFixed(2)}
                      <span className="text-[10px] text-muted-foreground"> ({a.avg7n})</span>
                    </td>
                    <td className="p-1 text-right">{signed(a.diffPrevWeekAvg)}</td>
                    <td className="p-1 text-right hidden sm:table-cell">
                      {l.evening_weight_kg ? Number(l.evening_weight_kg).toFixed(2) : "—"}
                    </td>
                    <td className="p-1 text-xs text-muted-foreground hidden md:table-cell">
                      {l.measured_at?.slice(0, 5) ?? ""}{" "}
                      {l.after_toilet
                        ? "· after toilet"
                        : l.after_toilet === false
                          ? "· before toilet"
                          : ""}{" "}
                      {l.before_food_water
                        ? "· fasted"
                        : l.before_food_water === false
                          ? "· after food/water"
                          : ""}
                    </td>
                    <td className="p-1">
                      <div className="flex justify-end">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Edit"
                          onClick={() => setDlg({ open: true, edit: l })}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <ConfirmDelete
                          what={`weigh-in on ${fmtDate(l.log_date)}`}
                          onConfirm={() => remove.mutateAsync(l.id)}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {logs.length === 0 && (
            <p className="p-4 text-center text-sm text-muted-foreground">No weigh-ins yet.</p>
          )}
        </div>
      </Panel>
      <WeightDialog
        open={dlg.open}
        onOpenChange={(o) => setDlg({ ...dlg, open: o })}
        edit={dlg.edit ?? null}
      />
    </div>
  );
}
