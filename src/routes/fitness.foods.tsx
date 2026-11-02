import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, ChefHat, Pencil, Plus, Search, Star, Trash2 } from "lucide-react";
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
import {
  ConfirmDelete,
  EmptyHint,
  Field,
  KindBadge,
  NativeSelect,
  NumInput,
  PageHeader,
  Panel,
  Segmented,
  StateBadge,
  Toggle,
  fmtNum,
  parseOptNum,
  strOf,
} from "@/components/pp/ui";
import { gramsFromQuantity, macrosFor, round, sum } from "@/lib/pp/calc";
import { todayStr } from "@/lib/pp/dates";
import { db, errMsg, useList, useProfile, useTableMutations } from "@/lib/pp/db";
import { dietConflict, unitLabel, unitsFor } from "@/lib/pp/diet";
import {
  FOOD_CATEGORIES,
  FOOD_STATES,
  MEAL_TYPES,
  TRACKING_TAGS,
  mealLabel,
  stateLabel,
  type FoodItem,
  type MealTemplate,
  type MealTemplateItem,
  type MealType,
  type QuantityUnit,
  type RecipeIngredient,
} from "@/lib/pp/types";

type Tab = "foods" | "recipes" | "templates";
export const Route = createFileRoute("/fitness/foods")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } =>
    s.tab === "recipes" || s.tab === "templates" || s.tab === "foods" ? { tab: s.tab } : {},
  component: FoodsPage,
});

function FoodsPage() {
  const { tab: initial } = Route.useSearch();
  const [tab, setTab] = useState<Tab>(initial ?? "foods");
  useEffect(() => {
    if (initial) setTab(initial);
  }, [initial]);
  return (
    <div>
      <PageHeader
        title="Food Database"
        description="Your editable nutrition database. Values are per 100 g in the stated state (raw, cooked, dry…). Correct any value to match your labels."
      />
      <Segmented
        className="mb-4"
        value={tab}
        onChange={setTab}
        options={[
          { value: "foods", label: "Foods" },
          { value: "recipes", label: "Recipes" },
          { value: "templates", label: "Meal templates" },
        ]}
      />
      {tab === "foods" && <FoodsTab />}
      {tab === "recipes" && <RecipesTab />}
      {tab === "templates" && <TemplatesTab />}
    </div>
  );
}

// ======================================================================= foods

type FoodForm = {
  name: string;
  brand: string;
  category: string;
  state: string;
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
  fibre: string;
  unit_label: string;
  unit_weight_g: string;
  default_serving_g: string;
  tracking_tag: string;
  contains_meat: boolean;
  contains_fish: boolean;
  contains_egg: boolean;
  contains_dairy: boolean;
  contains_soy: boolean;
  includes_cooking_oil: boolean;
  source: string;
  notes: string;
};
const emptyFood: FoodForm = {
  name: "",
  brand: "",
  category: "protein",
  state: "raw",
  kcal: "",
  protein: "",
  carbs: "",
  fat: "",
  fibre: "",
  unit_label: "",
  unit_weight_g: "",
  default_serving_g: "",
  tracking_tag: "",
  contains_meat: false,
  contains_fish: false,
  contains_egg: false,
  contains_dairy: false,
  contains_soy: false,
  includes_cooking_oil: false,
  source: "User entered",
  notes: "",
};
const formOf = (f: FoodItem): FoodForm => ({
  name: f.name,
  brand: f.brand ?? "",
  category: f.category,
  state: f.state,
  kcal: strOf(f.kcal_per_100g),
  protein: strOf(f.protein_per_100g),
  carbs: strOf(f.carbs_per_100g),
  fat: strOf(f.fat_per_100g),
  fibre: strOf(f.fibre_per_100g),
  unit_label: f.unit_label ?? "",
  unit_weight_g: strOf(f.unit_weight_g),
  default_serving_g: strOf(f.default_serving_g),
  tracking_tag: f.tracking_tag ?? "",
  contains_meat: f.contains_meat,
  contains_fish: f.contains_fish,
  contains_egg: f.contains_egg,
  contains_dairy: f.contains_dairy,
  contains_soy: f.contains_soy,
  includes_cooking_oil: f.includes_cooking_oil,
  source: f.source,
  notes: f.notes ?? "",
});

function FoodsTab() {
  const foodsQ = useList<FoodItem>("food_items", { order: "name" });
  const profileQ = useProfile();
  const { insert, update, remove } = useTableMutations("food_items", ["food_entries"]);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("");
  const [state, setState] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [edit, setEdit] = useState<FoodItem | null>(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<FoodForm>(emptyFood);
  const [reapplyFrom, setReapplyFrom] = useState<string>("");
  const [reapply, setReapply] = useState(false);

  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (foodsQ.data ?? [])
      .filter((x) => !x.is_recipe)
      .filter((x) => showArchived || !x.archived)
      .filter((x) => !cat || (cat === "favorites" ? x.is_favorite : x.category === cat))
      .filter((x) => !state || x.state === state)
      .filter(
        (x) => !s || x.name.toLowerCase().includes(s) || (x.brand ?? "").toLowerCase().includes(s),
      );
  }, [foodsQ.data, search, cat, state, showArchived]);

  const openNew = () => {
    setEdit(null);
    setF(emptyFood);
    setReapply(false);
    setOpen(true);
  };
  const openEdit = (x: FoodItem) => {
    setEdit(x);
    setF(formOf(x));
    setReapply(false);
    setReapplyFrom(todayStr());
    setOpen(true);
  };

  const save = async () => {
    const kcal = parseOptNum(f.kcal, { min: 0, max: 950 });
    const p = parseOptNum(f.protein, { min: 0, max: 100 });
    const c = parseOptNum(f.carbs, { min: 0, max: 100 });
    const fat = parseOptNum(f.fat, { min: 0, max: 100 });
    const fi = parseOptNum(f.fibre, { min: 0, max: 100 });
    const uw = parseOptNum(f.unit_weight_g, { min: 0.1, max: 2000 });
    const ds = parseOptNum(f.default_serving_g, { min: 0.1, max: 5000 });
    if (!f.name.trim()) return toast.error("Name is required");
    if (kcal == null || p == null || c == null || fat == null)
      return toast.error(
        "Calories, protein, carbs and fat per 100 g are required (0–100 g, kcal 0–950)",
      );
    if (p + c + fat > 100.5)
      return toast.error("Protein + carbs + fat cannot exceed 100 g per 100 g");
    if (fi === undefined || uw === undefined || ds === undefined)
      return toast.error("Check fibre, unit weight and serving values");
    const row = {
      name: f.name.trim(),
      brand: f.brand.trim() || null,
      category: f.category,
      state: f.state,
      kcal_per_100g: kcal,
      protein_per_100g: p,
      carbs_per_100g: c,
      fat_per_100g: fat,
      fibre_per_100g: fi,
      unit_label: f.unit_label.trim() || null,
      unit_weight_g: uw,
      default_serving_g: ds,
      tracking_tag: f.tracking_tag || null,
      contains_meat: f.contains_meat,
      contains_fish: f.contains_fish,
      contains_egg: f.contains_egg,
      contains_dairy: f.contains_dairy,
      contains_soy: f.contains_soy,
      includes_cooking_oil: f.includes_cooking_oil,
      source: f.source.trim() || "User entered",
      notes: f.notes.trim() || null,
    };
    try {
      if (edit) {
        await update.mutateAsync({ id: edit.id, patch: row });
        if (reapply) {
          const { data, error } = await db.rpc("pp_recalculate_food_entries", {
            _food_item_id: edit.id,
            _from: reapplyFrom || null,
          });
          if (error) throw error;
          toast.success(
            `Food corrected and ${data} past entr${data === 1 ? "y" : "ies"} recalculated`,
          );
        } else toast.success("Food updated. Past entries keep the values they were logged with.");
      } else {
        await insert.mutateAsync({ ...row, is_custom: true });
        toast.success("Food added");
      }
      setOpen(false);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const toggleFav = (x: FoodItem) =>
    update.mutate({ id: x.id, patch: { is_favorite: !x.is_favorite } });
  const archive = (x: FoodItem) => update.mutate({ id: x.id, patch: { archived: !x.archived } });
  const del = async (x: FoodItem) => {
    try {
      await remove.mutateAsync(x.id);
      toast.success("Deleted. Past entries keep their logged values.");
    } catch {
      /* toast already shown; recipes referencing it block deletion */
    }
  };

  const set = <K extends keyof FoodForm>(k: K, v: FoodForm[K]) => setF({ ...f, [k]: v });

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search foods…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <NativeSelect
          className="w-auto"
          value={cat}
          onChange={setCat}
          placeholder="All categories"
          options={[
            { value: "favorites", label: "★ Favourites" },
            ...FOOD_CATEGORIES.filter((c) => c.value !== "recipe"),
          ]}
        />
        <NativeSelect
          className="w-auto"
          value={state}
          onChange={setState}
          placeholder="Any state"
          options={FOOD_STATES}
        />
        <Toggle
          id="archived"
          checked={showArchived}
          onChange={setShowArchived}
          label={<span className="text-xs">Show archived</span>}
        />
        <Button size="sm" className="ml-auto" onClick={openNew}>
          <Plus className="mr-1 h-4 w-4" /> Custom food
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="p-2 text-left">Food</th>
              <th className="p-2 text-left">State</th>
              <th className="p-2 text-right">kcal</th>
              <th className="p-2 text-right">Protein</th>
              <th className="p-2 text-right">Carbs</th>
              <th className="p-2 text-right">Fat</th>
              <th className="p-2 text-right">Fibre</th>
              <th className="p-2 text-left hidden md:table-cell">Unit / serving</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {list.map((x) => {
              const c = dietConflict(x, profileQ.data);
              return (
                <tr key={x.id} className={x.archived ? "opacity-50" : ""}>
                  <td className="p-2">
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={() => toggleFav(x)} aria-label="Favourite">
                        <Star
                          className={`h-3.5 w-3.5 ${x.is_favorite ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`}
                        />
                      </button>
                      <span className="font-medium">{x.name}</span>
                      {x.is_custom && <KindBadge kind="entered" />}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {FOOD_CATEGORIES.find((k) => k.value === x.category)?.label}
                      {x.tracking_tag
                        ? ` · tracked as ${TRACKING_TAGS.find((t) => t.value === x.tracking_tag)?.label}`
                        : ""}
                      {c ? ` · ${c}` : ""}
                    </div>
                    <div
                      className="max-w-xs truncate text-[11px] text-muted-foreground/80"
                      title={x.source}
                    >
                      {x.source}
                    </div>
                  </td>
                  <td className="p-2">
                    <StateBadge state={x.state} />
                  </td>
                  <td className="p-2 text-right tabular-nums">{fmtNum(x.kcal_per_100g, 0)}</td>
                  <td className="p-2 text-right tabular-nums">{fmtNum(x.protein_per_100g)}</td>
                  <td className="p-2 text-right tabular-nums">{fmtNum(x.carbs_per_100g)}</td>
                  <td className="p-2 text-right tabular-nums">{fmtNum(x.fat_per_100g)}</td>
                  <td className="p-2 text-right tabular-nums">
                    {x.fibre_per_100g === null ? "?" : fmtNum(x.fibre_per_100g)}
                  </td>
                  <td className="hidden p-2 text-xs text-muted-foreground md:table-cell">
                    {x.unit_weight_g ? `1 ${x.unit_label ?? "piece"} = ${x.unit_weight_g} g` : ""}
                    {x.default_serving_g
                      ? `${x.unit_weight_g ? " · " : ""}serving ${x.default_serving_g} g`
                      : ""}
                  </td>
                  <td className="p-2">
                    <div className="flex justify-end">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Edit"
                        onClick={() => openEdit(x)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={x.archived ? "Unarchive" : "Archive"}
                        onClick={() => archive(x)}
                        title={x.archived ? "Unarchive" : "Archive (hide from pickers)"}
                      >
                        <Archive className="h-4 w-4" />
                      </Button>
                      <ConfirmDelete what={x.name} onConfirm={() => del(x)} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">No foods match.</div>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Values per 100 g. "?" means unknown — it is never assumed to be zero.
      </p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{edit ? "Edit / correct food" : "Custom food"}</DialogTitle>
            <DialogDescription>
              All nutrition values are per 100 g of the food in the selected state. Raw, cooked and
              dry versions must be separate foods.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Name" id="f-name" className="col-span-2">
              <Input id="f-name" value={f.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Brand (optional)" id="f-brand" className="col-span-2">
              <Input id="f-brand" value={f.brand} onChange={(e) => set("brand", e.target.value)} />
            </Field>
            <Field label="Category" id="f-cat">
              <NativeSelect
                id="f-cat"
                value={f.category}
                onChange={(v) => set("category", v)}
                options={FOOD_CATEGORIES.filter((c) => c.value !== "recipe")}
              />
            </Field>
            <Field label="State of values" id="f-state">
              <NativeSelect
                id="f-state"
                value={f.state}
                onChange={(v) => set("state", v)}
                options={FOOD_STATES}
              />
            </Field>
            <Field label="Track as" id="f-tag" hint="Feeds daily chicken/egg/tofu/soya totals">
              <NativeSelect
                id="f-tag"
                value={f.tracking_tag}
                onChange={(v) => set("tracking_tag", v)}
                placeholder="—"
                options={TRACKING_TAGS}
              />
            </Field>
            <div />
            {(
              [
                ["kcal", "kcal / 100 g"],
                ["protein", "Protein g"],
                ["carbs", "Carbs g"],
                ["fat", "Fat g"],
                ["fibre", "Fibre g (blank = unknown)"],
              ] as const
            ).map(([k, l]) => (
              <Field key={k} label={l} id={`f-${k}`}>
                <NumInput id={`f-${k}`} value={f[k]} onChange={(v) => set(k, v)} />
              </Field>
            ))}
            <Field label="Unit name" id="f-ul" hint="e.g. egg, slice, chapati">
              <Input
                id="f-ul"
                value={f.unit_label}
                onChange={(e) => set("unit_label", e.target.value)}
              />
            </Field>
            <Field label="Grams per unit" id="f-uw">
              <NumInput
                id="f-uw"
                value={f.unit_weight_g}
                onChange={(v) => set("unit_weight_g", v)}
              />
            </Field>
            <Field label="Serving size (g)" id="f-ds">
              <NumInput
                id="f-ds"
                value={f.default_serving_g}
                onChange={(v) => set("default_serving_g", v)}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Toggle
              id="f-meat"
              checked={f.contains_meat}
              onChange={(v) => set("contains_meat", v)}
              label="Meat"
            />
            <Toggle
              id="f-fish"
              checked={f.contains_fish}
              onChange={(v) => set("contains_fish", v)}
              label="Fish"
            />
            <Toggle
              id="f-egg"
              checked={f.contains_egg}
              onChange={(v) => set("contains_egg", v)}
              label="Egg"
            />
            <Toggle
              id="f-dairy"
              checked={f.contains_dairy}
              onChange={(v) => set("contains_dairy", v)}
              label="Dairy"
            />
            <Toggle
              id="f-soy"
              checked={f.contains_soy}
              onChange={(v) => set("contains_soy", v)}
              label="Soya"
            />
            <Toggle
              id="f-oil"
              checked={f.includes_cooking_oil}
              onChange={(v) => set("includes_cooking_oil", v)}
              label="Values already include cooking oil"
            />
          </div>
          <Field
            label="Nutrition source"
            id="f-src"
            hint="e.g. package label, USDA FDC id, restaurant website"
          >
            <Input id="f-src" value={f.source} onChange={(e) => set("source", e.target.value)} />
          </Field>
          <Field label="Notes" id="f-notes">
            <Textarea
              id="f-notes"
              rows={2}
              value={f.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
          {edit && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              <Toggle
                id="f-reapply"
                checked={reapply}
                onChange={setReapply}
                label="Also recalculate past entries that used this food"
              />
              {reapply && (
                <Field
                  label="Recalculate entries from"
                  id="f-from"
                  hint="Leave empty to recalculate all past entries"
                >
                  <Input
                    id="f-from"
                    type="date"
                    value={reapplyFrom}
                    onChange={(e) => setReapplyFrom(e.target.value)}
                  />
                </Field>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={insert.isPending || update.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ======================================================================= recipes

function RecipesTab() {
  const qc = useQueryClient();
  const foodsQ = useList<FoodItem>("food_items", { order: "name" });
  const ingQ = useList<RecipeIngredient>("recipe_ingredients", { order: "sort_order" });
  const { remove } = useTableMutations("food_items");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<FoodItem | null>(null);
  const [name, setName] = useState("");
  const [servings, setServings] = useState("");
  const [cooked, setCooked] = useState("");
  const [items, setItems] = useState<{ ingredient_id: string; grams: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const foods = (foodsQ.data ?? []).filter((f) => !f.archived);
  const recipes = foods.filter((f) => f.is_recipe);
  const ingredients = foods.filter((f) => !f.is_recipe);
  const byId = useMemo(() => new Map((foodsQ.data ?? []).map((f) => [f.id, f])), [foodsQ.data]);

  const openNew = () => {
    setEdit(null);
    setName("");
    setServings("2");
    setCooked("");
    setItems([{ ingredient_id: "", grams: "" }]);
    setOpen(true);
  };
  const openEdit = (r: FoodItem) => {
    setEdit(r);
    setName(r.name);
    setServings(strOf(r.recipe_servings));
    setCooked(strOf(r.recipe_total_cooked_g));
    setItems(
      (ingQ.data ?? [])
        .filter((i) => i.recipe_id === r.id)
        .map((i) => ({ ingredient_id: i.ingredient_id, grams: String(i.grams) })),
    );
    setOpen(true);
  };

  const preview = useMemo(() => {
    const valid = items.filter((i) => i.ingredient_id && Number(i.grams) > 0);
    const tot = valid.map((i) => macrosFor(byId.get(i.ingredient_id)!, Number(i.grams)));
    const rawG = sum(valid.map((i) => Number(i.grams)));
    const cookedG = Number(cooked) > 0 ? Number(cooked) : rawG;
    const k = sum(tot.map((t) => t.kcal));
    const p = sum(tot.map((t) => t.protein));
    const sv = Number(servings) > 0 ? Number(servings) : null;
    return {
      rawG,
      cookedG,
      k: round(k, 0),
      p: round(p, 1),
      per100k: cookedG ? round((k / cookedG) * 100, 1) : 0,
      per100p: cookedG ? round((p / cookedG) * 100, 1) : 0,
      perServingK: sv ? round(k / sv, 0) : null,
      perServingP: sv ? round(p / sv, 1) : null,
    };
  }, [items, cooked, servings, byId]);

  const save = async () => {
    const valid = items.filter((i) => i.ingredient_id && Number(i.grams) > 0);
    const sv = parseOptNum(servings, { min: 0.1, max: 1000 });
    const ck = parseOptNum(cooked, { min: 1, max: 100000 });
    if (!name.trim()) return toast.error("Name the recipe");
    if (!valid.length) return toast.error("Add at least one ingredient with grams");
    if (sv === undefined || ck === undefined)
      return toast.error("Check servings and cooked weight");
    setBusy(true);
    try {
      let id = edit?.id;
      const base = {
        name: name.trim(),
        recipe_servings: sv,
        recipe_total_cooked_g: ck,
        category: "recipe",
        state: "cooked",
        is_recipe: true,
        is_custom: true,
      };
      if (id) {
        const { error } = await db.from("food_items").update(base).eq("id", id);
        if (error) throw error;
        const { error: de } = await db.from("recipe_ingredients").delete().eq("recipe_id", id);
        if (de) throw de;
      } else {
        const { data, error } = await db
          .from("food_items")
          .insert({
            ...base,
            kcal_per_100g: 0,
            protein_per_100g: 0,
            carbs_per_100g: 0,
            fat_per_100g: 0,
            source: "Calculated from recipe ingredients",
          })
          .select("id")
          .single();
        if (error) throw error;
        id = (data as { id: string }).id;
      }
      const { error: ie } = await db.from("recipe_ingredients").insert(
        valid.map((i, n) => ({
          recipe_id: id,
          ingredient_id: i.ingredient_id,
          grams: Number(i.grams),
          sort_order: n,
        })),
      );
      if (ie) throw ie;
      const { error: re } = await db.rpc("pp_recompute_recipe", { _recipe_id: id });
      if (re) throw re;
      await qc.invalidateQueries({ queryKey: ["pp"] });
      toast.success("Recipe saved — it can now be logged like any food");
      setOpen(false);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Recipe nutrition = sum of ingredients ÷ finished (cooked) weight. Log recipes by the grams
          you eat or by servings.
        </p>
        <Button size="sm" onClick={openNew}>
          <ChefHat className="mr-1 h-4 w-4" /> New recipe
        </Button>
      </div>
      {recipes.length === 0 ? (
        <EmptyHint>No recipes yet.</EmptyHint>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {recipes.map((r) => {
            const ri = (ingQ.data ?? []).filter((i) => i.recipe_id === r.id);
            return (
              <Panel
                key={r.id}
                title={r.name}
                action={
                  <div className="flex">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Edit recipe"
                      onClick={() => openEdit(r)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <ConfirmDelete what={r.name} onConfirm={() => remove.mutateAsync(r.id)} />
                  </div>
                }
              >
                <div className="text-sm tabular-nums">
                  Per 100 g: {fmtNum(r.kcal_per_100g, 0)} kcal · P {fmtNum(r.protein_per_100g)} · C{" "}
                  {fmtNum(r.carbs_per_100g)} · F {fmtNum(r.fat_per_100g)}
                </div>
                {r.default_serving_g && r.recipe_servings && (
                  <div className="text-sm tabular-nums text-muted-foreground">
                    Per serving ({fmtNum(r.default_serving_g)} g of {fmtNum(r.recipe_servings)}):{" "}
                    {fmtNum((Number(r.kcal_per_100g) * Number(r.default_serving_g)) / 100, 0)} kcal
                    · {fmtNum((Number(r.protein_per_100g) * Number(r.default_serving_g)) / 100)} g
                    protein
                  </div>
                )}
                <ul className="mt-2 text-xs text-muted-foreground">
                  {ri.map((i) => (
                    <li key={i.id}>
                      • {byId.get(i.ingredient_id)?.name} (
                      {stateLabel(byId.get(i.ingredient_id)?.state ?? "")}) — {fmtNum(i.grams)} g
                    </li>
                  ))}
                </ul>
                {r.includes_cooking_oil && (
                  <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-300">
                    Includes cooking oil — don't log the oil separately.
                  </p>
                )}
              </Panel>
            );
          })}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{edit ? "Edit recipe" : "New recipe"}</DialogTitle>
            <DialogDescription>
              Enter each ingredient in the state you weighed it (e.g. raw rice, dry soya).
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Name" id="r-name" className="col-span-3">
              <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Servings" id="r-sv">
              <NumInput id="r-sv" value={servings} onChange={setServings} />
            </Field>
            <Field
              label="Finished weight (g)"
              id="r-ck"
              className="col-span-2"
              hint="Weigh the cooked dish. Blank = sum of ingredient weights."
            >
              <NumInput id="r-ck" value={cooked} onChange={setCooked} />
            </Field>
          </div>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="flex gap-2">
                <NativeSelect
                  className="flex-1"
                  value={it.ingredient_id}
                  placeholder="Ingredient…"
                  onChange={(v) =>
                    setItems(items.map((x, j) => (j === i ? { ...x, ingredient_id: v } : x)))
                  }
                  options={ingredients.map((f) => ({
                    value: f.id,
                    label: `${f.name} (${stateLabel(f.state)})`,
                  }))}
                />
                <NumInput
                  className="w-24"
                  placeholder="g"
                  value={it.grams}
                  onChange={(v) =>
                    setItems(items.map((x, j) => (j === i ? { ...x, grams: v } : x)))
                  }
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove ingredient"
                  onClick={() => setItems(items.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setItems([...items, { ingredient_id: "", grams: "" }])}
            >
              <Plus className="mr-1 h-4 w-4" /> Ingredient
            </Button>
          </div>
          <div className="rounded-md bg-muted/40 p-2 text-xs tabular-nums">
            Total {preview.k} kcal · {preview.p} g protein from {fmtNum(preview.rawG)} g ingredients
            → {preview.per100k} kcal & {preview.per100p} g protein per 100 g of finished dish
            {preview.perServingK !== null &&
              ` · ${preview.perServingK} kcal / ${preview.perServingP} g protein per serving`}
          </div>
          <DialogFooter>
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save recipe"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ======================================================================= templates

function TemplatesTab() {
  const qc = useQueryClient();
  const foodsQ = useList<FoodItem>("food_items", { order: "name" });
  const tplQ = useList<MealTemplate>("meal_templates", { order: "name" });
  const itemsQ = useList<MealTemplateItem>("meal_template_items", { order: "sort_order" });
  const { remove } = useTableMutations("meal_templates", ["meal_template_items"]);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<MealTemplate | null>(null);
  const [name, setName] = useState("");
  const [meal, setMeal] = useState<MealType>("breakfast");
  const [rows, setRows] = useState<
    { food_item_id: string; quantity: string; unit: QuantityUnit }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const foods = (foodsQ.data ?? []).filter((f) => !f.archived);
  const byId = useMemo(() => new Map((foodsQ.data ?? []).map((f) => [f.id, f])), [foodsQ.data]);

  const openNew = () => {
    setEdit(null);
    setName("");
    setMeal("breakfast");
    setRows([{ food_item_id: "", quantity: "", unit: "g" }]);
    setOpen(true);
  };
  const openEdit = (t: MealTemplate) => {
    setEdit(t);
    setName(t.name);
    setMeal(t.meal_type ?? "breakfast");
    setRows(
      (itemsQ.data ?? [])
        .filter((i) => i.template_id === t.id)
        .map((i) => ({
          food_item_id: i.food_item_id,
          quantity: String(i.quantity),
          unit: i.quantity_unit,
        })),
    );
    setOpen(true);
  };

  const save = async () => {
    if (!name.trim()) return toast.error("Name the template");
    const resolved = rows
      .filter((r) => r.food_item_id && Number(r.quantity) > 0)
      .map((r) => ({
        ...r,
        grams: gramsFromQuantity(Number(r.quantity), r.unit, byId.get(r.food_item_id)!),
      }));
    if (!resolved.length) return toast.error("Add at least one food with a quantity");
    if (resolved.some((r) => !r.grams))
      return toast.error("A unit could not be converted to grams for one of the foods — use grams");
    setBusy(true);
    try {
      let id = edit?.id;
      if (id) {
        const { error } = await db
          .from("meal_templates")
          .update({ name: name.trim(), meal_type: meal })
          .eq("id", id);
        if (error) throw error;
        const { error: de } = await db.from("meal_template_items").delete().eq("template_id", id);
        if (de) throw de;
      } else {
        const { data, error } = await db
          .from("meal_templates")
          .insert({ name: name.trim(), meal_type: meal })
          .select("id")
          .single();
        if (error) throw error;
        id = (data as { id: string }).id;
      }
      const { error: ie } = await db.from("meal_template_items").insert(
        resolved.map((r, i) => ({
          template_id: id,
          food_item_id: r.food_item_id,
          quantity: Number(r.quantity),
          quantity_unit: r.unit,
          grams: r.grams,
          sort_order: i,
        })),
      );
      if (ie) throw ie;
      await qc.invalidateQueries({ queryKey: ["pp"] });
      toast.success("Template saved");
      setOpen(false);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Reusable meals. Add them to any day from the Nutrition page.
        </p>
        <Button size="sm" onClick={openNew}>
          <Plus className="mr-1 h-4 w-4" /> New template
        </Button>
      </div>
      {(tplQ.data ?? []).length === 0 ? (
        <EmptyHint>No templates yet.</EmptyHint>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {(tplQ.data ?? []).map((t) => {
            const its = (itemsQ.data ?? []).filter((i) => i.template_id === t.id);
            const tot = its
              .map((i) =>
                byId.get(i.food_item_id)
                  ? macrosFor(byId.get(i.food_item_id)!, Number(i.grams))
                  : null,
              )
              .filter(Boolean) as ReturnType<typeof macrosFor>[];
            return (
              <Panel
                key={t.id}
                title={t.name}
                description={t.meal_type ? mealLabel(t.meal_type) : undefined}
                action={
                  <div className="flex">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Edit template"
                      onClick={() => openEdit(t)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <ConfirmDelete what={t.name} onConfirm={() => remove.mutateAsync(t.id)} />
                  </div>
                }
              >
                <div className="text-sm tabular-nums">
                  {round(sum(tot.map((x) => x.kcal)), 0)} kcal ·{" "}
                  {round(sum(tot.map((x) => x.protein)), 1)} g protein ·{" "}
                  {round(sum(tot.map((x) => x.carbs)), 1)} g carbs ·{" "}
                  {round(sum(tot.map((x) => x.fat)), 1)} g fat <KindBadge kind="calculated" />
                </div>
                <ul className="mt-2 text-xs text-muted-foreground">
                  {its.map((i) => (
                    <li key={i.id}>
                      • {byId.get(i.food_item_id)?.name} —{" "}
                      {i.quantity_unit === "g"
                        ? `${fmtNum(i.grams)} g`
                        : `${fmtNum(i.quantity)} ${i.quantity_unit} (${fmtNum(i.grams)} g)`}
                    </li>
                  ))}
                </ul>
                {t.notes && <p className="mt-1 text-[11px] text-muted-foreground">{t.notes}</p>}
              </Panel>
            );
          })}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{edit ? "Edit template" : "New meal template"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Name" id="t-name">
              <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Meal" id="t-meal">
              <NativeSelect
                id="t-meal"
                value={meal}
                onChange={(v) => setMeal(v as MealType)}
                options={MEAL_TYPES}
              />
            </Field>
          </div>
          <div className="space-y-2">
            {rows.map((r, i) => {
              const food = byId.get(r.food_item_id);
              return (
                <div key={i} className="flex gap-2">
                  <NativeSelect
                    className="flex-1"
                    value={r.food_item_id}
                    placeholder="Food…"
                    onChange={(v) =>
                      setRows(
                        rows.map((x, j) => (j === i ? { ...x, food_item_id: v, unit: "g" } : x)),
                      )
                    }
                    options={foods.map((f) => ({
                      value: f.id,
                      label: `${f.name} (${stateLabel(f.state)})`,
                    }))}
                  />
                  <NumInput
                    className="w-20"
                    value={r.quantity}
                    onChange={(v) =>
                      setRows(rows.map((x, j) => (j === i ? { ...x, quantity: v } : x)))
                    }
                  />
                  <NativeSelect
                    className="w-28"
                    value={r.unit}
                    onChange={(v) =>
                      setRows(rows.map((x, j) => (j === i ? { ...x, unit: v as QuantityUnit } : x)))
                    }
                    options={(food ? unitsFor(food) : (["g"] as QuantityUnit[])).map((u) => ({
                      value: u,
                      label: unitLabel(u, food),
                    }))}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Remove"
                    onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRows([...rows, { food_item_id: "", quantity: "", unit: "g" }])}
            >
              <Plus className="mr-1 h-4 w-4" /> Food
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={save} disabled={busy}>
              Save template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
