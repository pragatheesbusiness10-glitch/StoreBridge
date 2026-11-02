import type { FitnessProfile, FoodItem, QuantityUnit } from "./types";

/** Why a food is outside the user's chosen diet (still trackable — just flagged). */
export function dietConflict(
  food: FoodItem,
  profile: FitnessProfile | null | undefined,
): string | null {
  if (!profile) return null;
  const veg = profile.diet_preference === "vegetarian" || profile.diet_preference === "vegan";
  if (food.contains_meat && profile.diet_preference !== "non_vegetarian") {
    if (food.tracking_tag === "chicken" && profile.chicken_in_meal_plan) return null;
    return "Outside your meal plan (meat)";
  }
  if (food.contains_fish && veg) return "Outside your meal plan (fish)";
  if (food.contains_egg && (!profile.eggs_allowed || profile.diet_preference === "vegan"))
    return "Eggs not in your plan";
  if (food.contains_dairy && (!profile.dairy_allowed || profile.diet_preference === "vegan"))
    return "Dairy not in your plan";
  if (food.contains_soy && !profile.soya_allowed) return "Soya not in your plan";
  return null;
}

/** Units that make sense for a given food. */
export function unitsFor(food: FoodItem): QuantityUnit[] {
  const u: QuantityUnit[] = ["g"];
  if (food.unit_weight_g) u.push("piece");
  if (food.default_serving_g) u.push("serving");
  if (food.category === "beverage" || food.tracking_tag === "cooking_oil") u.push("ml");
  if (food.tracking_tag === "cooking_oil" || food.unit_label === "tbsp") u.push("tbsp", "tsp");
  if (food.unit_label === "cup") u.push("cup");
  return [...new Set(u)];
}

export function unitLabel(unit: QuantityUnit, food?: Pick<FoodItem, "unit_label"> | null): string {
  if (unit === "piece") return food?.unit_label ? `${food.unit_label}(s)` : "piece(s)";
  if (unit === "serving") return "serving(s)";
  return unit;
}

export function stateWarning(
  state: string,
  food: Pick<FoodItem, "contains_meat" | "contains_fish" | "tracking_tag">,
): string | null {
  if (state === "dry") return "DRY weight — weigh before soaking or cooking.";
  if (state === "raw" && (food.contains_meat || food.contains_fish))
    return "RAW weight — weigh before cooking. Use the cooked entry for cooked portions.";
  if (state === "cooked") return "COOKED weight — weigh after cooking.";
  return null;
}
