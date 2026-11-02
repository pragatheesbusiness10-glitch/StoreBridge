import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Pencil, Plus } from "lucide-react";
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
import {
  ConfirmDelete,
  EmptyHint,
  Field,
  KindBadge,
  NativeSelect,
  NumInput,
  PageHeader,
  Panel,
  Toggle,
  fmtNum,
  parseOptNum,
  signed,
  strOf,
} from "@/components/pp/ui";
import { round } from "@/lib/pp/calc";
import { daysBetween, fmtDate, todayStr } from "@/lib/pp/dates";
import { errMsg, useList, useProfile, useTableMutations } from "@/lib/pp/db";
import { BODY_FAT_METHODS, type BodyMeasurement } from "@/lib/pp/types";

export const Route = createFileRoute("/fitness/measurements")({
  validateSearch: (s: Record<string, unknown>): { new?: number } => (s.new ? { new: 1 } : {}),
  component: MeasurementsPage,
});

const FIELDS = [
  { key: "waist_cm", label: "Waist", unit: "cm" },
  { key: "chest_cm", label: "Chest", unit: "cm" },
  { key: "neck_cm", label: "Neck", unit: "cm" },
  { key: "left_arm_cm", label: "Left arm", unit: "cm" },
  { key: "right_arm_cm", label: "Right arm", unit: "cm" },
  { key: "left_thigh_cm", label: "Left thigh", unit: "cm" },
  { key: "right_thigh_cm", label: "Right thigh", unit: "cm" },
  { key: "hips_cm", label: "Hips", unit: "cm" },
  { key: "calf_cm", label: "Calf", unit: "cm" },
  { key: "body_fat_pct", label: "Body fat", unit: "%" },
] as const;
const SKINFOLDS = [
  { key: "skinfold_chest_mm", label: "Chest skinfold" },
  { key: "skinfold_abdomen_mm", label: "Abdomen skinfold" },
  { key: "skinfold_thigh_mm", label: "Thigh skinfold" },
  { key: "skinfold_triceps_mm", label: "Triceps skinfold" },
  { key: "skinfold_suprailiac_mm", label: "Suprailiac skinfold" },
] as const;
type Key = (typeof FIELDS)[number]["key"] | (typeof SKINFOLDS)[number]["key"];
const RANGES: Record<string, [number, number]> = {
  waist_cm: [30, 250],
  chest_cm: [30, 250],
  neck_cm: [15, 80],
  left_arm_cm: [10, 80],
  right_arm_cm: [10, 80],
  left_thigh_cm: [20, 120],
  right_thigh_cm: [20, 120],
  hips_cm: [40, 250],
  calf_cm: [15, 70],
  body_fat_pct: [2, 70],
};

function MeasurementsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const listQ = useList<BodyMeasurement>("daily_body_measurements", { order: "measured_on" });
  const profileQ = useProfile();
  const { insert, update, remove } = useTableMutations("daily_body_measurements");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<BodyMeasurement | null>(null);
  const [date, setDate] = useState(todayStr());
  const [vals, setVals] = useState<Record<string, string>>({});
  const [method, setMethod] = useState("");
  const [std, setStd] = useState(true);
  const [notes, setNotes] = useState("");
  const [chartKey, setChartKey] = useState<string>("waist_cm");

  const rows = listQ.data ?? [];
  const openNew = () => {
    const existing = rows.find((r) => r.measured_on === todayStr());
    if (existing) return openEdit(existing);
    setEdit(null);
    setDate(todayStr());
    setVals({});
    setMethod("");
    setStd(true);
    setNotes("");
    setOpen(true);
  };
  const openEdit = (m: BodyMeasurement) => {
    setEdit(m);
    setDate(m.measured_on);
    const v: Record<string, string> = {};
    [...FIELDS, ...SKINFOLDS].forEach((f) => (v[f.key] = strOf(m[f.key as Key])));
    setVals(v);
    setMethod(m.body_fat_method ?? "");
    setStd(m.standardized);
    setNotes(m.notes ?? "");
    setOpen(true);
  };
  useEffect(() => {
    if (search.new && listQ.data) {
      openNew();
      navigate({ to: "/fitness/measurements", search: {}, replace: true });
    }
  }, [search.new, listQ.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const row: Record<string, unknown> = {
      measured_on: date,
      standardized: std,
      notes: notes.trim() || null,
    };
    for (const f of [...FIELDS, ...SKINFOLDS]) {
      const [min, max] = RANGES[f.key] ?? [1, 80];
      const v = parseOptNum(vals[f.key] ?? "", { min, max });
      if (v === undefined) return toast.error(`${f.label} must be between ${min} and ${max}`);
      row[f.key] = v;
    }
    if ([...FIELDS, ...SKINFOLDS].every((f) => row[f.key] === null))
      return toast.error("Enter at least one measurement — empty values are never filled in");
    if (row.body_fat_pct !== null && !method)
      return toast.error("Select how body fat was obtained");
    row.body_fat_method = row.body_fat_pct === null ? null : method;
    try {
      if (edit) await update.mutateAsync({ id: edit.id, patch: row });
      else await insert.mutateAsync(row);
      toast.success("Measurements saved");
      setOpen(false);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const profile = profileQ.data;
  const summary = FIELDS.map((f) => {
    const withVal = rows.filter((r) => r[f.key] !== null);
    // Starting value: the baseline entered at onboarding if any, otherwise the earliest measurement.
    const baseline =
      f.key === "waist_cm"
        ? profile?.initial_waist_cm
        : f.key === "body_fat_pct"
          ? profile?.initial_body_fat_pct
          : null;
    const first = baseline
      ? { v: Number(baseline), d: "profile" }
      : withVal[0]
        ? { v: Number(withVal[0][f.key]), d: withVal[0].measured_on }
        : null;
    const last = withVal[withVal.length - 1]
      ? {
          v: Number(withVal[withVal.length - 1][f.key]),
          d: withVal[withVal.length - 1].measured_on,
        }
      : null;
    const diff = first && last && first.d !== last.d ? round(last.v - first.v, 1) : null;
    const pct = diff !== null && first ? round((diff / first.v) * 100, 1) : null;
    return { ...f, first, last, diff, pct };
  });
  const sel = [...FIELDS, ...SKINFOLDS].find((f) => f.key === chartKey)!;
  const chart = rows
    .filter((r) => r[chartKey as Key] !== null)
    .map((r) => ({ date: r.measured_on, v: Number(r[chartKey as Key]) }));
  const lastStd = [...rows].reverse().find((r) => r.standardized);
  const sinceStd = lastStd ? daysBetween(lastStd.measured_on, todayStr()) : null;

  return (
    <div>
      <PageHeader
        title="Body Measurements"
        description="You can record any day, but weekly measurements taken under the same conditions (same time, before food, relaxed, same tape position) compare most reliably."
        actions={
          <Button size="sm" onClick={openNew}>
            <Plus className="mr-1 h-4 w-4" /> Log measurements
          </Button>
        }
      />
      {sinceStd !== null && sinceStd >= 7 && (
        <p className="mb-3 text-sm text-amber-600 dark:text-amber-300">
          Last standardized measurement was {sinceStd} days ago — time for your weekly check-in.
        </p>
      )}
      <Panel title="Summary" action={<KindBadge kind="measured" />}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="text-left">Measurement</th>
                <th className="text-right">Starting</th>
                <th className="text-right">Latest</th>
                <th className="text-right">Difference</th>
                <th className="text-right">% change</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.key} className="border-t">
                  <td className="py-1.5">{s.label}</td>
                  <td className="text-right">
                    {s.first ? `${fmtNum(s.first.v)} ${s.unit}` : "—"}
                    {s.first && (
                      <div className="text-[10px] text-muted-foreground">
                        {s.first.d === "profile" ? "profile baseline" : fmtDate(s.first.d, "d MMM")}
                      </div>
                    )}
                  </td>
                  <td className="text-right">
                    {s.last ? `${fmtNum(s.last.v)} ${s.unit}` : "—"}
                    {s.last && (
                      <div className="text-[10px] text-muted-foreground">
                        {fmtDate(s.last.d, "d MMM")}
                      </div>
                    )}
                  </td>
                  <td className="text-right">
                    {s.diff !== null ? signed(s.diff, 1, ` ${s.unit}`) : "—"}
                  </td>
                  <td className="text-right">{s.pct !== null ? signed(s.pct, 1, "%") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Blank means not measured. Missing values are never estimated or carried forward.
        </p>
      </Panel>

      <Panel
        className="mt-4"
        title="Progression"
        action={
          <NativeSelect
            className="h-8 w-auto"
            value={chartKey}
            onChange={setChartKey}
            options={[...FIELDS, ...SKINFOLDS].map((f) => ({ value: f.key, label: f.label }))}
          />
        }
      >
        <TimeChart
          data={chart}
          unit={"unit" in sel ? sel.unit : "mm"}
          series={[{ key: "v", label: sel.label, dot: true }]}
          emptyText={`No ${sel.label.toLowerCase()} values recorded.`}
        />
      </Panel>

      <Panel className="mt-4" title="History">
        {rows.length === 0 ? (
          <EmptyHint
            action={
              <Button size="sm" onClick={openNew}>
                Log first measurements
              </Button>
            }
          >
            No measurements yet.
          </EmptyHint>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="p-1 text-left">Date</th>
                  {FIELDS.map((f) => (
                    <th key={f.key} className="p-1 text-right">
                      {f.label}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="whitespace-nowrap p-1">
                      {fmtDate(r.measured_on, "d MMM yy")}
                      {r.standardized && <span className="ml-1 text-[9px] text-primary">STD</span>}
                    </td>
                    {FIELDS.map((f) => (
                      <td key={f.key} className="p-1 text-right">
                        {r[f.key] !== null ? fmtNum(r[f.key]) : ""}
                        {f.key === "body_fat_pct" && r.body_fat_pct !== null && (
                          <div className="text-[9px] text-muted-foreground">
                            {BODY_FAT_METHODS.find((m) => m.value === r.body_fat_method)?.measured
                              ? BODY_FAT_METHODS.find((m) => m.value === r.body_fat_method)?.label
                              : "estimate"}
                          </div>
                        )}
                      </td>
                    ))}
                    <td className="p-1">
                      <div className="flex justify-end">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Edit"
                          onClick={() => openEdit(r)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <ConfirmDelete
                          what={`measurements on ${fmtDate(r.measured_on)}`}
                          onConfirm={() => remove.mutateAsync(r.id)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{edit ? "Edit measurements" : "Log measurements"}</DialogTitle>
            <DialogDescription>
              Fill in only what you actually measured. Leave the rest blank.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Date" id="m-date">
              <Input
                id="m-date"
                type="date"
                value={date}
                max={todayStr()}
                onChange={(e) => e.target.value && setDate(e.target.value)}
              />
            </Field>
            {FIELDS.map((f) => (
              <Field key={f.key} label={`${f.label} (${f.unit})`} id={`m-${f.key}`}>
                <NumInput
                  id={`m-${f.key}`}
                  value={vals[f.key] ?? ""}
                  onChange={(v) => setVals({ ...vals, [f.key]: v })}
                />
              </Field>
            ))}
            {vals.body_fat_pct && (
              <Field label="Body fat method" id="m-bfm" className="col-span-2">
                <NativeSelect
                  id="m-bfm"
                  value={method}
                  onChange={setMethod}
                  placeholder="How was it obtained?"
                  options={BODY_FAT_METHODS.map((m) => ({
                    value: m.value,
                    label: m.label + (m.measured ? "" : " (estimate)"),
                  }))}
                />
              </Field>
            )}
          </div>
          <details className="rounded-md border p-2">
            <summary className="cursor-pointer text-sm">Skinfolds (mm, optional)</summary>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {SKINFOLDS.map((f) => (
                <Field key={f.key} label={f.label} id={`m-${f.key}`}>
                  <NumInput
                    id={`m-${f.key}`}
                    value={vals[f.key] ?? ""}
                    onChange={(v) => setVals({ ...vals, [f.key]: v })}
                  />
                </Field>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Skinfolds are stored as raw readings. Prime Physique does not convert them to body fat
              automatically.
            </p>
          </details>
          <Toggle
            id="m-std"
            checked={std}
            onChange={setStd}
            label="Standardized weekly measurement (same time & conditions)"
          />
          <Field label="Notes" id="m-notes">
            <Textarea
              id="m-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button onClick={save} disabled={insert.isPending || update.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
