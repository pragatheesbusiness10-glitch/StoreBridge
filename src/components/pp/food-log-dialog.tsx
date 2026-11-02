import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Search, Star } from "lucide-react";
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
import { gramsFromQuantity, macrosFor } from "@/lib/pp/calc";
import { nowTimeStr } from "@/lib/pp/dates";
import { useList, useProfile, useRange, useTableMutations } from "@/lib/pp/db";
import { dietConflict, stateWarning, unitLabel, unitsFor } from "@/lib/pp/diet";
import {
  FOOD_CATEGORIES,
  FOOD_STATES,
  MEAL_TYPES,
  type FoodEntry,
  type FoodItem,
  type FoodState,
  type MealType,
  type QuantityUnit,
} from "@/lib/pp/types";
import { cn } from "@/lib/utils";
import {
  Field,
  KindBadge,
  NativeSelect,
  NumInput,
  Segmented,
  StateBadge,
  Toggle,
  fmtNum,
  parseOptNum,
  strOf,
} from "./ui";

export function defaultMealForNow(): MealType {
  const h = new Date().getHours();
  if (h < 10) return "breakfast";
  if (h < 12) return "mid_morning";
  if (h < 15) return "lunch";
  if (h < 18) return "pre_workout";
  if (h < 21) return "dinner";
  return "late_snack";
}

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  date: string;
  defaultMeal?: MealType;
  /** Restrict the picker to a category (used by the "Log protein" quick action). */
  categoryFilter?: string;
  edit?: FoodEntry | null;
};

export function FoodLogDialog({
  open,
  onOpenChange,
  date,
  defaultMeal,
  categoryFilter,
  edit,
}: Props) {
  const foodsQ = useList<FoodItem>("food_items", { order: "name", filter: { archived: false } });
  const profileQ = useProfile();
  const { insert, update } = useTableMutations("food_entries");

  const [mode, setMode] = useState<"db" | "manual">("db");
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<string>(categoryFilter ?? "");
  const [showAll, setShowAll] = useState(false);
  const [food, setFood] = useState<FoodItem | null>(null);
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState<QuantityUnit>("g");
  const [meal, setMeal] = useState<MealType>(defaultMeal ?? defaultMealForNow());
  const [time, setTime] = useState(nowTimeStr());
  const [notes, setNotes] = useState("");
  const [entryDate, setEntryDate] = useState(date);
  // Entries already logged that day — used to warn about double-counting cooking oil.
  const dayQ = useRange<FoodEntry>("food_entries", "entry_date", entryDate, entryDate, {
    enabled: open,
  });
  const dayEntries = useMemo(() => dayQ.data ?? [], [dayQ.data]);
  // manual
  const [m, setM] = useState({
    name: "",
    state: "cooked" as FoodState,
    category: "other",
    grams: "",
    kcal: "",
    protein: "",
    carbs: "",
    fat: "",
    fibre: "",
  });

  useEffect(() => {
    if (!open) return;
    setEntryDate(edit?.entry_date ?? date);
    setSearch("");
    setCat(categoryFilter ?? "");
    setNotes(edit?.notes ?? "");
    setMeal(edit?.meal_type ?? defaultMeal ?? defaultMealForNow());
    setTime(edit?.meal_time?.slice(0, 5) ?? nowTimeStr());
    if (edit) {
      setMode(edit.nutrition_source === "manual" ? "manual" : "db");
      setQty(String(edit.quantity));
      setUnit(edit.quantity_unit);
      setM({
        name: edit.food_name,
        state: edit.food_state,
        category: edit.food_category ?? "other",
        grams: String(edit.grams),
        kcal: String(edit.kcal),
        protein: String(edit.protein_g),
        carbs: String(edit.carbs_g),
        fat: String(edit.fat_g),
        fibre: strOf(edit.fibre_g),
      });
    } else {
      setMode("db");
      setFood(null);
      setQty("");
      setUnit("g");
      setM({
        name: "",
        state: "cooked",
        category: "other",
        grams: "",
        kcal: "",
        protein: "",
        carbs: "",
        fat: "",
        fibre: "",
      });
    }
  }, [open, edit, date, defaultMeal, categoryFilter]);

  useEffect(() => {
    if (edit && foodsQ.data && edit.food_item_id)
      setFood(foodsQ.data.find((f) => f.id === edit.food_item_id) ?? null);
  }, [edit, foodsQ.data]);

  const foods = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (foodsQ.data ?? [])
      .filter((f) => (!cat ? true : cat === "favorites" ? f.is_favorite : f.category === cat))
      .filter(
        (f) => !s || f.name.toLowerCase().includes(s) || (f.brand ?? "").toLowerCase().includes(s),
      )
      .filter((f) => showAll || !dietConflict(f, profileQ.data) || f.is_favorite || !!s)
      .sort(
        (a, b) => Number(b.is_favorite) - Number(a.is_favorite) || a.name.localeCompare(b.name),
      );
  }, [foodsQ.data, search, cat, showAll, profileQ.data]);

  const qtyNum = parseOptNum(qty, { min: 0 });
  const grams = food && qtyNum ? gramsFromQuantity(qtyNum, unit, food) : null;
  const preview = food && grams ? macrosFor(food, grams) : null;

  const oilWarning = useMemo(() => {
    if (!food || mode !== "db") return null;
    const sameMeal = dayEntries.filter((e) => e.meal_type === meal && e.id !== edit?.id);
    if (food.tracking_tag === "cooking_oil") {
      const withOil = sameMeal.find(
        (e) => (foodsQ.data ?? []).find((f) => f.id === e.food_item_id)?.includes_cooking_oil,
      );
      if (withOil)
        return `"${withOil.food_name}" in this meal already includes cooking oil. Logging oil again would double-count it.`;
    }
    if (food.includes_cooking_oil) {
      const oil = sameMeal.find((e) => e.tracking_tag === "cooking_oil");
      if (oil)
        return `This food's values already include cooking oil, and you logged ${oil.food_name} in this meal. Remove one to avoid double counting.`;
    }
    return null;
  }, [food, mode, dayEntries, meal, edit, foodsQ.data]);

  const pickFood = (f: FoodItem) => {
    setFood(f);
    const units = unitsFor(f);
    if (
      f.unit_weight_g &&
      units.includes("piece") &&
      (f.tracking_tag === "whole_egg" || f.unit_label === "chapati" || f.category === "fruit")
    ) {
      setUnit("piece");
      setQty("1");
    } else {
      setUnit("g");
      setQty(f.default_serving_g ? String(f.default_serving_g) : "");
    }
  };

  const save = async () => {
    const common = {
      entry_date: entryDate,
      meal_type: meal,
      meal_time: time || null,
      notes: notes.trim() || null,
    };
    if (mode === "db") {
      if (!food) return toast.error("Choose a food");
      if (!qtyNum || !grams)
        return toast.error(
          unit === "piece"
            ? "This food has no unit weight — enter grams"
            : "Enter a quantity greater than 0",
        );
      if (grams > 5000) return toast.error("Maximum 5000 g per entry");
      const row = {
        ...common,
        food_item_id: food.id,
        food_name: food.name,
        food_category: food.category,
        food_state: food.state,
        quantity: qtyNum,
        quantity_unit: unit,
        grams,
        // The database trigger recomputes these from the stored per-100 g values; sent for completeness.
        kcal: preview!.kcal,
        protein_g: preview!.protein,
        carbs_g: preview!.carbs,
        fat_g: preview!.fat,
        fibre_g: preview!.fibre,
        nutrition_source: "food_database",
      };
      if (edit) await update.mutateAsync({ id: edit.id, patch: row });
      else await insert.mutateAsync(row);
    } else {
      const g = parseOptNum(m.grams, { min: 0.1, max: 5000 });
      const kcal = parseOptNum(m.kcal, { min: 0, max: 10000 });
      const p = parseOptNum(m.protein, { min: 0, max: 1000 });
      const c = parseOptNum(m.carbs, { min: 0, max: 2000 });
      const f = parseOptNum(m.fat, { min: 0, max: 1000 });
      const fi = parseOptNum(m.fibre, { min: 0, max: 500 });
      if (!m.name.trim()) return toast.error("Enter a food name");
      if (!g) return toast.error("Enter the weight in grams (0.1–5000)");
      if (kcal == null || p == null || c == null || f == null)
        return toast.error("Enter calories, protein, carbs and fat (use 0 if none)");
      if (fi === undefined) return toast.error("Fibre must be a number or empty");
      const row = {
        ...common,
        food_item_id: null,
        food_name: m.name.trim(),
        food_category: m.category,
        food_state: m.state,
        quantity: g,
        quantity_unit: "g",
        grams: g,
        kcal,
        protein_g: p,
        carbs_g: c,
        fat_g: f,
        fibre_g: fi,
        nutrition_source: "manual",
        source_note: "Entered manually",
      };
      if (edit) await update.mutateAsync({ id: edit.id, patch: row });
      else await insert.mutateAsync(row);
    }
    toast.success(edit ? "Entry updated" : "Food logged");
    onOpenChange(false);
  };

  const conflict = food ? dietConflict(food, profileQ.data) : null;
  const sw = food ? stateWarning(food.state, food) : null;
  const busy = insert.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{edit ? "Edit food entry" : "Add food"}</DialogTitle>
          <DialogDescription>
            Nutrients are calculated as grams ÷ 100 × the food's stored per-100 g values.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "db", label: "Food database" },
              { value: "manual", label: "Manual / label" },
            ]}
          />
          <div className="flex gap-2">
            <Input
              type="date"
              aria-label="Date"
              className="h-8 w-[9.5rem]"
              value={entryDate}
              onChange={(e) => e.target.value && setEntryDate(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Meal" id="meal">
            <NativeSelect
              id="meal"
              value={meal}
              onChange={(v) => setMeal(v as MealType)}
              options={MEAL_TYPES}
            />
          </Field>
          <Field label="Time" id="meal-time">
            <Input
              id="meal-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
        </div>

        {mode === "db" ? (
          <>
            {!food || !edit ? (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    autoFocus
                    placeholder="Search foods…"
                    className="pl-8"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <NativeSelect
                    className="h-8 w-auto"
                    value={cat}
                    onChange={setCat}
                    placeholder="All categories"
                    options={[{ value: "favorites", label: "★ Favourites" }, ...FOOD_CATEGORIES]}
                  />
                  <Toggle
                    id="show-all-foods"
                    checked={showAll}
                    onChange={setShowAll}
                    label={<span className="text-xs">Show foods outside my diet</span>}
                  />
                </div>
                <div className="max-h-56 overflow-y-auto rounded-md border divide-y">
                  {foodsQ.isLoading && (
                    <div className="p-3 text-sm text-muted-foreground">Loading…</div>
                  )}
                  {!foodsQ.isLoading && foods.length === 0 && (
                    <div className="p-3 text-sm text-muted-foreground">
                      No matching foods. Add it in Food Database or use Manual.
                    </div>
                  )}
                  {foods.map((f) => {
                    const c = dietConflict(f, profileQ.data);
                    return (
                      <button
                        type="button"
                        key={f.id}
                        onClick={() => pickFood(f)}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted",
                          food?.id === f.id && "bg-accent",
                        )}
                      >
                        {f.is_favorite && <Star className="h-3 w-3 fill-current text-amber-500" />}
                        <span className="flex-1 truncate">{f.name}</span>
                        <StateBadge state={f.state} />
                        {c && (
                          <span className="text-[10px] text-amber-600 dark:text-amber-300">
                            off-plan
                          </span>
                        )}
                        <span className="w-24 text-right text-xs tabular-nums text-muted-foreground">
                          {fmtNum(f.kcal_per_100g, 0)} kcal · {fmtNum(f.protein_per_100g)}P
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {food && (
              <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{food.name}</span>
                  <StateBadge state={food.state} />
                  {conflict && (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                      {conflict}
                    </span>
                  )}
                </div>
                {sw && (
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-300">{sw}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Per 100 g: {fmtNum(food.kcal_per_100g, 0)} kcal · P{" "}
                  {fmtNum(food.protein_per_100g)} g · C {fmtNum(food.carbs_per_100g)} g · F{" "}
                  {fmtNum(food.fat_per_100g)} g · Fibre{" "}
                  {food.fibre_per_100g === null ? "unknown" : `${fmtNum(food.fibre_per_100g)} g`}
                  <br />
                  Source: {food.source}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Quantity" id="qty">
                    <NumInput id="qty" value={qty} onChange={setQty} min={0} autoFocus />
                  </Field>
                  <Field
                    label="Unit"
                    id="unit"
                    hint={
                      unit === "piece" && food.unit_weight_g
                        ? `1 ${food.unit_label ?? "piece"} = ${food.unit_weight_g} g`
                        : unit === "serving" && food.default_serving_g
                          ? `1 serving = ${food.default_serving_g} g`
                          : unit === "ml"
                            ? "1 ml ≈ 1 g"
                            : undefined
                    }
                  >
                    <NativeSelect
                      id="unit"
                      value={unit}
                      onChange={(v) => setUnit(v as QuantityUnit)}
                      options={unitsFor(food).map((u) => ({ value: u, label: unitLabel(u, food) }))}
                    />
                  </Field>
                </div>
                {preview && grams ? (
                  <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
                    {[
                      ["Weight", `${fmtNum(grams)} g`],
                      ["kcal", fmtNum(preview.kcal, 0)],
                      ["Protein", `${fmtNum(preview.protein)} g`],
                      ["Carbs", `${fmtNum(preview.carbs)} g`],
                      ["Fat", `${fmtNum(preview.fat)} g`],
                      ["Fibre", preview.fibre === null ? "?" : `${fmtNum(preview.fibre)} g`],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-md bg-background p-1.5">
                        <div className="text-[10px] uppercase text-muted-foreground">{k}</div>
                        <div className="text-sm font-semibold tabular-nums">{v}</div>
                      </div>
                    ))}
                    <div className="col-span-full flex justify-center">
                      <KindBadge kind="calculated" />
                    </div>
                  </div>
                ) : null}
                {oilWarning && (
                  <div className="flex gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200">
                    <AlertTriangle className="h-4 w-4 shrink-0" /> {oilWarning}
                  </div>
                )}
                {edit && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setFood(null)}>
                    Change food
                  </Button>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <Field label="Food name" id="m-name">
              <Input
                id="m-name"
                value={m.name}
                onChange={(e) => setM({ ...m, name: e.target.value })}
                placeholder="e.g. Restaurant dal tadka"
              />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="State" id="m-state">
                <NativeSelect
                  id="m-state"
                  value={m.state}
                  onChange={(v) => setM({ ...m, state: v as FoodState })}
                  options={FOOD_STATES}
                />
              </Field>
              <Field label="Category" id="m-cat">
                <NativeSelect
                  id="m-cat"
                  value={m.category}
                  onChange={(v) => setM({ ...m, category: v })}
                  options={FOOD_CATEGORIES}
                />
              </Field>
              <Field label="Weight (g)" id="m-g">
                <NumInput id="m-g" value={m.grams} onChange={(v) => setM({ ...m, grams: v })} />
              </Field>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {(
                [
                  ["kcal", "kcal"],
                  ["protein", "Protein g"],
                  ["carbs", "Carbs g"],
                  ["fat", "Fat g"],
                  ["fibre", "Fibre g"],
                ] as const
              ).map(([k, l]) => (
                <Field key={k} label={l} id={`m-${k}`}>
                  <NumInput
                    id={`m-${k}`}
                    value={m[k]}
                    onChange={(v) => setM({ ...m, [k]: v })}
                    placeholder={k === "fibre" ? "?" : ""}
                  />
                </Field>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Totals for the whole portion, as printed on the label or menu. Leave fibre empty if
              unknown.
            </p>
          </div>
        )}

        <Field label="Notes" id="food-notes">
          <Textarea
            id="food-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : edit ? "Save changes" : "Add food"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
