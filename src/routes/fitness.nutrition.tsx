import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, CopyPlus, LayoutTemplate, Pencil, Plus, Save } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { DayNav } from "@/components/pp/day-nav";
import { FoodLogDialog } from "@/components/pp/food-log-dialog";
import {
  ConfirmDelete,
  EmptyHint,
  Field,
  KindBadge,
  MetricCard,
  NativeSelect,
  PageHeader,
  Panel,
  StateBadge,
  fmtNum,
} from "@/components/pp/ui";
import { lowCalorieWarning, macroEnergySplit, round, sum, targetStatus } from "@/lib/pp/calc";
import { addDaysStr, nowTimeStr, todayStr } from "@/lib/pp/dates";
import {
  db,
  errMsg,
  targetFor,
  useList,
  useProfile,
  useRange,
  useTableMutations,
  useTargets,
} from "@/lib/pp/db";
import { applyTemplate, copyEntries, saveAsTemplate } from "@/lib/pp/nutrition";
import {
  MEAL_TYPES,
  mealLabel,
  type FoodEntry,
  type FoodItem,
  type MealTemplate,
  type MealTemplateItem,
  type MealType,
} from "@/lib/pp/types";

export const Route = createFileRoute("/fitness/nutrition")({
  component: NutritionPage,
});

function Bar({
  label,
  value,
  min,
  max,
  unit,
}: {
  label: string;
  value: number;
  min: number | null;
  max: number | null;
  unit: string;
}) {
  const st = targetStatus(value, min, max);
  const ref = max ?? min;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums">
          <span
            className={
              st === "within"
                ? "text-[var(--pp-good)] font-semibold"
                : st === "none"
                  ? ""
                  : "text-[var(--pp-warn)] font-semibold"
            }
          >
            {fmtNum(value)}
          </span>
          <span className="text-muted-foreground">
            {" "}
            / {min !== null && max !== null ? `${min}–${max}` : (min ?? max ?? "—")} {unit}
          </span>
        </span>
      </div>
      {ref ? <Progress value={Math.min((value / ref) * 100, 100)} className="mt-1 h-2" /> : null}
    </div>
  );
}

function NutritionPage() {
  const today = todayStr();
  const [date, setDate] = useState(today);
  const qc = useQueryClient();
  const entriesQ = useRange<FoodEntry>("food_entries", "entry_date", date, date, {
    order: "meal_time",
  });
  const weekQ = useRange<FoodEntry>("food_entries", "entry_date", addDaysStr(today, -7), today, {
    select: "entry_date,kcal",
  });
  const foodsQ = useList<FoodItem>("food_items", { order: "name" });
  const tplQ = useList<MealTemplate>("meal_templates", { order: "name" });
  const tplItemsQ = useList<MealTemplateItem>("meal_template_items", { order: "sort_order" });
  const profileQ = useProfile();
  const targetsQ = useTargets();
  const target = targetFor(targetsQ.data, date);
  const { remove } = useTableMutations("food_entries");

  const [dlg, setDlg] = useState<{ open: boolean; meal?: MealType; edit?: FoodEntry | null }>({
    open: false,
  });
  const [tplDlg, setTplDlg] = useState<{ open: boolean; meal: MealType; templateId: string }>({
    open: false,
    meal: "breakfast",
    templateId: "",
  });
  const [saveDlg, setSaveDlg] = useState<{ open: boolean; meal: MealType; name: string }>({
    open: false,
    meal: "breakfast",
    name: "",
  });
  const [busy, setBusy] = useState(false);

  const entries = useMemo(() => entriesQ.data ?? [], [entriesQ.data]);
  const t = useMemo(() => {
    const s = (k: keyof FoodEntry) => round(sum(entries.map((e) => Number(e[k]) || 0)), 1);
    const eggs = entries.filter((e) => e.tracking_tag === "whole_egg");
    return {
      kcal: s("kcal"),
      protein: s("protein_g"),
      carbs: s("carbs_g"),
      fat: s("fat_g"),
      fibre: s("fibre_g"),
      missingFibre: entries.filter((e) => e.fibre_g === null).length,
      grams: s("grams"),
      chicken: round(
        sum(entries.filter((e) => e.tracking_tag === "chicken").map((e) => Number(e.grams))),
        0,
      ),
      chickenRaw: round(
        sum(
          entries
            .filter((e) => e.tracking_tag === "chicken" && e.food_state === "raw")
            .map((e) => Number(e.grams)),
        ),
        0,
      ),
      eggCount: round(
        sum(
          eggs.map((e) =>
            e.quantity_unit === "piece"
              ? Number(e.quantity)
              : e.unit_weight_g
                ? Number(e.grams) / Number(e.unit_weight_g)
                : 0,
          ),
        ),
        1,
      ),
      eggWhite: round(
        sum(entries.filter((e) => e.tracking_tag === "egg_white").map((e) => Number(e.grams))),
        0,
      ),
      tofu: round(
        sum(entries.filter((e) => e.tracking_tag === "tofu").map((e) => Number(e.grams))),
        0,
      ),
      soyaDry: round(
        sum(
          entries
            .filter((e) => e.tracking_tag === "soya" && e.food_state === "dry")
            .map((e) => Number(e.grams)),
        ),
        0,
      ),
      soyaCooked: round(
        sum(
          entries
            .filter((e) => e.tracking_tag === "soya" && e.food_state !== "dry")
            .map((e) => Number(e.grams)),
        ),
        0,
      ),
      powder: round(
        sum(entries.filter((e) => e.tracking_tag === "protein_powder").map((e) => Number(e.grams))),
        0,
      ),
    };
  }, [entries]);
  const split = macroEnergySplit(t.protein, t.carbs, t.fat);
  const pie = [
    {
      name: "Protein",
      value: round(t.protein * 4, 0),
      pct: split.protein,
      color: "var(--chart-1)",
    },
    { name: "Carbs", value: round(t.carbs * 4, 0), pct: split.carbs, color: "var(--chart-2)" },
    { name: "Fat", value: round(t.fat * 9, 0), pct: split.fat, color: "var(--chart-5)" },
  ];

  const weekly = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of weekQ.data ?? [])
      m.set(e.entry_date, (m.get(e.entry_date) ?? 0) + Number(e.kcal));
    return [...m.entries()].map(([d, kcal]) => ({ date: d, kcal }));
  }, [weekQ.data]);
  const lowWarn = profileQ.data
    ? lowCalorieWarning(weekly, today, profileQ.data.low_calorie_warning_kcal)
    : null;

  const refresh = () => qc.invalidateQueries({ queryKey: ["pp"] });

  const duplicateYesterday = async () => {
    setBusy(true);
    try {
      const { data, error } = await db
        .from("food_entries")
        .select("*")
        .eq("entry_date", addDaysStr(date, -1));
      if (error) throw error;
      if (!data?.length) return toast.info("Nothing was logged the previous day");
      const n = await copyEntries(data as FoodEntry[], date);
      toast.success(`Copied ${n} entries from the previous day`);
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const duplicateEntry = async (e: FoodEntry) => {
    try {
      await copyEntries([e], date);
      toast.success("Entry duplicated");
      refresh();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const runTemplate = async () => {
    const items = (tplItemsQ.data ?? []).filter((i) => i.template_id === tplDlg.templateId);
    if (!items.length) return toast.error("Choose a template with items");
    setBusy(true);
    try {
      const n = await applyTemplate(
        items,
        foodsQ.data ?? [],
        date,
        tplDlg.meal,
        date === today ? nowTimeStr() : null,
      );
      toast.success(`Added ${n} items`);
      setTplDlg({ ...tplDlg, open: false });
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const runSaveTemplate = async () => {
    if (!saveDlg.name.trim()) return toast.error("Name the template");
    setBusy(true);
    try {
      const n = await saveAsTemplate(
        saveDlg.name.trim(),
        saveDlg.meal,
        entries.filter((e) => e.meal_type === saveDlg.meal),
      );
      toast.success(`Template saved with ${n} items`);
      setSaveDlg({ ...saveDlg, open: false });
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Nutrition"
        description="Every food, to the gram. Values come from your food database (per 100 g) or from labels you enter."
        actions={
          <>
            <Button size="sm" onClick={() => setDlg({ open: true })}>
              <Plus className="mr-1 h-4 w-4" /> Add food
            </Button>
            <Button size="sm" variant="secondary" onClick={duplicateYesterday} disabled={busy}>
              <Copy className="mr-1 h-4 w-4" /> Copy previous day
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setTplDlg({ open: true, meal: "breakfast", templateId: tplQ.data?.[0]?.id ?? "" })
              }
            >
              <LayoutTemplate className="mr-1 h-4 w-4" /> Use template
            </Button>
          </>
        }
      />
      <div className="mb-4">
        <DayNav date={date} onChange={setDate} />
      </div>

      {lowWarn && date === today && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          Average intake over the last {lowWarn.days} logged days is{" "}
          <b>{fmtNum(lowWarn.avg, 0)} kcal</b> — below your warning level. Persistently low intake
          is not recommended without professional supervision.{" "}
          <Link to="/fitness/settings" className="underline">
            Review targets
          </Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Daily summary"
          className="lg:col-span-2"
          action={<KindBadge kind="calculated" />}
        >
          <div className="space-y-3">
            <Bar
              label="Calories"
              value={t.kcal}
              min={target?.kcal_min ?? null}
              max={target?.kcal_max ?? null}
              unit="kcal"
            />
            <Bar
              label="Protein"
              value={t.protein}
              min={target?.protein_min_g ?? null}
              max={target?.protein_max_g ?? null}
              unit="g"
            />
            <Bar
              label="Carbohydrates"
              value={t.carbs}
              min={target?.carbs_min_g ?? null}
              max={target?.carbs_max_g ?? null}
              unit="g"
            />
            <Bar
              label="Fat"
              value={t.fat}
              min={target?.fat_min_g ?? null}
              max={target?.fat_max_g ?? null}
              unit="g"
            />
            <Bar
              label="Fibre"
              value={t.fibre}
              min={target?.fibre_min_g ?? null}
              max={target?.fibre_max_g ?? null}
              unit="g"
            />
            {t.missingFibre > 0 && (
              <p className="text-xs text-muted-foreground">
                Fibre is unknown for {t.missingFibre} entr{t.missingFibre === 1 ? "y" : "ies"}; the
                total may be understated.
              </p>
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricCard label="Total food" value={fmtNum(t.grams, 0)} unit="g" />
            <MetricCard
              label="Chicken"
              value={fmtNum(t.chicken, 0)}
              unit="g"
              sub={
                t.chicken
                  ? `${t.chickenRaw} g raw · ${t.chicken - t.chickenRaw} g cooked`
                  : undefined
              }
            />
            <MetricCard
              label="Whole eggs"
              value={fmtNum(t.eggCount, 1)}
              sub={t.eggWhite ? `+ ${t.eggWhite} g egg whites` : undefined}
            />
            <MetricCard label="Tofu" value={fmtNum(t.tofu, 0)} unit="g" />
            <MetricCard
              label="Soya (dry)"
              value={fmtNum(t.soyaDry, 0)}
              unit="g"
              sub={t.soyaCooked ? `+ ${t.soyaCooked} g cooked (not added together)` : undefined}
            />
            <MetricCard label="Protein powder" value={fmtNum(t.powder, 0)} unit="g" />
            <MetricCard label="Entries" value={entries.length} />
          </div>
        </Panel>
        <Panel
          title="Energy breakdown"
          description="Share of calories from each macronutrient (4/4/9 kcal per g)."
        >
          {t.kcal > 0 ? (
            <>
              <div className="h-44">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={pie}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {pie.map((p) => (
                        <Cell key={p.name} fill={p.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number, n: string) => [`${v} kcal`, n]}
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-3 text-center text-xs">
                {pie.map((p) => (
                  <div key={p.name}>
                    <div className="mx-auto mb-1 h-2 w-6 rounded" style={{ background: p.color }} />
                    {p.name} <b>{p.pct}%</b>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <EmptyHint>Log food to see the breakdown.</EmptyHint>
          )}
        </Panel>
      </div>

      <div className="mt-4 space-y-3">
        {MEAL_TYPES.map((m) => {
          const items = entries.filter((e) => e.meal_type === m.value);
          const kcal = round(sum(items.map((e) => Number(e.kcal))), 0);
          const protein = round(sum(items.map((e) => Number(e.protein_g))), 1);
          return (
            <Panel
              key={m.value}
              title={
                <span>
                  {m.label}{" "}
                  {items.length > 0 && (
                    <span className="font-normal text-muted-foreground">
                      · {kcal} kcal · {protein} g protein
                    </span>
                  )}
                </span>
              }
              action={
                <div className="flex gap-1">
                  {items.some((e) => e.food_item_id) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setSaveDlg({
                          open: true,
                          meal: m.value,
                          name: `${mealLabel(m.value)} template`,
                        })
                      }
                      title="Save meal as template"
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDlg({ open: true, meal: m.value })}
                  >
                    <Plus className="mr-1 h-4 w-4" /> Add
                  </Button>
                </div>
              }
            >
              {items.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing logged.</p>
              ) : (
                <div className="divide-y">
                  {items.map((e) => (
                    <div
                      key={e.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{e.food_name}</span>
                          <StateBadge state={e.food_state} />
                          {e.nutrition_source === "manual" && <KindBadge kind="entered" />}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {e.quantity_unit === "g"
                            ? `${fmtNum(e.grams)} g`
                            : `${fmtNum(e.quantity)} ${e.quantity_unit} = ${fmtNum(e.grams)} g`}
                          {e.meal_time ? ` · ${e.meal_time.slice(0, 5)}` : ""}
                          {e.notes ? ` · ${e.notes}` : ""}
                        </div>
                        {e.source_note && (
                          <div className="text-[11px] text-muted-foreground/80 truncate">
                            Source: {e.source_note}
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-4 gap-3 text-right text-xs tabular-nums">
                        <div>
                          <div className="font-semibold text-sm">{fmtNum(e.kcal, 0)}</div>kcal
                        </div>
                        <div>
                          <div className="font-semibold text-sm">{fmtNum(e.protein_g)}</div>P
                        </div>
                        <div>
                          <div className="font-semibold text-sm">{fmtNum(e.carbs_g)}</div>C
                        </div>
                        <div>
                          <div className="font-semibold text-sm">{fmtNum(e.fat_g)}</div>F
                        </div>
                      </div>
                      <div className="flex">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Edit"
                          onClick={() => setDlg({ open: true, edit: e })}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Duplicate"
                          onClick={() => duplicateEntry(e)}
                        >
                          <CopyPlus className="h-4 w-4" />
                        </Button>
                        <ConfirmDelete
                          what={e.food_name}
                          onConfirm={() => remove.mutateAsync(e.id)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          );
        })}
      </div>

      <FoodLogDialog
        open={dlg.open}
        onOpenChange={(o) => setDlg({ ...dlg, open: o })}
        date={date}
        defaultMeal={dlg.meal}
        edit={dlg.edit ?? null}
      />

      <Dialog open={tplDlg.open} onOpenChange={(o) => setTplDlg({ ...tplDlg, open: o })}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a meal template</DialogTitle>
          </DialogHeader>
          {tplQ.data?.length ? (
            <div className="space-y-3">
              <Field label="Template" id="tpl">
                <NativeSelect
                  id="tpl"
                  value={tplDlg.templateId}
                  onChange={(v) => setTplDlg({ ...tplDlg, templateId: v })}
                  options={(tplQ.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
                />
              </Field>
              <Field label="Meal" id="tpl-meal">
                <NativeSelect
                  id="tpl-meal"
                  value={tplDlg.meal}
                  onChange={(v) => setTplDlg({ ...tplDlg, meal: v as MealType })}
                  options={MEAL_TYPES}
                />
              </Field>
              <ul className="text-xs text-muted-foreground">
                {(tplItemsQ.data ?? [])
                  .filter((i) => i.template_id === tplDlg.templateId)
                  .map((i) => (
                    <li key={i.id}>
                      • {foodsQ.data?.find((f) => f.id === i.food_item_id)?.name ?? "?"} —{" "}
                      {fmtNum(i.grams)} g
                    </li>
                  ))}
              </ul>
            </div>
          ) : (
            <EmptyHint
              action={
                <Link
                  to="/fitness/foods"
                  search={{ tab: "templates" }}
                  className="text-primary underline"
                >
                  Create one
                </Link>
              }
            >
              No templates yet.
            </EmptyHint>
          )}
          <DialogFooter>
            <Button onClick={runTemplate} disabled={busy || !tplDlg.templateId}>
              Add items
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={saveDlg.open} onOpenChange={(o) => setSaveDlg({ ...saveDlg, open: o })}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save {mealLabel(saveDlg.meal)} as a template</DialogTitle>
          </DialogHeader>
          <Field
            label="Template name"
            id="tpl-name"
            hint="Manual (label) entries are not included — only foods from your database."
          >
            <Input
              id="tpl-name"
              value={saveDlg.name}
              onChange={(e) => setSaveDlg({ ...saveDlg, name: e.target.value })}
            />
          </Field>
          <DialogFooter>
            <Button onClick={runSaveTemplate} disabled={busy}>
              Save template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
