// Row shapes for the Prime Physique tables (see supabase/migrations/*prime_physique*).
// Kept hand-written so the module does not depend on regenerated Supabase types.

export type FoodState = "raw" | "cooked" | "dry" | "as_packaged" | "not_applicable";
export type FoodCategory =
  | "protein"
  | "carbohydrate"
  | "fat"
  | "vegetable"
  | "fruit"
  | "beverage"
  | "supplement"
  | "recipe"
  | "other";
export type TrackingTag =
  "chicken" | "whole_egg" | "egg_white" | "tofu" | "soya" | "protein_powder" | "cooking_oil";
export type MealType =
  "breakfast" | "mid_morning" | "lunch" | "pre_workout" | "post_workout" | "dinner" | "late_snack";
export type QuantityUnit = "g" | "ml" | "piece" | "serving" | "cup" | "tbsp" | "tsp";
export type MeasurementType = "weight_reps" | "bodyweight_reps" | "assisted_reps" | "time";
export type BodyFatMethod =
  "dexa" | "bia_scale" | "calipers" | "bod_pod" | "user_estimate" | "other";

export interface FitnessProfile {
  user_id: string;
  display_name: string | null;
  height_cm: number | null;
  age: number | null;
  sex: "male" | "female" | "prefer_not_to_say" | null;
  training_days_per_week: number;
  training_equipment: string | null;
  physique_goal: string | null;
  diet_preference: "vegetarian" | "vegan" | "pescatarian" | "non_vegetarian";
  eggs_allowed: boolean;
  dairy_allowed: boolean;
  soya_allowed: boolean;
  chicken_in_meal_plan: boolean;
  initial_waist_cm: number | null;
  initial_body_fat_pct: number | null;
  initial_body_fat_method: BodyFatMethod | null;
  low_calorie_warning_kcal: number;
  onboarded_at: string | null;
}

export interface Program {
  id: string;
  user_id: string;
  name: string;
  start_date: string;
  start_weight_kg: number;
  target_weight_kg: number;
  duration_weeks: number;
  is_active: boolean;
  notes: string | null;
}

export interface WeightLog {
  id: string;
  log_date: string;
  morning_weight_kg: number;
  measured_at: string | null;
  after_toilet: boolean | null;
  before_food_water: boolean | null;
  evening_weight_kg: number | null;
  notes: string | null;
}

export interface BodyMeasurement {
  id: string;
  measured_on: string;
  waist_cm: number | null;
  chest_cm: number | null;
  neck_cm: number | null;
  left_arm_cm: number | null;
  right_arm_cm: number | null;
  left_thigh_cm: number | null;
  right_thigh_cm: number | null;
  hips_cm: number | null;
  calf_cm: number | null;
  body_fat_pct: number | null;
  body_fat_method: BodyFatMethod | null;
  skinfold_chest_mm: number | null;
  skinfold_abdomen_mm: number | null;
  skinfold_thigh_mm: number | null;
  skinfold_triceps_mm: number | null;
  skinfold_suprailiac_mm: number | null;
  standardized: boolean;
  notes: string | null;
}

export interface FoodItem {
  id: string;
  name: string;
  brand: string | null;
  category: FoodCategory;
  state: FoodState;
  kcal_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  fibre_per_100g: number | null;
  unit_label: string | null;
  unit_weight_g: number | null;
  default_serving_g: number | null;
  tracking_tag: TrackingTag | null;
  contains_meat: boolean;
  contains_fish: boolean;
  contains_egg: boolean;
  contains_dairy: boolean;
  contains_soy: boolean;
  includes_cooking_oil: boolean;
  source: string;
  is_custom: boolean;
  is_recipe: boolean;
  recipe_total_cooked_g: number | null;
  recipe_servings: number | null;
  is_favorite: boolean;
  archived: boolean;
  notes: string | null;
}

export interface FoodEntry {
  id: string;
  entry_date: string;
  meal_type: MealType;
  meal_time: string | null;
  food_item_id: string | null;
  food_name: string;
  food_category: string | null;
  food_state: FoodState;
  quantity: number;
  quantity_unit: QuantityUnit;
  grams: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number | null;
  tracking_tag: TrackingTag | null;
  unit_weight_g: number | null;
  nutrition_source: "food_database" | "manual";
  source_note: string | null;
  notes: string | null;
  created_at: string;
}

export interface RecipeIngredient {
  id: string;
  recipe_id: string;
  ingredient_id: string;
  grams: number;
  sort_order: number;
}

export interface MealTemplate {
  id: string;
  name: string;
  meal_type: MealType | null;
  notes: string | null;
}
export interface MealTemplateItem {
  id: string;
  template_id: string;
  food_item_id: string;
  quantity: number;
  quantity_unit: QuantityUnit;
  grams: number;
  sort_order: number;
}

export interface NutritionTarget {
  id: string;
  effective_from: string;
  kcal_min: number | null;
  kcal_max: number | null;
  protein_min_g: number | null;
  protein_max_g: number | null;
  carbs_min_g: number | null;
  carbs_max_g: number | null;
  fat_min_g: number | null;
  fat_max_g: number | null;
  fibre_min_g: number | null;
  fibre_max_g: number | null;
  water_min_ml: number | null;
  water_max_ml: number | null;
  steps_target: number | null;
  sleep_target_hours: number | null;
  professional_guidance_note: string | null;
}

export interface Exercise {
  id: string;
  name: string;
  muscle_group: string;
  secondary_muscles: string[];
  category: string;
  equipment: string | null;
  measurement_type: MeasurementType;
  instructions: string | null;
  is_custom: boolean;
  archived: boolean;
}

export interface WorkoutPlan {
  id: string;
  name: string;
  day_of_week: number | null;
  focus: string | null;
  is_rest_day: boolean;
  notes: string | null;
  sort_order: number;
}

export interface PlanExercise {
  id: string;
  plan_id: string;
  exercise_id: string;
  sort_order: number;
  target_sets: number;
  target_reps_min: number | null;
  target_reps_max: number | null;
  target_duration_seconds: number | null;
  suggested_weight_kg: number | null;
  rest_seconds: number | null;
  progression_increment_kg: number;
  training_notes: string | null;
}

export interface WorkoutSession {
  id: string;
  session_date: string;
  plan_id: string | null;
  name: string;
  status: "in_progress" | "completed" | "skipped";
  started_at: string | null;
  ended_at: string | null;
  duration_minutes: number | null;
  overall_rpe: number | null;
  notes: string | null;
}

export interface WorkoutExercise {
  id: string;
  session_id: string;
  exercise_id: string | null;
  plan_exercise_id: string | null;
  exercise_name: string;
  muscle_group: string | null;
  category: string | null;
  equipment: string | null;
  measurement_type: MeasurementType;
  sort_order: number;
  rest_seconds: number | null;
  duration_minutes: number | null;
  difficulty_rating: number | null;
  form_quality: "good" | "fair" | "poor" | null;
  pain_reported: boolean;
  notes: string | null;
  created_at?: string;
}

export interface WorkoutSet {
  id: string;
  workout_exercise_id: string;
  set_number: number;
  weight_kg: number | null;
  reps: number | null;
  duration_seconds: number | null;
  is_warmup: boolean;
  rpe: number | null;
  notes: string | null;
}

export interface CardioLog {
  id: string;
  log_date: string;
  activity_type: string;
  activity_label: string | null;
  started_at: string | null;
  duration_minutes: number;
  distance_km: number | null;
  steps: number | null;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  calories_burned: number | null;
  calories_source: "device" | "machine" | "user_estimate" | null;
  notes: string | null;
}

export interface StepLog {
  id: string;
  log_date: string;
  steps: number;
  source: string;
  notes: string | null;
}

export interface WaterLog {
  id: string;
  log_date: string;
  amount_ml: number;
  logged_at: string;
}

export interface SleepLog {
  id: string;
  sleep_date: string;
  bedtime: string;
  wake_time: string;
  duration_minutes: number;
  quality_rating: number | null;
  awakenings: number | null;
  notes: string | null;
}

export interface ProgressPhoto {
  id: string;
  photo_date: string;
  view: "front" | "side" | "back";
  storage_path: string;
  weight_kg: number | null;
  waist_cm: number | null;
  notes: string | null;
}

export interface Achievement {
  id: string;
  code: string;
  title: string;
  achieved_on: string;
  evidence: string;
}

export interface Reminder {
  id: string;
  reminder_type: string;
  title: string;
  time_of_day: string;
  days_of_week: number[];
  enabled: boolean;
}

export interface DailyNote {
  id: string;
  note_date: string;
  energy: number | null;
  hunger: number | null;
  mood: number | null;
  stress: number | null;
  note: string | null;
}

export interface NutritionSummary {
  entry_date: string;
  entry_count: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number | null;
  entries_missing_fibre: number;
  total_food_g: number;
  chicken_g: number;
  whole_egg_g: number;
  whole_egg_count: number;
  egg_white_g: number;
  tofu_g: number;
  soya_g: number;
  protein_powder_g: number;
}

export const MEAL_TYPES: { value: MealType; label: string }[] = [
  { value: "breakfast", label: "Breakfast" },
  { value: "mid_morning", label: "Mid-morning snack" },
  { value: "lunch", label: "Lunch" },
  { value: "pre_workout", label: "Pre-workout" },
  { value: "post_workout", label: "Post-workout" },
  { value: "dinner", label: "Dinner" },
  { value: "late_snack", label: "Late snack" },
];
export const mealLabel = (m: string) => MEAL_TYPES.find((x) => x.value === m)?.label ?? m;

export const FOOD_STATES: { value: FoodState; label: string }[] = [
  { value: "raw", label: "Raw" },
  { value: "cooked", label: "Cooked" },
  { value: "dry", label: "Dry (uncooked)" },
  { value: "as_packaged", label: "As packaged" },
  { value: "not_applicable", label: "N/A (oils, etc.)" },
];
export const stateLabel = (s: string) => FOOD_STATES.find((x) => x.value === s)?.label ?? s;

export const FOOD_CATEGORIES: { value: FoodCategory; label: string }[] = [
  { value: "protein", label: "Protein source" },
  { value: "carbohydrate", label: "Carbohydrate source" },
  { value: "fat", label: "Fat source" },
  { value: "vegetable", label: "Vegetable" },
  { value: "fruit", label: "Fruit" },
  { value: "beverage", label: "Beverage" },
  { value: "supplement", label: "Supplement" },
  { value: "recipe", label: "Recipe" },
  { value: "other", label: "Other" },
];

export const TRACKING_TAGS: { value: TrackingTag; label: string }[] = [
  { value: "chicken", label: "Chicken" },
  { value: "whole_egg", label: "Whole egg" },
  { value: "egg_white", label: "Egg white" },
  { value: "tofu", label: "Tofu" },
  { value: "soya", label: "Soya" },
  { value: "protein_powder", label: "Plant protein powder" },
  { value: "cooking_oil", label: "Cooking oil" },
];

export const MUSCLE_GROUPS = [
  "chest",
  "back",
  "shoulders",
  "biceps",
  "triceps",
  "quadriceps",
  "hamstrings",
  "glutes",
  "calves",
  "core",
  "full_body",
  "mobility",
  "cardio",
] as const;
export const EXERCISE_CATEGORIES = [
  "compound",
  "isolation",
  "core",
  "mobility",
  "conditioning",
  "cardio",
] as const;

export const CARDIO_TYPES = [
  "walking",
  "running",
  "cycling",
  "treadmill",
  "swimming",
  "rowing",
  "elliptical",
  "stair_climber",
  "hiit",
  "other",
] as const;

export const BODY_FAT_METHODS: { value: BodyFatMethod; label: string; measured: boolean }[] = [
  { value: "dexa", label: "DEXA scan", measured: true },
  { value: "bod_pod", label: "Bod Pod", measured: true },
  { value: "calipers", label: "Skinfold calipers", measured: true },
  { value: "bia_scale", label: "BIA / smart scale", measured: true },
  { value: "other", label: "Other device", measured: true },
  { value: "user_estimate", label: "Visual estimate", measured: false },
];

export const titleCase = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
