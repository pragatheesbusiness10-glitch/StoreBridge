import { db, unwrap } from "./db";
import type { FoodEntry, FoodItem, MealTemplateItem, MealType } from "./types";

/** Re-log entries on another date. Database-sourced entries are recalculated from the current food values by the server. */
export async function copyEntries(entries: FoodEntry[], toDate: string, mealOverride?: MealType) {
  if (!entries.length) return 0;
  const rows = entries.map((e) => {
    const fromDb = e.nutrition_source === "food_database" && e.food_item_id;
    return {
      entry_date: toDate,
      meal_type: mealOverride ?? e.meal_type,
      meal_time: e.meal_time,
      food_item_id: fromDb ? e.food_item_id : null,
      food_name: e.food_name,
      food_category: e.food_category,
      food_state: e.food_state,
      quantity: e.quantity,
      quantity_unit: e.quantity_unit,
      grams: e.grams,
      kcal: e.kcal,
      protein_g: e.protein_g,
      carbs_g: e.carbs_g,
      fat_g: e.fat_g,
      fibre_g: e.fibre_g,
      tracking_tag: e.tracking_tag,
      unit_weight_g: e.unit_weight_g,
      nutrition_source: fromDb ? "food_database" : "manual",
      source_note: fromDb
        ? null
        : (e.source_note ?? "Copied entry (original food no longer in database)"),
      notes: e.notes,
    };
  });
  await unwrap(db.from("food_entries").insert(rows).select("id"));
  return rows.length;
}

export async function applyTemplate(
  items: MealTemplateItem[],
  foods: FoodItem[],
  date: string,
  meal: MealType,
  time: string | null,
) {
  const byId = new Map(foods.map((f) => [f.id, f]));
  const rows = items
    .filter((i) => byId.has(i.food_item_id))
    .map((i) => {
      const f = byId.get(i.food_item_id)!;
      return {
        entry_date: date,
        meal_type: meal,
        meal_time: time,
        food_item_id: f.id,
        food_name: f.name,
        food_state: f.state,
        quantity: i.quantity,
        quantity_unit: i.quantity_unit,
        grams: i.grams,
        kcal: 0,
        protein_g: 0,
        carbs_g: 0,
        fat_g: 0,
        nutrition_source: "food_database",
      };
    });
  if (!rows.length) return 0;
  await unwrap(db.from("food_entries").insert(rows).select("id"));
  return rows.length;
}

/** Save a meal's database-sourced entries as a reusable template. */
export async function saveAsTemplate(name: string, meal: MealType, entries: FoodEntry[]) {
  const usable = entries.filter((e) => e.food_item_id && e.nutrition_source === "food_database");
  if (!usable.length)
    throw new Error("Only entries from the food database can be saved in a template");
  const [tpl] = await unwrap<{ id: string }[]>(
    db.from("meal_templates").insert({ name, meal_type: meal }).select("id"),
  );
  await unwrap(
    db.from("meal_template_items").insert(
      usable.map((e, i) => ({
        template_id: tpl.id,
        food_item_id: e.food_item_id,
        quantity: e.quantity,
        quantity_unit: e.quantity_unit,
        grams: e.grams,
        sort_order: i,
      })),
    ),
  );
  return usable.length;
}
