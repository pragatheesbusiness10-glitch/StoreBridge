-- =========================================================================
-- PRIME PHYSIQUE — personal fitness transformation schema
--
-- Additive migration. Does not modify any existing StoreBridge table.
-- The existing public.profiles table is StoreBridge's identity profile
-- (name / email / company); fitness attributes live in fitness_profiles so
-- the two modules stay independent.
--
-- Every table is owned by a single auth user (user_id) and is protected by
-- Row Level Security so users can only ever read or write their own rows.
-- Child tables (sets, plan exercises, recipe ingredients, template items)
-- additionally verify that the parent row belongs to the same user.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. fitness_profiles (1:1 with auth.users)
-- -------------------------------------------------------------------------
CREATE TABLE public.fitness_profiles (
  user_id UUID PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  height_cm NUMERIC(5,1) CHECK (height_cm BETWEEN 100 AND 250),
  age INTEGER CHECK (age BETWEEN 13 AND 100),
  sex TEXT CHECK (sex IN ('male','female','prefer_not_to_say')),
  training_days_per_week INTEGER NOT NULL DEFAULT 6 CHECK (training_days_per_week BETWEEN 0 AND 7),
  training_equipment TEXT,
  physique_goal TEXT,
  diet_preference TEXT NOT NULL DEFAULT 'vegetarian'
    CHECK (diet_preference IN ('vegetarian','vegan','pescatarian','non_vegetarian')),
  eggs_allowed BOOLEAN NOT NULL DEFAULT true,
  dairy_allowed BOOLEAN NOT NULL DEFAULT false,
  soya_allowed BOOLEAN NOT NULL DEFAULT true,
  -- Chicken stays trackable but is excluded from the default meal plan
  chicken_in_meal_plan BOOLEAN NOT NULL DEFAULT false,
  -- Baseline values are optional; NULL means "unknown" and is never invented
  initial_waist_cm NUMERIC(5,1) CHECK (initial_waist_cm BETWEEN 30 AND 250),
  initial_body_fat_pct NUMERIC(4,1) CHECK (initial_body_fat_pct BETWEEN 2 AND 70),
  initial_body_fat_method TEXT CHECK (initial_body_fat_method IN ('dexa','bia_scale','calipers','bod_pod','user_estimate','other')),
  -- Warn when the 7-day average intake falls below this value (user-configurable)
  low_calorie_warning_kcal INTEGER NOT NULL DEFAULT 1600 CHECK (low_calorie_warning_kcal BETWEEN 800 AND 5000),
  onboarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------------------
-- 2. transformation_programs
-- -------------------------------------------------------------------------
CREATE TABLE public.transformation_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Transformation',
  start_date DATE NOT NULL,
  start_weight_kg NUMERIC(5,2) NOT NULL CHECK (start_weight_kg BETWEEN 30 AND 400),
  target_weight_kg NUMERIC(5,2) NOT NULL CHECK (target_weight_kg BETWEEN 30 AND 400),
  duration_weeks INTEGER NOT NULL CHECK (duration_weeks BETWEEN 1 AND 156),
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX transformation_programs_one_active ON public.transformation_programs (user_id) WHERE is_active;

-- -------------------------------------------------------------------------
-- 3. daily_weight_logs
-- -------------------------------------------------------------------------
CREATE TABLE public.daily_weight_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  morning_weight_kg NUMERIC(5,2) NOT NULL CHECK (morning_weight_kg BETWEEN 20 AND 400),
  measured_at TIME,
  after_toilet BOOLEAN,
  before_food_water BOOLEAN,
  evening_weight_kg NUMERIC(5,2) CHECK (evening_weight_kg BETWEEN 20 AND 400),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, log_date)
);

-- -------------------------------------------------------------------------
-- 4. daily_body_measurements
-- -------------------------------------------------------------------------
CREATE TABLE public.daily_body_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  measured_on DATE NOT NULL,
  waist_cm NUMERIC(5,1) CHECK (waist_cm BETWEEN 30 AND 250),
  chest_cm NUMERIC(5,1) CHECK (chest_cm BETWEEN 30 AND 250),
  neck_cm NUMERIC(5,1) CHECK (neck_cm BETWEEN 15 AND 80),
  left_arm_cm NUMERIC(5,1) CHECK (left_arm_cm BETWEEN 10 AND 80),
  right_arm_cm NUMERIC(5,1) CHECK (right_arm_cm BETWEEN 10 AND 80),
  left_thigh_cm NUMERIC(5,1) CHECK (left_thigh_cm BETWEEN 20 AND 120),
  right_thigh_cm NUMERIC(5,1) CHECK (right_thigh_cm BETWEEN 20 AND 120),
  hips_cm NUMERIC(5,1) CHECK (hips_cm BETWEEN 40 AND 250),
  calf_cm NUMERIC(5,1) CHECK (calf_cm BETWEEN 15 AND 70),
  body_fat_pct NUMERIC(4,1) CHECK (body_fat_pct BETWEEN 2 AND 70),
  -- How body fat was obtained. 'user_estimate' is shown as an estimate, never as measured.
  body_fat_method TEXT CHECK (body_fat_method IN ('dexa','bia_scale','calipers','bod_pod','user_estimate','other')),
  skinfold_chest_mm NUMERIC(4,1) CHECK (skinfold_chest_mm BETWEEN 1 AND 80),
  skinfold_abdomen_mm NUMERIC(4,1) CHECK (skinfold_abdomen_mm BETWEEN 1 AND 80),
  skinfold_thigh_mm NUMERIC(4,1) CHECK (skinfold_thigh_mm BETWEEN 1 AND 80),
  skinfold_triceps_mm NUMERIC(4,1) CHECK (skinfold_triceps_mm BETWEEN 1 AND 80),
  skinfold_suprailiac_mm NUMERIC(4,1) CHECK (skinfold_suprailiac_mm BETWEEN 1 AND 80),
  standardized BOOLEAN NOT NULL DEFAULT false, -- same time / conditions as previous weekly measurement
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, measured_on),
  CONSTRAINT body_measurements_has_value CHECK (num_nonnulls(
    waist_cm, chest_cm, neck_cm, left_arm_cm, right_arm_cm, left_thigh_cm, right_thigh_cm,
    hips_cm, calf_cm, body_fat_pct, skinfold_chest_mm, skinfold_abdomen_mm, skinfold_thigh_mm,
    skinfold_triceps_mm, skinfold_suprailiac_mm) > 0),
  CONSTRAINT body_fat_requires_method CHECK (body_fat_pct IS NULL OR body_fat_method IS NOT NULL)
);

-- -------------------------------------------------------------------------
-- 5. food_items (per-user editable food database; values per 100 g)
-- -------------------------------------------------------------------------
CREATE TABLE public.food_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  brand TEXT,
  category TEXT NOT NULL CHECK (category IN ('protein','carbohydrate','fat','vegetable','fruit','beverage','supplement','recipe','other')),
  -- State the nutrition values refer to. Raw/dry/cooked are distinct foods, never mixed.
  state TEXT NOT NULL CHECK (state IN ('raw','cooked','dry','as_packaged','not_applicable')),
  kcal_per_100g NUMERIC(6,1) NOT NULL CHECK (kcal_per_100g BETWEEN 0 AND 950),
  protein_per_100g NUMERIC(5,2) NOT NULL CHECK (protein_per_100g BETWEEN 0 AND 100),
  carbs_per_100g NUMERIC(5,2) NOT NULL CHECK (carbs_per_100g BETWEEN 0 AND 100),
  fat_per_100g NUMERIC(5,2) NOT NULL CHECK (fat_per_100g BETWEEN 0 AND 100),
  fibre_per_100g NUMERIC(5,2) CHECK (fibre_per_100g BETWEEN 0 AND 100),
  unit_label TEXT,                       -- e.g. 'egg', 'chapati', 'slice'
  unit_weight_g NUMERIC(6,1) CHECK (unit_weight_g > 0 AND unit_weight_g <= 2000),
  default_serving_g NUMERIC(6,1) CHECK (default_serving_g > 0 AND default_serving_g <= 5000),
  tracking_tag TEXT CHECK (tracking_tag IN ('chicken','whole_egg','egg_white','tofu','soya','protein_powder','cooking_oil')),
  contains_meat BOOLEAN NOT NULL DEFAULT false,
  contains_fish BOOLEAN NOT NULL DEFAULT false,
  contains_egg BOOLEAN NOT NULL DEFAULT false,
  contains_dairy BOOLEAN NOT NULL DEFAULT false,
  contains_soy BOOLEAN NOT NULL DEFAULT false,
  -- True when the stored values already include cooking oil (used to warn about double counting)
  includes_cooking_oil BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'User entered',
  is_custom BOOLEAN NOT NULL DEFAULT true,
  is_recipe BOOLEAN NOT NULL DEFAULT false,
  recipe_total_cooked_g NUMERIC(7,1) CHECK (recipe_total_cooked_g > 0),
  recipe_servings NUMERIC(5,1) CHECK (recipe_servings > 0),
  is_favorite BOOLEAN NOT NULL DEFAULT false,
  archived BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT food_macros_plausible CHECK (protein_per_100g + carbs_per_100g + fat_per_100g <= 100.5)
);
CREATE UNIQUE INDEX food_items_user_name_state ON public.food_items (user_id, lower(name), state) WHERE NOT archived;
CREATE INDEX food_items_user_idx ON public.food_items (user_id);

-- Recipe ingredients (a recipe is a food_items row with is_recipe = true)
CREATE TABLE public.recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES public.food_items(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES public.food_items(id) ON DELETE RESTRICT,
  grams NUMERIC(7,1) NOT NULL CHECK (grams > 0 AND grams <= 20000),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recipe_not_self CHECK (recipe_id <> ingredient_id)
);
CREATE INDEX recipe_ingredients_recipe_idx ON public.recipe_ingredients (recipe_id);

-- -------------------------------------------------------------------------
-- 6. food_entries
-- -------------------------------------------------------------------------
CREATE TABLE public.food_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast','mid_morning','lunch','pre_workout','post_workout','dinner','late_snack')),
  meal_time TIME,
  food_item_id UUID REFERENCES public.food_items(id) ON DELETE SET NULL,
  -- Snapshot of the food at logging time so history survives later edits of the food database
  food_name TEXT NOT NULL CHECK (length(trim(food_name)) > 0),
  food_category TEXT,
  food_state TEXT NOT NULL CHECK (food_state IN ('raw','cooked','dry','as_packaged','not_applicable')),
  quantity NUMERIC(8,2) NOT NULL CHECK (quantity > 0),
  quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('g','ml','piece','serving','cup','tbsp','tsp')),
  grams NUMERIC(7,1) NOT NULL CHECK (grams > 0 AND grams <= 5000),
  kcal NUMERIC(7,1) NOT NULL CHECK (kcal >= 0),
  protein_g NUMERIC(6,2) NOT NULL CHECK (protein_g >= 0),
  carbs_g NUMERIC(6,2) NOT NULL CHECK (carbs_g >= 0),
  fat_g NUMERIC(6,2) NOT NULL CHECK (fat_g >= 0),
  fibre_g NUMERIC(6,2) CHECK (fibre_g >= 0),
  tracking_tag TEXT CHECK (tracking_tag IN ('chicken','whole_egg','egg_white','tofu','soya','protein_powder','cooking_oil')),
  unit_weight_g NUMERIC(6,1),
  -- 'food_database': nutrients derived from the referenced food's stored per-100 g values (by trigger)
  -- 'manual': nutrients typed in by the user (e.g. from a restaurant label)
  nutrition_source TEXT NOT NULL DEFAULT 'food_database' CHECK (nutrition_source IN ('food_database','manual')),
  source_note TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX food_entries_user_date_idx ON public.food_entries (user_id, entry_date);
CREATE INDEX food_entries_food_idx ON public.food_entries (food_item_id);

-- Derive nutrients from the food database: Nutrient = grams / 100 × value per 100 g.
-- Runs as the invoking user, so the lookup is itself subject to RLS.
CREATE OR REPLACE FUNCTION public.pp_food_entry_compute()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE f public.food_items%ROWTYPE;
BEGIN
  IF NEW.nutrition_source = 'food_database' THEN
    IF NEW.food_item_id IS NULL THEN
      IF TG_OP = 'INSERT' THEN
        RAISE EXCEPTION 'food_item_id is required when nutrition_source = food_database';
      END IF;
      RETURN NEW; -- food was deleted later; keep the stored snapshot
    END IF;
    IF TG_OP = 'INSERT'
       OR NEW.grams IS DISTINCT FROM OLD.grams
       OR NEW.food_item_id IS DISTINCT FROM OLD.food_item_id
       OR NEW.nutrition_source IS DISTINCT FROM OLD.nutrition_source THEN
      SELECT * INTO f FROM public.food_items WHERE id = NEW.food_item_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Food item not found'; END IF;
      NEW.food_name := f.name;
      NEW.food_category := f.category;
      NEW.food_state := f.state;
      NEW.tracking_tag := f.tracking_tag;
      NEW.unit_weight_g := f.unit_weight_g;
      NEW.kcal := round(NEW.grams / 100.0 * f.kcal_per_100g, 1);
      NEW.protein_g := round(NEW.grams / 100.0 * f.protein_per_100g, 2);
      NEW.carbs_g := round(NEW.grams / 100.0 * f.carbs_per_100g, 2);
      NEW.fat_g := round(NEW.grams / 100.0 * f.fat_per_100g, 2);
      NEW.fibre_g := CASE WHEN f.fibre_per_100g IS NULL THEN NULL ELSE round(NEW.grams / 100.0 * f.fibre_per_100g, 2) END;
      NEW.source_note := f.source;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_food_entries_compute
BEFORE INSERT OR UPDATE ON public.food_entries
FOR EACH ROW EXECUTE FUNCTION public.pp_food_entry_compute();

-- Re-apply the current food database values to existing entries (user-initiated correction).
CREATE OR REPLACE FUNCTION public.pp_recalculate_food_entries(_food_item_id UUID, _from DATE DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE n INTEGER;
BEGIN
  UPDATE public.food_entries e SET
    food_name = f.name, food_category = f.category, food_state = f.state,
    tracking_tag = f.tracking_tag, unit_weight_g = f.unit_weight_g,
    kcal = round(e.grams / 100.0 * f.kcal_per_100g, 1),
    protein_g = round(e.grams / 100.0 * f.protein_per_100g, 2),
    carbs_g = round(e.grams / 100.0 * f.carbs_per_100g, 2),
    fat_g = round(e.grams / 100.0 * f.fat_per_100g, 2),
    fibre_g = CASE WHEN f.fibre_per_100g IS NULL THEN NULL ELSE round(e.grams / 100.0 * f.fibre_per_100g, 2) END,
    source_note = f.source
  FROM public.food_items f
  WHERE f.id = e.food_item_id AND e.food_item_id = _food_item_id
    AND e.nutrition_source = 'food_database'
    AND (_from IS NULL OR e.entry_date >= _from);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.pp_recalculate_food_entries(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pp_recalculate_food_entries(UUID, DATE) TO authenticated;

-- -------------------------------------------------------------------------
-- Meal templates (saved meals)
-- -------------------------------------------------------------------------
CREATE TABLE public.meal_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  meal_type TEXT CHECK (meal_type IN ('breakfast','mid_morning','lunch','pre_workout','post_workout','dinner','late_snack')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.meal_template_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.meal_templates(id) ON DELETE CASCADE,
  food_item_id UUID NOT NULL REFERENCES public.food_items(id) ON DELETE CASCADE,
  quantity NUMERIC(8,2) NOT NULL CHECK (quantity > 0),
  quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('g','ml','piece','serving','cup','tbsp','tsp')),
  grams NUMERIC(7,1) NOT NULL CHECK (grams > 0 AND grams <= 5000),
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX meal_template_items_tpl_idx ON public.meal_template_items (template_id);

-- -------------------------------------------------------------------------
-- 7. nutrition_targets (effective-dated, editable)
-- -------------------------------------------------------------------------
CREATE TABLE public.nutrition_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  effective_from DATE NOT NULL,
  kcal_min INTEGER CHECK (kcal_min BETWEEN 800 AND 8000),
  kcal_max INTEGER CHECK (kcal_max BETWEEN 800 AND 8000),
  protein_min_g INTEGER CHECK (protein_min_g BETWEEN 0 AND 500),
  protein_max_g INTEGER CHECK (protein_max_g BETWEEN 0 AND 500),
  carbs_min_g INTEGER CHECK (carbs_min_g BETWEEN 0 AND 1000),
  carbs_max_g INTEGER CHECK (carbs_max_g BETWEEN 0 AND 1000),
  fat_min_g INTEGER CHECK (fat_min_g BETWEEN 0 AND 400),
  fat_max_g INTEGER CHECK (fat_max_g BETWEEN 0 AND 400),
  fibre_min_g INTEGER CHECK (fibre_min_g BETWEEN 0 AND 150),
  fibre_max_g INTEGER CHECK (fibre_max_g BETWEEN 0 AND 150),
  water_min_ml INTEGER CHECK (water_min_ml BETWEEN 0 AND 10000),
  water_max_ml INTEGER CHECK (water_max_ml BETWEEN 0 AND 10000),
  steps_target INTEGER CHECK (steps_target BETWEEN 0 AND 100000),
  sleep_target_hours NUMERIC(3,1) CHECK (sleep_target_hours BETWEEN 3 AND 14),
  professional_guidance_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, effective_from),
  CHECK (kcal_min IS NULL OR kcal_max IS NULL OR kcal_min <= kcal_max),
  CHECK (protein_min_g IS NULL OR protein_max_g IS NULL OR protein_min_g <= protein_max_g),
  CHECK (carbs_min_g IS NULL OR carbs_max_g IS NULL OR carbs_min_g <= carbs_max_g),
  CHECK (fat_min_g IS NULL OR fat_max_g IS NULL OR fat_min_g <= fat_max_g),
  CHECK (fibre_min_g IS NULL OR fibre_max_g IS NULL OR fibre_min_g <= fibre_max_g),
  CHECK (water_min_ml IS NULL OR water_max_ml IS NULL OR water_min_ml <= water_max_ml)
);

-- -------------------------------------------------------------------------
-- 9. exercise_library
-- -------------------------------------------------------------------------
CREATE TABLE public.exercise_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  muscle_group TEXT NOT NULL CHECK (muscle_group IN ('chest','back','shoulders','biceps','triceps','quadriceps','hamstrings','glutes','calves','core','full_body','mobility','cardio')),
  secondary_muscles TEXT[] NOT NULL DEFAULT '{}',
  category TEXT NOT NULL CHECK (category IN ('compound','isolation','core','mobility','conditioning','cardio')),
  equipment TEXT,
  -- weight_reps: load × reps (counts toward volume)
  -- bodyweight_reps / assisted_reps: reps only (assistance load is not counted as volume)
  -- time: duration-based holds (plank)
  measurement_type TEXT NOT NULL DEFAULT 'weight_reps' CHECK (measurement_type IN ('weight_reps','bodyweight_reps','assisted_reps','time')),
  instructions TEXT,
  is_custom BOOLEAN NOT NULL DEFAULT true,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX exercise_library_user_name ON public.exercise_library (user_id, lower(name));

-- -------------------------------------------------------------------------
-- 10. workout_plans + plan exercises (planned, never "completed")
-- -------------------------------------------------------------------------
CREATE TABLE public.workout_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  day_of_week SMALLINT CHECK (day_of_week BETWEEN 1 AND 7), -- ISO: 1 = Monday … 7 = Sunday
  focus TEXT,
  is_rest_day BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX workout_plans_user_idx ON public.workout_plans (user_id, day_of_week);

CREATE TABLE public.workout_plan_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.workout_plans(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES public.exercise_library(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  target_sets INTEGER NOT NULL DEFAULT 3 CHECK (target_sets BETWEEN 1 AND 20),
  target_reps_min INTEGER CHECK (target_reps_min BETWEEN 1 AND 100),
  target_reps_max INTEGER CHECK (target_reps_max BETWEEN 1 AND 100),
  target_duration_seconds INTEGER CHECK (target_duration_seconds BETWEEN 1 AND 3600),
  -- Blank until the user assesses their working weight. Never pre-filled with an assumed load.
  suggested_weight_kg NUMERIC(6,2) CHECK (suggested_weight_kg BETWEEN 0 AND 1000),
  rest_seconds INTEGER CHECK (rest_seconds BETWEEN 0 AND 900),
  progression_increment_kg NUMERIC(4,2) NOT NULL DEFAULT 2.5 CHECK (progression_increment_kg BETWEEN 0 AND 20),
  training_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (target_reps_min IS NULL OR target_reps_max IS NULL OR target_reps_min <= target_reps_max)
);
CREATE INDEX workout_plan_exercises_plan_idx ON public.workout_plan_exercises (plan_id, sort_order);

-- -------------------------------------------------------------------------
-- 11–13. workout_sessions → workout_exercises → workout_sets (actual performance)
-- -------------------------------------------------------------------------
CREATE TABLE public.workout_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  plan_id UUID REFERENCES public.workout_plans(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','skipped')),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_minutes INTEGER CHECK (duration_minutes BETWEEN 0 AND 600),
  overall_rpe NUMERIC(3,1) CHECK (overall_rpe BETWEEN 1 AND 10),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX workout_sessions_user_date_idx ON public.workout_sessions (user_id, session_date);

CREATE TABLE public.workout_exercises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.workout_sessions(id) ON DELETE CASCADE,
  exercise_id UUID REFERENCES public.exercise_library(id) ON DELETE SET NULL,
  plan_exercise_id UUID REFERENCES public.workout_plan_exercises(id) ON DELETE SET NULL,
  exercise_name TEXT NOT NULL CHECK (length(trim(exercise_name)) > 0),
  muscle_group TEXT,
  category TEXT,
  equipment TEXT,
  measurement_type TEXT NOT NULL DEFAULT 'weight_reps' CHECK (measurement_type IN ('weight_reps','bodyweight_reps','assisted_reps','time')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  rest_seconds INTEGER CHECK (rest_seconds BETWEEN 0 AND 900),
  duration_minutes INTEGER CHECK (duration_minutes BETWEEN 0 AND 300),
  difficulty_rating SMALLINT CHECK (difficulty_rating BETWEEN 1 AND 10),
  form_quality TEXT CHECK (form_quality IN ('good','fair','poor')),
  pain_reported BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX workout_exercises_session_idx ON public.workout_exercises (session_id, sort_order);
CREATE INDEX workout_exercises_user_ex_idx ON public.workout_exercises (user_id, exercise_id);

CREATE TABLE public.workout_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  workout_exercise_id UUID NOT NULL REFERENCES public.workout_exercises(id) ON DELETE CASCADE,
  set_number INTEGER NOT NULL CHECK (set_number BETWEEN 1 AND 100),
  weight_kg NUMERIC(6,2) CHECK (weight_kg BETWEEN 0 AND 1000),
  reps INTEGER CHECK (reps BETWEEN 0 AND 1000),
  duration_seconds INTEGER CHECK (duration_seconds BETWEEN 0 AND 7200),
  is_warmup BOOLEAN NOT NULL DEFAULT false,
  rpe NUMERIC(3,1) CHECK (rpe BETWEEN 1 AND 10),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workout_set_has_work CHECK (reps IS NOT NULL OR duration_seconds IS NOT NULL)
);
CREATE INDEX workout_sets_exercise_idx ON public.workout_sets (workout_exercise_id, set_number);

-- -------------------------------------------------------------------------
-- 14. cardio_logs  + step_logs (whole-day step count)
-- -------------------------------------------------------------------------
CREATE TABLE public.cardio_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('walking','running','cycling','treadmill','swimming','rowing','elliptical','stair_climber','hiit','other')),
  activity_label TEXT,
  started_at TIME,
  duration_minutes NUMERIC(5,1) NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 1440),
  distance_km NUMERIC(6,2) CHECK (distance_km >= 0 AND distance_km <= 500),
  steps INTEGER CHECK (steps BETWEEN 0 AND 200000),
  avg_heart_rate INTEGER CHECK (avg_heart_rate BETWEEN 30 AND 240),
  max_heart_rate INTEGER CHECK (max_heart_rate BETWEEN 30 AND 240),
  -- Optional, only as reported by the user or their device. Never derived from steps.
  calories_burned INTEGER CHECK (calories_burned BETWEEN 0 AND 10000),
  calories_source TEXT CHECK (calories_source IN ('device','machine','user_estimate')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cardio_logs_user_date_idx ON public.cardio_logs (user_id, log_date);

CREATE TABLE public.step_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  steps INTEGER NOT NULL CHECK (steps BETWEEN 0 AND 200000),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','phone','watch','other_device')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, log_date)
);

-- -------------------------------------------------------------------------
-- 15. water_logs
-- -------------------------------------------------------------------------
CREATE TABLE public.water_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  amount_ml INTEGER NOT NULL CHECK (amount_ml BETWEEN 1 AND 5000),
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX water_logs_user_date_idx ON public.water_logs (user_id, log_date);

-- -------------------------------------------------------------------------
-- 16. sleep_logs
-- -------------------------------------------------------------------------
CREATE TABLE public.sleep_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  sleep_date DATE NOT NULL, -- the date the user woke up
  bedtime TIMESTAMPTZ NOT NULL,
  wake_time TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER GENERATED ALWAYS AS ((extract(epoch FROM (wake_time - bedtime)) / 60)::int) STORED,
  quality_rating SMALLINT CHECK (quality_rating BETWEEN 1 AND 5),
  awakenings SMALLINT CHECK (awakenings BETWEEN 0 AND 50),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, sleep_date),
  CONSTRAINT sleep_window_valid CHECK (wake_time > bedtime AND wake_time - bedtime <= interval '20 hours')
);

-- -------------------------------------------------------------------------
-- 17. progress_photos (files live in the private 'progress-photos' bucket)
-- -------------------------------------------------------------------------
CREATE TABLE public.progress_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_date DATE NOT NULL,
  view TEXT NOT NULL CHECK (view IN ('front','side','back')),
  storage_path TEXT NOT NULL UNIQUE,
  weight_kg NUMERIC(5,2) CHECK (weight_kg BETWEEN 20 AND 400),
  waist_cm NUMERIC(5,1) CHECK (waist_cm BETWEEN 30 AND 250),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Path must sit inside the owner's folder: <user_id>/...
  CONSTRAINT progress_photo_path_owner CHECK (split_part(storage_path, '/', 1) = user_id::text)
);
CREATE INDEX progress_photos_user_date_idx ON public.progress_photos (user_id, photo_date);

-- -------------------------------------------------------------------------
-- 18. achievements (awarded only from actual records; evidence stored)
-- -------------------------------------------------------------------------
CREATE TABLE public.achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  achieved_on DATE NOT NULL,
  evidence TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, code)
);

-- -------------------------------------------------------------------------
-- 19. reminders (in-app; shown on the dashboard when due and not yet logged)
-- -------------------------------------------------------------------------
CREATE TABLE public.reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('weight','food','water','workout','measurements','photo','sleep','steps','custom')),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  time_of_day TIME NOT NULL,
  days_of_week SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (days_of_week <@ ARRAY[1,2,3,4,5,6,7]::smallint[])
);

-- -------------------------------------------------------------------------
-- 20. daily_notes
-- -------------------------------------------------------------------------
CREATE TABLE public.daily_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  note_date DATE NOT NULL,
  energy SMALLINT CHECK (energy BETWEEN 1 AND 5),
  hunger SMALLINT CHECK (hunger BETWEEN 1 AND 5),
  mood SMALLINT CHECK (mood BETWEEN 1 AND 5),
  stress SMALLINT CHECK (stress BETWEEN 1 AND 5),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, note_date)
);

-- -------------------------------------------------------------------------
-- 8. daily_nutrition_summaries — a view (always consistent with food_entries)
-- -------------------------------------------------------------------------
CREATE VIEW public.daily_nutrition_summaries
WITH (security_invoker = true) AS
SELECT
  user_id,
  entry_date,
  count(*)::int AS entry_count,
  round(sum(kcal), 1) AS kcal,
  round(sum(protein_g), 1) AS protein_g,
  round(sum(carbs_g), 1) AS carbs_g,
  round(sum(fat_g), 1) AS fat_g,
  round(sum(fibre_g), 1) AS fibre_g,
  count(*) FILTER (WHERE fibre_g IS NULL)::int AS entries_missing_fibre,
  round(sum(grams), 1) AS total_food_g,
  round(coalesce(sum(grams) FILTER (WHERE tracking_tag = 'chicken'), 0), 1) AS chicken_g,
  round(coalesce(sum(grams) FILTER (WHERE tracking_tag = 'whole_egg'), 0), 1) AS whole_egg_g,
  round(coalesce(sum(CASE WHEN tracking_tag = 'whole_egg' AND quantity_unit = 'piece' THEN quantity
                          WHEN tracking_tag = 'whole_egg' AND unit_weight_g > 0 THEN grams / unit_weight_g END), 0), 1) AS whole_egg_count,
  round(coalesce(sum(grams) FILTER (WHERE tracking_tag = 'egg_white'), 0), 1) AS egg_white_g,
  round(coalesce(sum(grams) FILTER (WHERE tracking_tag = 'tofu'), 0), 1) AS tofu_g,
  round(coalesce(sum(grams) FILTER (WHERE tracking_tag = 'soya'), 0), 1) AS soya_g,
  round(coalesce(sum(grams) FILTER (WHERE tracking_tag = 'protein_powder'), 0), 1) AS protein_powder_g
FROM public.food_entries
GROUP BY user_id, entry_date;

-- -------------------------------------------------------------------------
-- updated_at triggers
-- -------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fitness_profiles','transformation_programs','daily_weight_logs','daily_body_measurements',
    'food_items','food_entries','meal_templates','nutrition_targets','exercise_library',
    'workout_plans','workout_plan_exercises','workout_sessions','workout_exercises','workout_sets',
    'cardio_logs','step_logs','sleep_logs','reminders','daily_notes'
  ] LOOP
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at()', t);
  END LOOP;
END $$;

-- -------------------------------------------------------------------------
-- Row Level Security: owner-only access on every table
-- -------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fitness_profiles','transformation_programs','daily_weight_logs','daily_body_measurements',
    'food_items','recipe_ingredients','food_entries','meal_templates','meal_template_items',
    'nutrition_targets','exercise_library','workout_plans','workout_plan_exercises',
    'workout_sessions','workout_exercises','workout_sets','cardio_logs','step_logs','water_logs',
    'sleep_logs','progress_photos','achievements','reminders','daily_notes'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY "Owner can read" ON public.%I FOR SELECT TO authenticated USING (user_id = auth.uid())', t);
    EXECUTE format('CREATE POLICY "Owner can delete" ON public.%I FOR DELETE TO authenticated USING (user_id = auth.uid())', t);
  END LOOP;

  -- Tables without a parent row to verify
  FOREACH t IN ARRAY ARRAY[
    'fitness_profiles','transformation_programs','daily_weight_logs','daily_body_measurements',
    'food_items','meal_templates','nutrition_targets','exercise_library','workout_plans',
    'cardio_logs','step_logs','water_logs','sleep_logs','progress_photos','achievements',
    'reminders','daily_notes'
  ] LOOP
    EXECUTE format('CREATE POLICY "Owner can insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid())', t);
    EXECUTE format('CREATE POLICY "Owner can update" ON public.%I FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())', t);
  END LOOP;
END $$;

REVOKE ALL ON public.daily_nutrition_summaries FROM anon;
GRANT SELECT ON public.daily_nutrition_summaries TO authenticated;

-- Child tables: the referenced parent rows must belong to the same user
CREATE POLICY "Owner can insert" ON public.food_entries FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND (food_item_id IS NULL OR EXISTS (
  SELECT 1 FROM public.food_items f WHERE f.id = food_item_id AND f.user_id = auth.uid())));
CREATE POLICY "Owner can update" ON public.food_entries FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid() AND (food_item_id IS NULL OR EXISTS (
  SELECT 1 FROM public.food_items f WHERE f.id = food_item_id AND f.user_id = auth.uid())));

CREATE POLICY "Owner can insert" ON public.recipe_ingredients FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.food_items f WHERE f.id = recipe_id AND f.user_id = auth.uid() AND f.is_recipe)
  AND EXISTS (SELECT 1 FROM public.food_items f WHERE f.id = ingredient_id AND f.user_id = auth.uid()));
CREATE POLICY "Owner can update" ON public.recipe_ingredients FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.food_items f WHERE f.id = recipe_id AND f.user_id = auth.uid() AND f.is_recipe)
  AND EXISTS (SELECT 1 FROM public.food_items f WHERE f.id = ingredient_id AND f.user_id = auth.uid()));

CREATE POLICY "Owner can insert" ON public.meal_template_items FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.meal_templates m WHERE m.id = template_id AND m.user_id = auth.uid())
  AND EXISTS (SELECT 1 FROM public.food_items f WHERE f.id = food_item_id AND f.user_id = auth.uid()));
CREATE POLICY "Owner can update" ON public.meal_template_items FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.meal_templates m WHERE m.id = template_id AND m.user_id = auth.uid())
  AND EXISTS (SELECT 1 FROM public.food_items f WHERE f.id = food_item_id AND f.user_id = auth.uid()));

CREATE POLICY "Owner can insert" ON public.workout_plan_exercises FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.workout_plans p WHERE p.id = plan_id AND p.user_id = auth.uid())
  AND EXISTS (SELECT 1 FROM public.exercise_library e WHERE e.id = exercise_id AND e.user_id = auth.uid()));
CREATE POLICY "Owner can update" ON public.workout_plan_exercises FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.workout_plans p WHERE p.id = plan_id AND p.user_id = auth.uid())
  AND EXISTS (SELECT 1 FROM public.exercise_library e WHERE e.id = exercise_id AND e.user_id = auth.uid()));

CREATE POLICY "Owner can insert" ON public.workout_sessions FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND (plan_id IS NULL OR EXISTS (
  SELECT 1 FROM public.workout_plans p WHERE p.id = plan_id AND p.user_id = auth.uid())));
CREATE POLICY "Owner can update" ON public.workout_sessions FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid() AND (plan_id IS NULL OR EXISTS (
  SELECT 1 FROM public.workout_plans p WHERE p.id = plan_id AND p.user_id = auth.uid())));

CREATE POLICY "Owner can insert" ON public.workout_exercises FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.workout_sessions s WHERE s.id = session_id AND s.user_id = auth.uid())
  AND (exercise_id IS NULL OR EXISTS (SELECT 1 FROM public.exercise_library e WHERE e.id = exercise_id AND e.user_id = auth.uid())));
CREATE POLICY "Owner can update" ON public.workout_exercises FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.workout_sessions s WHERE s.id = session_id AND s.user_id = auth.uid())
  AND (exercise_id IS NULL OR EXISTS (SELECT 1 FROM public.exercise_library e WHERE e.id = exercise_id AND e.user_id = auth.uid())));

CREATE POLICY "Owner can insert" ON public.workout_sets FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND EXISTS (
  SELECT 1 FROM public.workout_exercises w WHERE w.id = workout_exercise_id AND w.user_id = auth.uid()));
CREATE POLICY "Owner can update" ON public.workout_sets FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid() AND EXISTS (
  SELECT 1 FROM public.workout_exercises w WHERE w.id = workout_exercise_id AND w.user_id = auth.uid()));

-- -------------------------------------------------------------------------
-- Recipe nutrition: per 100 g of the finished (cooked) recipe
--   per100 = Σ(ingredient grams / 100 × ingredient per-100 g value) / total cooked g × 100
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pp_recompute_recipe(_recipe_id UUID)
RETURNS public.food_items
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  r public.food_items%ROWTYPE;
  tot_g NUMERIC; k NUMERIC; p NUMERIC; c NUMERIC; f NUMERIC; fi NUMERIC; missing_fibre INT;
BEGIN
  SELECT * INTO r FROM public.food_items WHERE id = _recipe_id AND is_recipe;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recipe not found'; END IF;
  SELECT coalesce(sum(ri.grams),0),
         coalesce(sum(ri.grams/100.0*i.kcal_per_100g),0),
         coalesce(sum(ri.grams/100.0*i.protein_per_100g),0),
         coalesce(sum(ri.grams/100.0*i.carbs_per_100g),0),
         coalesce(sum(ri.grams/100.0*i.fat_per_100g),0),
         coalesce(sum(ri.grams/100.0*i.fibre_per_100g),0),
         count(*) FILTER (WHERE i.fibre_per_100g IS NULL)
    INTO tot_g, k, p, c, f, fi, missing_fibre
  FROM public.recipe_ingredients ri JOIN public.food_items i ON i.id = ri.ingredient_id
  WHERE ri.recipe_id = _recipe_id;
  IF tot_g = 0 THEN RAISE EXCEPTION 'Recipe has no ingredients'; END IF;
  -- If the cooked weight is unknown, fall back to the summed ingredient weight
  tot_g := coalesce(r.recipe_total_cooked_g, tot_g);
  UPDATE public.food_items SET
    kcal_per_100g = round(k / tot_g * 100, 1),
    protein_per_100g = round(p / tot_g * 100, 2),
    carbs_per_100g = round(c / tot_g * 100, 2),
    fat_per_100g = round(f / tot_g * 100, 2),
    fibre_per_100g = CASE WHEN missing_fibre > 0 THEN NULL ELSE round(fi / tot_g * 100, 2) END,
    recipe_total_cooked_g = tot_g,
    default_serving_g = CASE WHEN r.recipe_servings IS NOT NULL THEN round(tot_g / r.recipe_servings, 1) ELSE r.default_serving_g END,
    includes_cooking_oil = EXISTS (SELECT 1 FROM public.recipe_ingredients ri JOIN public.food_items i ON i.id = ri.ingredient_id
                                   WHERE ri.recipe_id = _recipe_id AND i.tracking_tag = 'cooking_oil'),
    source = 'Calculated from recipe ingredients'
  WHERE id = _recipe_id
  RETURNING * INTO r;
  RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.pp_recompute_recipe(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pp_recompute_recipe(UUID) TO authenticated;

-- -------------------------------------------------------------------------
-- Private storage bucket for progress photos
-- -------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('progress-photos', 'progress-photos', false, 10485760, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Progress photos: owner read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'progress-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Progress photos: owner insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'progress-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Progress photos: owner update" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'progress-photos' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'progress-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Progress photos: owner delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'progress-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
