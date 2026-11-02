-- Builds a realistic 4-week Prime Physique dataset for the test user, written AS that user
-- (role authenticated + jwt sub) so every row passes through the real triggers and RLS.
\set ON_ERROR_STOP 1
INSERT INTO auth.users (id, email) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'athlete@example.com') ON CONFLICT DO NOTHING;
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';

INSERT INTO fitness_profiles (display_name, height_cm, age, diet_preference, eggs_allowed, dairy_allowed, soya_allowed,
  training_days_per_week, training_equipment, physique_goal, onboarded_at)
VALUES ('Alex', 178, 25, 'vegetarian', true, false, true, 6, 'Full gym and home equipment', 'Athletic, muscular and lean', now());
INSERT INTO transformation_programs (name, start_date, start_weight_kg, target_weight_kg, duration_weeks)
VALUES ('Prime Physique', '2026-11-03', 93.25, 78, 13);
SELECT pp_seed_defaults();

-- Daily weights with realistic noise around a gentle downward trend (one skipped day per week)
INSERT INTO daily_weight_logs (log_date, morning_weight_kg, measured_at, after_toilet, before_food_water, notes)
SELECT d::date,
       round((93.3 - 0.13 * (d::date - '2026-11-03'::date) + 0.45 * sin((d::date - '2026-11-03'::date) * 1.7))::numeric, 2),
       '07:10', true, true,
       CASE WHEN extract(dow FROM d) = 1 THEN 'Salty dinner yesterday' END
FROM generate_series('2026-11-03'::date, '2026-12-01'::date, '1 day') d
WHERE extract(dow FROM d) <> 3 OR d::date = '2026-11-05';

-- Food: apply the default templates each day + extra items
INSERT INTO food_entries (entry_date, meal_type, meal_time, food_item_id, food_name, food_state, quantity, quantity_unit, grams, kcal, protein_g, carbs_g, fat_g)
SELECT d::date, t.meal_type, CASE t.meal_type WHEN 'breakfast' THEN '08:00'::time WHEN 'lunch' THEN '13:15' WHEN 'post_workout' THEN '18:45' ELSE '20:30' END,
       i.food_item_id, 'x', 'raw', i.quantity, i.quantity_unit, i.grams, 0, 0, 0, 0
FROM generate_series('2026-11-03'::date, '2026-12-01'::date, '1 day') d
CROSS JOIN meal_templates t JOIN meal_template_items i ON i.template_id = t.id
WHERE NOT (t.meal_type = 'post_workout' AND extract(dow FROM d) IN (0, 4));
INSERT INTO food_entries (entry_date, meal_type, meal_time, food_item_id, food_name, food_state, quantity, quantity_unit, grams, kcal, protein_g, carbs_g, fat_g)
SELECT d::date, 'mid_morning', '11:00', f.id, 'x', 'raw', 25, 'g', 25, 0, 0, 0, 0
FROM generate_series('2026-11-03'::date, '2026-12-01'::date, '1 day') d JOIN food_items f ON f.name = 'Almonds';
INSERT INTO food_entries (entry_date, meal_type, meal_time, food_item_id, food_name, food_state, quantity, quantity_unit, grams, kcal, protein_g, carbs_g, fat_g)
SELECT d::date, 'lunch', '13:15', f.id, 'x', 'raw', 120, 'g', 120, 0, 0, 0, 0
FROM generate_series('2026-11-03'::date, '2026-12-01'::date, '2 day') d JOIN food_items f ON f.name = 'Chickpeas, boiled';
INSERT INTO food_entries (entry_date, meal_type, food_name, food_state, quantity, quantity_unit, grams, kcal, protein_g, carbs_g, fat_g, nutrition_source, source_note)
VALUES ('2026-11-29', 'dinner', 'Restaurant veg biryani', 'cooked', 1, 'serving', 400, 720, 16, 105, 24, 'manual', 'Restaurant menu');

-- Water (3–5 glasses), sleep, steps
INSERT INTO water_logs (log_date, amount_ml, logged_at)
SELECT d::date, CASE WHEN g % 2 = 0 THEN 500 ELSE 750 END, d + make_interval(hours => 8 + g * 3)
FROM generate_series('2026-11-03'::date, '2026-12-01'::date, '1 day') d, generate_series(0, 3 + (extract(day FROM d)::int % 2)) g;
INSERT INTO sleep_logs (sleep_date, bedtime, wake_time, quality_rating, awakenings)
SELECT d::date, (d::date - 1) + time '23:05' + make_interval(mins => (extract(day FROM d)::int * 7) % 50),
       d::date + time '06:50', 2 + (extract(day FROM d)::int % 4), extract(day FROM d)::int % 3
FROM generate_series('2026-11-03'::date, '2026-12-01'::date, '1 day') d;
INSERT INTO step_logs (log_date, steps, source)
SELECT d::date, 7000 + (extract(day FROM d)::int * 397) % 5000, 'phone'
FROM generate_series('2026-11-03'::date, '2026-12-01'::date, '1 day') d;

-- Cardio on Thursdays + Saturday walks
INSERT INTO cardio_logs (log_date, activity_type, duration_minutes, distance_km, avg_heart_rate)
SELECT d::date, CASE WHEN extract(dow FROM d) = 4 THEN 'cycling' ELSE 'walking' END,
       CASE WHEN extract(dow FROM d) = 4 THEN 40 ELSE 35 END,
       CASE WHEN extract(dow FROM d) = 4 THEN 14.5 + (d::date - '2026-11-03'::date) * 0.1 ELSE 3.2 END, 128
FROM generate_series('2026-11-03'::date, '2026-12-01'::date, '1 day') d WHERE extract(dow FROM d) IN (4, 6);

-- Workouts: each planned training day, all exercises, 3 working sets with gradual progression
DO $$
DECLARE d date; p record; pe record; s uuid; we uuid; wk int; base numeric; n int;
BEGIN
  FOR d IN SELECT generate_series('2026-11-03'::date, '2026-11-30'::date, '1 day')::date LOOP
    SELECT * INTO p FROM workout_plans WHERE day_of_week = extract(isodow FROM d) AND NOT is_rest_day;
    CONTINUE WHEN NOT FOUND;
    wk := (d - '2026-11-03'::date) / 7;
    INSERT INTO workout_sessions (session_date, plan_id, name, status, started_at, ended_at, duration_minutes, overall_rpe)
    VALUES (d, p.id, p.name, 'completed', d + time '18:00', d + time '19:05', 65, 7) RETURNING id INTO s;
    FOR pe IN SELECT wpe.*, el.name, el.muscle_group, el.category, el.equipment, el.measurement_type
              FROM workout_plan_exercises wpe JOIN exercise_library el ON el.id = wpe.exercise_id
              WHERE wpe.plan_id = p.id ORDER BY sort_order LOOP
      INSERT INTO workout_exercises (session_id, exercise_id, plan_exercise_id, exercise_name, muscle_group, category, equipment, measurement_type, sort_order, rest_seconds, difficulty_rating, form_quality)
      VALUES (s, pe.exercise_id, pe.id, pe.name, pe.muscle_group, pe.category, pe.equipment, pe.measurement_type, pe.sort_order, pe.rest_seconds, 7, 'good')
      RETURNING id INTO we;
      base := CASE WHEN pe.category = 'compound' THEN 20 + length(pe.name) ELSE 7.5 + length(pe.name) / 3 END;
      FOR n IN 1..pe.target_sets LOOP
        IF pe.measurement_type = 'time' THEN
          INSERT INTO workout_sets (workout_exercise_id, set_number, duration_seconds) VALUES (we, n, coalesce(pe.target_duration_seconds, 30) + wk * 5);
        ELSIF pe.measurement_type IN ('bodyweight_reps') THEN
          INSERT INTO workout_sets (workout_exercise_id, set_number, reps) VALUES (we, n, coalesce(pe.target_reps_min, 8) + wk);
        ELSE
          INSERT INTO workout_sets (workout_exercise_id, set_number, weight_kg, reps)
          VALUES (we, n, base + wk * 2.5, greatest(coalesce(pe.target_reps_max, 10) - n + 1 - (wk % 2), 1));
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;
-- Today's session is in progress with one set so far
INSERT INTO workout_sessions (id, session_date, plan_id, name, status, started_at)
SELECT 'cccccccc-0000-0000-0000-000000000001', '2026-12-01', id, name, 'in_progress', '2026-12-01 18:00' FROM workout_plans WHERE day_of_week = 2;
INSERT INTO workout_exercises (session_id, exercise_id, exercise_name, muscle_group, measurement_type, sort_order)
SELECT 'cccccccc-0000-0000-0000-000000000001', id, name, muscle_group, measurement_type, 1 FROM exercise_library WHERE name = 'Lat pulldown';
INSERT INTO workout_sets (workout_exercise_id, set_number, weight_kg, reps)
SELECT id, 1, 45, 10 FROM workout_exercises WHERE session_id = 'cccccccc-0000-0000-0000-000000000001';

-- Weekly standardized measurements (no body fat on most weeks — never invented)
INSERT INTO daily_body_measurements (measured_on, waist_cm, chest_cm, neck_cm, left_arm_cm, right_arm_cm, hips_cm, standardized)
SELECT d::date, 101.5 - 0.6 * ((d::date - '2026-11-03'::date) / 7), 108, 41, 36.5, 36.8, 106 - 0.3 * ((d::date - '2026-11-03'::date) / 7), true
FROM generate_series('2026-11-03'::date, '2026-12-01'::date, '7 day') d;
UPDATE daily_body_measurements SET body_fat_pct = 27.5, body_fat_method = 'bia_scale' WHERE measured_on = '2026-11-03';
UPDATE daily_body_measurements SET body_fat_pct = 26.4, body_fat_method = 'bia_scale' WHERE measured_on = '2026-12-01';

INSERT INTO progress_photos (photo_date, view, storage_path, weight_kg, waist_cm)
VALUES ('2026-11-03', 'front', 'aaaaaaaa-0000-0000-0000-000000000001/2026-11-03/front-1.jpg', 93.3, 101.5),
       ('2026-12-01', 'front', 'aaaaaaaa-0000-0000-0000-000000000001/2026-12-01/front-1.jpg', 89.6, 99.1);
INSERT INTO reminders (reminder_type, title, time_of_day) VALUES ('sleep', 'Log last night''s sleep', '08:00');
INSERT INTO daily_notes (note_date, energy, hunger, mood, note) VALUES ('2026-12-01', 4, 3, 4, 'Felt strong in the gym');
RESET ROLE;
