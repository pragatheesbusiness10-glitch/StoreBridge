-- Prime Physique database tests: triggers, calculations, seeding and RLS isolation.
-- Run with tests/db/run-db-tests.sh (applies all migrations to a throwaway database first).
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.assert(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'ASSERTION FAILED: %', msg; END IF;
  RAISE NOTICE 'ok - %', msg;
END $$;
-- expect an error when running sql
CREATE OR REPLACE FUNCTION pg_temp.assert_fails(sql text, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ok - % (rejected: %)', msg, SQLERRM;
    RETURN;
  END;
  RAISE EXCEPTION 'ASSERTION FAILED (statement succeeded): %', msg;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon;

INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@example.com');

SET client_min_messages = notice;

-- ===================================================================== user A
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';

INSERT INTO fitness_profiles (display_name, height_cm, age, diet_preference, eggs_allowed, dairy_allowed, soya_allowed, onboarded_at)
VALUES ('A', 178, 25, 'vegetarian', true, false, true, now());
INSERT INTO transformation_programs (name, start_date, start_weight_kg, target_weight_kg, duration_weeks)
VALUES ('Prime Physique', '2026-11-03', 93.25, 78, 13);

SELECT pg_temp.assert((SELECT user_id FROM fitness_profiles) = 'aaaaaaaa-0000-0000-0000-000000000001', 'user_id defaults to auth.uid()');

DO $$ DECLARE r jsonb; BEGIN
  r := pp_seed_defaults();
  PERFORM pg_temp.assert((r->>'foods')::int >= 60, 'seeded food database: ' || r::text);
  PERFORM pg_temp.assert((r->>'exercises')::int >= 40, 'seeded exercise library');
  PERFORM pg_temp.assert((r->>'plans')::int = 7, 'seeded 7-day plan (6 training + rest)');
  r := pp_seed_defaults();
  PERFORM pg_temp.assert((r->>'foods')::int = 0 AND (r->>'plans')::int = 0, 'seeding is idempotent');
END $$;

SELECT pg_temp.assert((SELECT count(*) FROM workout_plans WHERE is_rest_day) = 1, 'Sunday is the only rest day');
SELECT pg_temp.assert((SELECT count(*) FROM workout_plan_exercises) >= 35, 'plan exercises seeded');
SELECT pg_temp.assert((SELECT count(*) FROM workout_plan_exercises WHERE suggested_weight_kg IS NOT NULL) = 0, 'no assumed starting weights');
SELECT pg_temp.assert((SELECT kcal_min FROM nutrition_targets) = 2200 AND (SELECT effective_from FROM nutrition_targets) = '2026-11-03', 'default targets effective from programme start');

SELECT pg_temp.assert((SELECT count(*) FROM meal_template_items) = 17, 'default meal templates fully resolved (17 items)');
SELECT pg_temp.assert((SELECT count(*) FROM meal_template_items i JOIN food_items f ON f.id = i.food_item_id WHERE f.contains_meat OR f.contains_dairy) = 0, 'default meal plan excludes chicken and dairy');

-- Raw vs cooked chicken are distinct foods with distinct values
SELECT pg_temp.assert((SELECT count(*) FROM food_items WHERE name = 'Chicken breast, skinless') = 2, 'raw and cooked chicken breast stored separately');

-- ---------------------------------------------------------- nutrition maths
INSERT INTO food_entries (entry_date, meal_type, food_item_id, food_name, food_state, quantity, quantity_unit, grams, kcal, protein_g, carbs_g, fat_g)
SELECT '2026-11-03', 'lunch', id, 'client says anything', 'cooked', 250, 'g', 250, 0, 0, 0, 0
FROM food_items WHERE name = 'Chicken breast, skinless' AND state = 'raw';
SELECT pg_temp.assert((SELECT kcal FROM food_entries WHERE food_state = 'raw' AND tracking_tag = 'chicken') = 300.0, 'raw chicken 250 g = 300 kcal (250/100×120)');
SELECT pg_temp.assert((SELECT protein_g FROM food_entries WHERE tracking_tag = 'chicken') = 56.25, 'raw chicken 250 g = 56.25 g protein');
SELECT pg_temp.assert((SELECT food_state FROM food_entries WHERE tracking_tag = 'chicken') = 'raw', 'trigger overwrites client-supplied state with the food''s state');

INSERT INTO food_entries (entry_date, meal_type, food_item_id, food_name, food_state, quantity, quantity_unit, grams, kcal, protein_g, carbs_g, fat_g)
SELECT '2026-11-03', 'lunch', id, 'x', 'dry', 50, 'g', 50, 0, 0, 0, 0 FROM food_items WHERE name = 'Soya chunks' AND state = 'dry';
SELECT pg_temp.assert((SELECT kcal FROM food_entries WHERE tracking_tag = 'soya') = 172.5, 'dry soya 50 g = 172.5 kcal');
SELECT pg_temp.assert((SELECT protein_g FROM food_entries WHERE tracking_tag = 'soya') = 26.00, 'dry soya 50 g = 26 g protein');

INSERT INTO food_entries (entry_date, meal_type, food_item_id, food_name, food_state, quantity, quantity_unit, grams, kcal, protein_g, carbs_g, fat_g)
SELECT '2026-11-03', 'breakfast', id, 'x', 'raw', 3, 'piece', 150, 0, 0, 0, 0 FROM food_items WHERE name = 'Whole egg' AND state = 'raw';
INSERT INTO food_entries (entry_date, meal_type, food_item_id, food_name, food_state, quantity, quantity_unit, grams, kcal, protein_g, carbs_g, fat_g)
SELECT '2026-11-03', 'lunch', id, 'x', 'cooked', 200, 'g', 200, 0, 0, 0, 0 FROM food_items WHERE name = 'White rice, cooked';
SELECT pg_temp.assert((SELECT kcal FROM food_entries WHERE food_name = 'White rice, cooked') = 260.0, 'cooked rice 200 g = 260 kcal');

-- Manual entry (restaurant label) without a food item
INSERT INTO food_entries (entry_date, meal_type, food_name, food_state, quantity, quantity_unit, grams, kcal, protein_g, carbs_g, fat_g, nutrition_source)
VALUES ('2026-11-03', 'dinner', 'Restaurant paneer-free thali', 'cooked', 1, 'serving', 450, 640, 18, 90, 22, 'manual');
SELECT pg_temp.assert((SELECT kcal FROM food_entries WHERE nutrition_source = 'manual') = 640, 'manual nutrition kept as entered');
SELECT pg_temp.assert_fails($q$INSERT INTO food_entries (entry_date, meal_type, food_name, food_state, quantity, quantity_unit, grams, kcal, protein_g, carbs_g, fat_g)
  VALUES ('2026-11-03','dinner','no item','raw',1,'g',100,1,1,1,1)$q$, 'database-sourced entry requires a food item');
SELECT pg_temp.assert_fails($q$INSERT INTO food_entries (entry_date, meal_type, food_name, food_state, quantity, quantity_unit, grams, kcal, protein_g, carbs_g, fat_g, nutrition_source)
  VALUES ('2026-11-03','dinner','neg','raw',1,'g',-5,1,1,1,1,'manual')$q$, 'negative grams rejected');

-- Updating grams recalculates from the food database
UPDATE food_entries SET grams = 100, quantity = 100 WHERE food_name = 'White rice, cooked';
SELECT pg_temp.assert((SELECT kcal FROM food_entries WHERE food_name = 'White rice, cooked') = 130.0, 'editing grams recalculates nutrients');

-- Correcting the food database does not silently rewrite history ...
UPDATE food_items SET kcal_per_100g = 125 WHERE name = 'Chicken breast, skinless' AND state = 'raw';
SELECT pg_temp.assert((SELECT kcal FROM food_entries WHERE tracking_tag = 'chicken') = 300.0, 'food correction keeps past snapshot');
-- ... until the user explicitly re-applies it
SELECT pg_temp.assert(pp_recalculate_food_entries((SELECT id FROM food_items WHERE name = 'Chicken breast, skinless' AND state = 'raw')) = 1, 'recalculate updates 1 entry');
SELECT pg_temp.assert((SELECT kcal FROM food_entries WHERE tracking_tag = 'chicken') = 312.5, 'recalculated chicken = 312.5 kcal');

-- Daily summary view
SELECT pg_temp.assert((SELECT chicken_g FROM daily_nutrition_summaries WHERE entry_date = '2026-11-03') = 250, 'summary: chicken grams');
SELECT pg_temp.assert((SELECT soya_g FROM daily_nutrition_summaries WHERE entry_date = '2026-11-03') = 50, 'summary: soya grams');
SELECT pg_temp.assert((SELECT whole_egg_count FROM daily_nutrition_summaries WHERE entry_date = '2026-11-03') = 3, 'summary: 3 whole eggs');
SELECT pg_temp.assert((SELECT kcal FROM daily_nutrition_summaries WHERE entry_date = '2026-11-03') = (SELECT round(sum(kcal),1) FROM food_entries), 'summary: kcal equals sum of entries');
SELECT pg_temp.assert((SELECT entries_missing_fibre FROM daily_nutrition_summaries WHERE entry_date = '2026-11-03') = 1, 'summary flags entries with unknown fibre');

-- ---------------------------------------------------------- recipes
INSERT INTO food_items (name, category, state, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, is_recipe, recipe_total_cooked_g, recipe_servings)
VALUES ('Tofu stir fry', 'recipe', 'cooked', 0, 0, 0, 0, true, 500, 2);
INSERT INTO recipe_ingredients (recipe_id, ingredient_id, grams)
SELECT (SELECT id FROM food_items WHERE name = 'Tofu stir fry'), id, g FROM (VALUES ('Tofu, firm', 300), ('Broccoli', 200), ('Olive oil', 10)) v(n, g)
JOIN food_items ON name = v.n;
DO $$ DECLARE r food_items; BEGIN
  r := pp_recompute_recipe((SELECT id FROM food_items WHERE name = 'Tofu stir fry'));
  -- total kcal = 3×144 + 2×34 + 0.1×884 = 432 + 68 + 88.4 = 588.4 → per 100 g of 500 g = 117.7
  PERFORM pg_temp.assert(r.kcal_per_100g = 117.7, 'recipe kcal/100 g = 117.7, got ' || r.kcal_per_100g);
  PERFORM pg_temp.assert(r.default_serving_g = 250, 'recipe serving = 250 g');
  PERFORM pg_temp.assert(r.includes_cooking_oil, 'recipe marked as including cooking oil');
END $$;

-- ---------------------------------------------------------- workouts
INSERT INTO workout_sessions (id, session_date, name, status) VALUES ('11111111-1111-1111-1111-111111111111', '2026-11-03', 'Push A', 'completed');
INSERT INTO workout_exercises (id, session_id, exercise_name) VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Bench press');
INSERT INTO workout_sets (workout_exercise_id, set_number, weight_kg, reps) VALUES
  ('22222222-2222-2222-2222-222222222222', 1, 20, 12),
  ('22222222-2222-2222-2222-222222222222', 2, 25, 10),
  ('22222222-2222-2222-2222-222222222222', 3, 30, 8);
SELECT pg_temp.assert((SELECT sum(weight_kg * reps) FROM workout_sets) = 730, 'bench volume 20×12 + 25×10 + 30×8 = 730 kg');
SELECT pg_temp.assert_fails($q$INSERT INTO workout_sets (workout_exercise_id, set_number) VALUES ('22222222-2222-2222-2222-222222222222', 4)$q$, 'set without reps or duration rejected');

-- ---------------------------------------------------------- weight, sleep, measurements
INSERT INTO daily_weight_logs (log_date, morning_weight_kg, after_toilet, before_food_water) VALUES ('2026-11-03', 93.25, true, true);
SELECT pg_temp.assert_fails($q$INSERT INTO daily_weight_logs (log_date, morning_weight_kg) VALUES ('2026-11-03', 93.0)$q$, 'one morning weight per day');
SELECT pg_temp.assert_fails($q$INSERT INTO daily_weight_logs (log_date, morning_weight_kg) VALUES ('2026-11-04', -1)$q$, 'invalid weight rejected');
INSERT INTO sleep_logs (sleep_date, bedtime, wake_time, quality_rating) VALUES ('2026-11-04', '2026-11-03 23:15+05:30', '2026-11-04 06:45+05:30', 4);
SELECT pg_temp.assert((SELECT duration_minutes FROM sleep_logs) = 450, 'sleep duration 7h30 = 450 min');
SELECT pg_temp.assert_fails($q$INSERT INTO sleep_logs (sleep_date, bedtime, wake_time) VALUES ('2026-11-05', '2026-11-05 07:00+00', '2026-11-05 06:00+00')$q$, 'wake before bed rejected');
SELECT pg_temp.assert_fails($q$INSERT INTO daily_body_measurements (measured_on) VALUES ('2026-11-03')$q$, 'empty measurement rejected (no invented values)');
SELECT pg_temp.assert_fails($q$INSERT INTO daily_body_measurements (measured_on, body_fat_pct) VALUES ('2026-11-03', 25)$q$, 'body fat requires a method');
INSERT INTO daily_body_measurements (measured_on, waist_cm) VALUES ('2026-11-03', 98.5);

-- ---------------------------------------------------------- storage
INSERT INTO storage.objects (bucket_id, name) VALUES ('progress-photos', 'aaaaaaaa-0000-0000-0000-000000000001/2026-11-03/front.jpg');
SELECT pg_temp.assert_fails($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('progress-photos', 'bbbbbbbb-0000-0000-0000-000000000002/x.jpg')$q$, 'cannot upload into another user''s folder');
INSERT INTO progress_photos (photo_date, view, storage_path) VALUES ('2026-11-03', 'front', 'aaaaaaaa-0000-0000-0000-000000000001/2026-11-03/front.jpg');
SELECT pg_temp.assert_fails($q$INSERT INTO progress_photos (photo_date, view, storage_path) VALUES ('2026-11-03', 'side', 'bbbbbbbb-0000-0000-0000-000000000002/x.jpg')$q$, 'photo record must point into own folder');

-- ===================================================================== user B
SET request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
SELECT pg_temp.assert((SELECT count(*) FROM food_items) = 0, 'B sees none of A''s foods');
SELECT pg_temp.assert((SELECT count(*) FROM food_entries) = 0, 'B sees none of A''s food entries');
SELECT pg_temp.assert((SELECT count(*) FROM daily_nutrition_summaries) = 0, 'B sees none of A''s summaries (security_invoker view)');
SELECT pg_temp.assert((SELECT count(*) FROM workout_sets) = 0, 'B sees none of A''s sets');
SELECT pg_temp.assert((SELECT count(*) FROM fitness_profiles) = 0, 'B sees none of A''s profile');
SELECT pg_temp.assert((SELECT count(*) FROM storage.objects WHERE bucket_id = 'progress-photos') = 0, 'B cannot list A''s photos');
SELECT pg_temp.assert((SELECT count(*) FROM progress_photos) = 0, 'B cannot read A''s photo records');

DO $$ DECLARE n int; BEGIN
  UPDATE daily_weight_logs SET morning_weight_kg = 50; GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.assert(n = 0, 'B cannot update A''s weight logs');
  DELETE FROM workout_sessions; GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.assert(n = 0, 'B cannot delete A''s sessions');
  DELETE FROM storage.objects WHERE bucket_id = 'progress-photos'; GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.assert(n = 0, 'B cannot delete A''s photo files');
END $$;

SELECT pg_temp.assert_fails($q$INSERT INTO workout_sets (workout_exercise_id, set_number, weight_kg, reps) VALUES ('22222222-2222-2222-2222-222222222222', 9, 100, 1)$q$, 'B cannot add a set to A''s exercise');
SELECT pg_temp.assert_fails($q$INSERT INTO workout_exercises (session_id, exercise_name) VALUES ('11111111-1111-1111-1111-111111111111', 'x')$q$, 'B cannot add an exercise to A''s session');
SELECT pg_temp.assert_fails($q$INSERT INTO daily_weight_logs (user_id, log_date, morning_weight_kg) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '2026-12-01', 80)$q$, 'B cannot write rows owned by A');
DO $$ DECLARE fid uuid; BEGIN
  SET LOCAL ROLE postgres;
  SELECT id INTO fid FROM food_items WHERE name = 'Tofu, firm' LIMIT 1;
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO food_entries (entry_date, meal_type, food_item_id, food_name, food_state, quantity, quantity_unit, grams, kcal, protein_g, carbs_g, fat_g)
    VALUES ('2026-11-03', 'lunch', fid, 'x', 'raw', 1, 'g', 100, 0, 0, 0, 0);
    RAISE EXCEPTION 'ASSERTION FAILED: B logged food using A''s food item';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'ASSERTION FAILED%' THEN RAISE; END IF;
    RAISE NOTICE 'ok - B cannot reference A''s food item (rejected: %)', SQLERRM;
  END;
END $$;
SELECT pg_temp.assert_fails($q$SELECT pp_recompute_recipe((SELECT '00000000-0000-0000-0000-000000000000'::uuid))$q$, 'recipe RPC cannot see other users'' recipes');

-- B gets their own seed copy, independent of A
DO $$ DECLARE r jsonb; BEGIN
  r := pp_seed_defaults();
  PERFORM pg_temp.assert((r->>'foods')::int >= 60, 'B receives an independent food database');
END $$;

-- ===================================================================== anon
RESET request.jwt.claim.sub;
SET ROLE anon;
SELECT pg_temp.assert_fails('SELECT count(*) FROM food_items', 'anon has no table access');
SELECT pg_temp.assert_fails('SELECT pp_seed_defaults()', 'anon cannot seed');

RESET ROLE;
\echo ALL PRIME PHYSIQUE DB TESTS PASSED
