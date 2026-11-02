-- =========================================================================
-- PRIME PHYSIQUE — default data seeding for a new user
--
-- pp_seed_defaults() copies the default food database, exercise library and
-- six-day training plan into the CALLING user's own rows (so every value is
-- editable and correctable by that user). It runs as SECURITY INVOKER, so
-- all inserts go through RLS with user_id = auth.uid().
-- Each section is skipped if the user already has data in it (idempotent).
--
-- Food values are approximate generic reference values per 100 g
-- (USDA FoodData Central style). They are labelled as such in `source`
-- and should be checked against the user's own product labels.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.pp_seed_defaults()
RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  uid UUID := auth.uid();
  src CONSTANT TEXT := 'Approximate generic reference (USDA FoodData Central style). Verify against your label.';
  foods_added INT := 0; exercises_added INT := 0; plans_added INT := 0;
  p UUID;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- ---------------------------------------------------------------- foods
  IF NOT EXISTS (SELECT 1 FROM food_items WHERE user_id = uid AND NOT is_custom) THEN
    INSERT INTO food_items (user_id, name, category, state, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, fibre_per_100g,
                            unit_label, unit_weight_g, default_serving_g, tracking_tag, contains_meat, contains_fish, contains_egg, contains_soy,
                            source, is_custom, notes)
    SELECT uid, v.name, v.category, v.state, v.kcal, v.p, v.c, v.f, v.fi, v.unit_label, v.unit_g, v.serving, v.tag,
           v.meat, v.fish, v.egg, v.soy, coalesce(v.src_override, src), false, v.notes
    FROM (VALUES
      -- name, category, state, kcal, P, C, F, fibre, unit_label, unit_g, serving_g, tag, meat, fish, egg, soy, src_override, notes
      ('Whole egg','protein','raw',143,12.6,0.7,9.5,0,'egg',50,100,'whole_egg',false,false,true,false,NULL::text,'Edible portion without shell; one large egg ≈ 50 g.'),
      ('Whole egg, boiled','protein','cooked',155,12.6,1.1,10.6,0,'egg',50,100,'whole_egg',false,false,true,false,NULL,'Hard-boiled, without shell.'),
      ('Egg whites','protein','raw',52,10.9,0.7,0.2,0,'egg white',33,150,'egg_white',false,false,true,false,NULL,NULL),
      ('Chicken breast, skinless','protein','raw',120,22.5,0,2.6,0,NULL,NULL,250,'chicken',true,false,false,false,NULL,'Raw weight. Do not use for cooked portions.'),
      ('Chicken breast, skinless','protein','cooked',165,31.0,0,3.6,0,NULL,NULL,200,'chicken',true,false,false,false,NULL,'Roasted/grilled, no added oil. Cooked weight.'),
      ('Chicken thigh, skinless','protein','raw',121,19.9,0,4.1,0,NULL,NULL,200,'chicken',true,false,false,false,NULL,'Raw weight, meat only.'),
      ('Chicken thigh, skinless','protein','cooked',179,24.8,0,8.2,0,NULL,NULL,150,'chicken',true,false,false,false,NULL,'Roasted, meat only. Cooked weight.'),
      ('White fish (cod)','protein','raw',82,17.8,0,0.7,0,NULL,NULL,200,NULL,false,true,false,false,NULL,NULL),
      ('White fish (cod)','protein','cooked',105,22.8,0,0.9,0,NULL,NULL,150,NULL,false,true,false,false,NULL,'Baked, no added oil.'),
      ('Tofu, firm','protein','as_packaged',144,17.3,2.8,8.7,2.3,NULL,NULL,150,'tofu',false,false,false,true,NULL,'Firm tofu as sold (calcium-set). Values vary widely by brand.'),
      ('Soya chunks','protein','dry',345,52.0,33.0,0.5,13.0,NULL,NULL,50,'soya',false,false,false,true,'Typical packaged soya chunk label values. Verify against your label.','DRY weight. Weigh before soaking.'),
      ('Soya chunks, soaked & boiled','protein','cooked',115,17.3,11.0,0.2,4.3,NULL,NULL,150,'soya',false,false,false,true,'Derived from dry values assuming ~3× weight gain on hydration. Prefer logging dry weight.','Hydrated weight. Use only if you weighed after cooking.'),
      ('Soy milk, unsweetened','beverage','as_packaged',33,2.9,1.7,1.6,0.4,'cup',240,250,NULL,false,false,false,true,NULL,'1 ml ≈ 1 g.'),
      ('Lentils (masoor/toor)','protein','dry',352,24.6,63.4,1.1,10.7,NULL,NULL,60,NULL,false,false,false,false,NULL,'Dry weight.'),
      ('Lentils, boiled','protein','cooked',116,9.0,20.1,0.4,7.9,NULL,NULL,150,NULL,false,false,false,false,NULL,'Cooked weight, no added fat.'),
      ('Chickpeas','protein','dry',378,20.5,62.9,6.0,12.2,NULL,NULL,60,NULL,false,false,false,false,NULL,'Dry weight.'),
      ('Chickpeas, boiled','protein','cooked',164,8.9,27.4,2.6,7.6,NULL,NULL,150,NULL,false,false,false,false,NULL,'Cooked weight.'),
      ('Kidney beans (rajma)','protein','dry',333,23.6,60.0,0.8,15.2,NULL,NULL,60,NULL,false,false,false,false,NULL,'Dry weight.'),
      ('Kidney beans, boiled','protein','cooked',127,8.7,22.8,0.5,6.4,NULL,NULL,150,NULL,false,false,false,false,NULL,'Cooked weight.'),
      ('Green peas','vegetable','raw',81,5.4,14.5,0.4,5.1,NULL,NULL,100,NULL,false,false,false,false,NULL,NULL),
      ('Green peas, boiled','vegetable','cooked',84,5.4,15.6,0.2,5.5,NULL,NULL,100,NULL,false,false,false,false,NULL,NULL),
      ('Plant protein powder (pea/rice)','supplement','as_packaged',380,75.0,8.0,6.0,3.0,'scoop',30,30,'protein_powder',false,false,false,false,'Typical label values. Brands vary a lot — edit to match your tub.','Scoop size varies by brand.'),
      ('White rice','carbohydrate','raw',365,7.1,80.0,0.7,1.3,NULL,NULL,70,NULL,false,false,false,false,NULL,'Uncooked weight.'),
      ('White rice, cooked','carbohydrate','cooked',130,2.7,28.2,0.3,0.4,NULL,NULL,200,NULL,false,false,false,false,NULL,'Boiled, no added fat.'),
      ('Brown rice','carbohydrate','raw',367,7.5,76.2,3.2,3.6,NULL,NULL,70,NULL,false,false,false,false,NULL,'Uncooked weight.'),
      ('Brown rice, cooked','carbohydrate','cooked',123,2.7,25.6,1.0,1.6,NULL,NULL,200,NULL,false,false,false,false,NULL,NULL),
      ('Chapati / roti, plain','carbohydrate','cooked',299,11.3,46.4,7.5,4.9,'chapati',40,80,NULL,false,false,false,false,NULL,'Whole wheat, no ghee or oil brushed on.'),
      ('Whole wheat bread','carbohydrate','as_packaged',252,12.4,42.7,3.5,6.0,'slice',32,64,NULL,false,false,false,false,NULL,'Check label: some breads contain milk.'),
      ('Rolled oats','carbohydrate','dry',379,13.2,67.7,6.5,10.1,NULL,NULL,50,NULL,false,false,false,false,NULL,'Dry weight.'),
      ('Potato','carbohydrate','raw',77,2.0,17.5,0.1,2.1,NULL,NULL,200,NULL,false,false,false,false,NULL,NULL),
      ('Potato, boiled','carbohydrate','cooked',87,1.9,20.1,0.1,1.8,NULL,NULL,200,NULL,false,false,false,false,NULL,NULL),
      ('Sweet potato','carbohydrate','raw',86,1.6,20.1,0.1,3.0,NULL,NULL,200,NULL,false,false,false,false,NULL,NULL),
      ('Sweet potato, baked','carbohydrate','cooked',90,2.0,20.7,0.2,3.3,NULL,NULL,200,NULL,false,false,false,false,NULL,NULL),
      ('Banana','fruit','raw',89,1.1,22.8,0.3,2.6,'banana',120,120,NULL,false,false,false,false,NULL,'Peeled weight.'),
      ('Apple','fruit','raw',52,0.3,13.8,0.2,2.4,'apple',180,180,NULL,false,false,false,false,NULL,'With skin, cored.'),
      ('Orange','fruit','raw',47,0.9,11.8,0.1,2.4,'orange',130,130,NULL,false,false,false,false,NULL,'Peeled.'),
      ('Papaya','fruit','raw',43,0.5,10.8,0.3,1.7,NULL,NULL,150,NULL,false,false,false,false,NULL,NULL),
      ('Guava','fruit','raw',68,2.6,14.3,1.0,5.4,NULL,NULL,100,NULL,false,false,false,false,NULL,NULL),
      ('Almonds','fat','raw',579,21.2,21.6,49.9,12.5,NULL,NULL,20,NULL,false,false,false,false,NULL,NULL),
      ('Walnuts','fat','raw',654,15.2,13.7,65.2,6.7,NULL,NULL,20,NULL,false,false,false,false,NULL,NULL),
      ('Peanuts','fat','raw',567,25.8,16.1,49.2,8.5,NULL,NULL,30,NULL,false,false,false,false,NULL,NULL),
      ('Peanut butter, unsweetened','fat','as_packaged',588,25.0,20.0,50.0,6.0,'tbsp',16,16,NULL,false,false,false,false,NULL,NULL),
      ('Olive oil','fat','not_applicable',884,0,0,100,0,'tbsp',13.5,10,'cooking_oil',false,false,false,false,NULL,'Log only if not already included in a recipe or cooked-dish entry.'),
      ('Sunflower oil','fat','not_applicable',884,0,0,100,0,'tbsp',13.6,10,'cooking_oil',false,false,false,false,NULL,'Log only if not already included in a recipe or cooked-dish entry.'),
      ('Mustard oil','fat','not_applicable',884,0,0,100,0,'tbsp',14,10,'cooking_oil',false,false,false,false,NULL,'Log only if not already included in a recipe or cooked-dish entry.'),
      ('Coconut oil','fat','not_applicable',892,0,0,99.1,0,'tbsp',13.6,10,'cooking_oil',false,false,false,false,NULL,'Log only if not already included in a recipe or cooked-dish entry.'),
      ('Coconut, fresh','fat','raw',354,3.3,15.2,33.5,9.0,NULL,NULL,30,NULL,false,false,false,false,NULL,NULL),
      ('Chia seeds','fat','dry',486,16.5,42.1,30.7,34.4,'tbsp',12,12,NULL,false,false,false,false,NULL,NULL),
      ('Flaxseeds','fat','dry',534,18.3,28.9,42.2,27.3,'tbsp',10,10,NULL,false,false,false,false,NULL,NULL),
      ('Pumpkin seeds','fat','dry',559,30.2,10.7,49.1,6.0,NULL,NULL,20,NULL,false,false,false,false,NULL,NULL),
      ('Carrot','vegetable','raw',41,0.9,9.6,0.2,2.8,NULL,NULL,100,NULL,false,false,false,false,NULL,NULL),
      ('Green beans','vegetable','raw',31,1.8,7.0,0.2,2.7,NULL,NULL,100,NULL,false,false,false,false,NULL,NULL),
      ('Broccoli','vegetable','raw',34,2.8,6.6,0.4,2.6,NULL,NULL,100,NULL,false,false,false,false,NULL,NULL),
      ('Spinach','vegetable','raw',23,2.9,3.6,0.4,2.2,NULL,NULL,100,NULL,false,false,false,false,NULL,NULL),
      ('Cucumber','vegetable','raw',15,0.7,3.6,0.1,0.5,NULL,NULL,100,NULL,false,false,false,false,NULL,NULL),
      ('Beetroot','vegetable','raw',43,1.6,9.6,0.2,2.8,NULL,NULL,100,NULL,false,false,false,false,NULL,NULL),
      ('Onion','vegetable','raw',40,1.1,9.3,0.1,1.7,NULL,NULL,50,NULL,false,false,false,false,NULL,NULL),
      ('Tomato','vegetable','raw',18,0.9,3.9,0.2,1.2,NULL,NULL,100,NULL,false,false,false,false,NULL,NULL),
      ('Cauliflower','vegetable','raw',25,1.9,5.0,0.3,2.0,NULL,NULL,100,NULL,false,false,false,false,NULL,NULL),
      ('Cabbage','vegetable','raw',25,1.3,5.8,0.1,2.5,NULL,NULL,100,NULL,false,false,false,false,NULL,NULL),
      ('Bell pepper (capsicum)','vegetable','raw',31,1.0,6.0,0.3,2.1,NULL,NULL,100,NULL,false,false,false,false,NULL,NULL),
      ('Mushrooms','vegetable','raw',22,3.1,3.3,0.3,1.0,NULL,NULL,100,NULL,false,false,false,false,NULL,NULL)
    ) AS v(name, category, state, kcal, p, c, f, fi, unit_label, unit_g, serving, tag, meat, fish, egg, soy, src_override, notes)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS foods_added = ROW_COUNT;
  END IF;

  -- ------------------------------------------------------------ exercises
  IF NOT EXISTS (SELECT 1 FROM exercise_library WHERE user_id = uid AND NOT is_custom) THEN
    INSERT INTO exercise_library (user_id, name, muscle_group, secondary_muscles, category, equipment, measurement_type, instructions, is_custom)
    SELECT uid, v.name, v.mg, v.sec, v.cat, v.eq, v.mt, v.ins, false
    FROM (VALUES
      ('Bench press','chest','{triceps,shoulders}'::text[],'compound','Barbell, flat bench','weight_reps','Feet planted, shoulder blades pulled back. Lower the bar under control to mid-chest, press up and slightly back. Use a spotter or safety arms.'),
      ('Incline dumbbell press','chest','{shoulders,triceps}','compound','Dumbbells, incline bench','weight_reps','Bench at 30–45°. Lower dumbbells to upper chest with elbows ~45° from torso, press up without clashing.'),
      ('Decline press','chest','{triceps}','compound','Barbell or machine, decline bench','weight_reps','Secure legs, lower to lower chest, press to lockout under control.'),
      ('Chest press machine','chest','{triceps,shoulders}','compound','Machine','weight_reps','Set handles at mid-chest height. Press out smoothly, return slowly without letting the stack touch down.'),
      ('Cable fly','chest','{}','isolation','Cable station','weight_reps','Slight elbow bend held constant. Bring hands together in an arc, squeeze, return with control.'),
      ('Pec deck','chest','{}','isolation','Machine','weight_reps','Elbows slightly below shoulders. Bring pads together, pause, return slowly.'),
      ('Lat pulldown','back','{biceps}','compound','Cable machine','weight_reps','Chest up, pull bar to upper chest by driving elbows down. Avoid leaning far back.'),
      ('Seated cable row','back','{biceps}','compound','Cable machine','weight_reps','Neutral spine. Pull handle to lower ribs, squeeze shoulder blades, extend arms fully under control.'),
      ('Dumbbell row','back','{biceps}','compound','Dumbbell, bench','weight_reps','One hand and knee on bench, flat back. Row the dumbbell toward the hip.'),
      ('Chest-supported row','back','{biceps}','compound','Incline bench + dumbbells or machine','weight_reps','Chest on pad, row elbows back, avoid lifting chest off the pad.'),
      ('Face pull','shoulders','{back}','isolation','Cable with rope','weight_reps','Rope at face height. Pull toward the face with elbows high, externally rotate at the end.'),
      ('Assisted pull-up','back','{biceps}','compound','Assisted pull-up machine or band','assisted_reps','Log the assistance amount in the weight field (lower = harder). Assistance is not counted as lifting volume.'),
      ('Shoulder press','shoulders','{triceps}','compound','Dumbbells or machine','weight_reps','Brace core, press overhead without arching the lower back. Lower to ear level.'),
      ('Dumbbell lateral raise','shoulders','{}','isolation','Dumbbells','weight_reps','Slight elbow bend, raise to shoulder height leading with elbows. Control the descent.'),
      ('Front raise','shoulders','{}','isolation','Dumbbells or plate','weight_reps','Raise to shoulder height in front, no swinging.'),
      ('Rear delt fly','shoulders','{back}','isolation','Dumbbells or reverse pec deck','weight_reps','Hinge forward or use machine; sweep arms out wide, squeeze rear delts.'),
      ('Dumbbell curl','biceps','{}','isolation','Dumbbells','weight_reps','Elbows pinned to sides, curl without swinging, lower fully.'),
      ('Hammer curl','biceps','{}','isolation','Dumbbells','weight_reps','Neutral grip (palms facing). Curl and lower under control.'),
      ('Barbell curl','biceps','{}','isolation','Barbell or EZ bar','weight_reps','Shoulder-width grip, elbows fixed, avoid leaning back.'),
      ('Preacher curl','biceps','{}','isolation','Preacher bench','weight_reps','Upper arm flat on pad. Lower until nearly straight, do not bounce.'),
      ('Triceps pushdown','triceps','{}','isolation','Cable','weight_reps','Elbows at sides, extend fully, return to ~90° under control.'),
      ('Overhead extension','triceps','{}','isolation','Dumbbell or cable','weight_reps','Elbows pointing up and close, lower behind head, extend fully.'),
      ('Skull crushers','triceps','{}','isolation','EZ bar or dumbbells, bench','weight_reps','Lower toward forehead/behind head by bending elbows only. Start light.'),
      ('Squats','quadriceps','{glutes,hamstrings,core}','compound','Barbell + rack, or goblet','weight_reps','Brace, sit down between hips to a depth you control with a neutral spine. Use safety pins.'),
      ('Leg press','quadriceps','{glutes}','compound','Leg press machine','weight_reps','Feet shoulder-width. Lower until knees ~90° without the lower back lifting off the pad. Do not lock knees hard.'),
      ('Leg curl','hamstrings','{}','isolation','Machine','weight_reps','Pad above heels, curl fully, lower slowly.'),
      ('Leg extension','quadriceps','{}','isolation','Machine','weight_reps','Pad on lower shin, extend fully, pause, lower under control.'),
      ('Romanian deadlift','hamstrings','{glutes,back}','compound','Barbell or dumbbells','weight_reps','Soft knees, hinge at hips keeping the bar close and back neutral. Stop when hamstrings limit range.'),
      ('Hip thrust','glutes','{hamstrings}','compound','Barbell + bench or machine','weight_reps','Upper back on bench, drive through heels to full hip extension, chin tucked.'),
      ('Calf raises','calves','{}','isolation','Machine, step or dumbbells','weight_reps','Full stretch at bottom, pause at the top.'),
      ('Split squats','quadriceps','{glutes}','compound','Dumbbells or bodyweight','weight_reps','Log reps per leg. Torso tall, lower back knee toward the floor.'),
      ('Plank','core','{}','core','Bodyweight','time','Forearms under shoulders, straight line head to heels, brace abs and glutes. Log seconds held.'),
      ('Side plank','core','{}','core','Bodyweight','time','Elbow under shoulder, hips high. Log seconds per side.'),
      ('Dead bug','core','{}','core','Bodyweight','bodyweight_reps','Lower back pressed into floor, extend opposite arm and leg slowly. Log reps per side.'),
      ('Cable crunch','core','{}','core','Cable with rope','weight_reps','Kneel, crunch by flexing the spine, not by pulling with arms.'),
      ('Leg raises','core','{}','core','Bench or hanging bar','bodyweight_reps','Control the descent; keep lower back from arching.'),
      ('Kettlebell swing','full_body','{glutes,hamstrings}','conditioning','Kettlebell','weight_reps','Hip hinge, snap hips forward, bell floats to chest height. Learn the hinge before going heavy.'),
      ('Farmer''s carry','full_body','{core}','conditioning','Dumbbells or kettlebells','time','Tall posture, walk with control. Log weight in each hand and seconds walked.'),
      ('Hip flexor stretch','mobility','{}','mobility','Bodyweight','time','Half-kneeling, tuck pelvis and gently shift forward. Log seconds per side.'),
      ('Thoracic rotation','mobility','{}','mobility','Bodyweight','bodyweight_reps','Side-lying or quadruped, rotate upper back slowly. Log reps per side.'),
      ('Cat-cow','mobility','{}','mobility','Bodyweight','bodyweight_reps','Alternate spinal flexion and extension slowly with breathing.')
    ) AS v(name, mg, sec, cat, eq, mt, ins)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS exercises_added = ROW_COUNT;
  END IF;

  -- ------------------------------------------------------ six-day plan
  IF NOT EXISTS (SELECT 1 FROM workout_plans WHERE user_id = uid) THEN
    -- (day, name, focus, rest?, notes)
    INSERT INTO workout_plans (user_id, day_of_week, name, focus, is_rest_day, notes, sort_order)
    VALUES
      (uid, 1, 'Push A', 'Chest · Shoulders · Triceps', false, 'Start with weights you can control for the top of the rep range with good form. Leave 1–3 reps in reserve.', 1),
      (uid, 2, 'Pull A', 'Back · Biceps', false, 'Focus on pulling with the back, not momentum.', 2),
      (uid, 3, 'Legs A', 'Quadriceps · Hamstrings · Glutes · Calves · Core', false, 'Warm up thoroughly. Squat depth only as deep as you can control with a neutral spine.', 3),
      (uid, 4, 'Cardio & Mobility', 'Low–moderate cardio · Mobility', false, '30–45 minutes of low-to-moderate intensity cardio (walk, cycle, cross-trainer). Log it under Cardio & Steps. Then the mobility circuit below.', 4),
      (uid, 5, 'Upper Body B', 'Chest · Back · Shoulders · Arms', false, 'Machine-friendly upper day. Keep 1–3 reps in reserve.', 5),
      (uid, 6, 'Legs B & Conditioning', 'Legs · Glutes · Core · Conditioning', false, 'Finish with conditioning only if recovered. Stop if anything hurts.', 6),
      (uid, 7, 'Rest', 'Recovery', true, 'Full rest. Easy walking is fine.', 7);
    GET DIAGNOSTICS plans_added = ROW_COUNT;

    INSERT INTO workout_plan_exercises (user_id, plan_id, exercise_id, sort_order, target_sets, target_reps_min, target_reps_max,
                                        target_duration_seconds, rest_seconds, progression_increment_kg, training_notes)
    SELECT uid, wp.id, el.id, v.ord, v.sets, v.rmin, v.rmax, v.secs, v.rest, v.inc, v.note
    FROM (VALUES
      (1,1,'Bench press',3,8,12,NULL::int,120,2.5,'Main lift. Record every set.'),
      (1,2,'Incline dumbbell press',3,8,12,NULL,90,2.0,NULL),
      (1,3,'Shoulder press',3,8,12,NULL,90,2.0,NULL),
      (1,4,'Dumbbell lateral raise',3,12,15,NULL,60,1.0,'Strict form; light weight is normal.'),
      (1,5,'Cable fly',2,12,15,NULL,60,2.5,NULL),
      (1,6,'Triceps pushdown',3,10,15,NULL,60,2.5,NULL),
      (1,7,'Overhead extension',2,10,15,NULL,60,2.0,NULL),
      (2,1,'Lat pulldown',3,8,12,NULL,120,2.5,NULL),
      (2,2,'Seated cable row',3,8,12,NULL,90,2.5,NULL),
      (2,3,'Dumbbell row',3,8,12,NULL,90,2.0,'Per arm.'),
      (2,4,'Face pull',3,12,15,NULL,60,2.5,NULL),
      (2,5,'Rear delt fly',2,12,15,NULL,60,1.0,NULL),
      (2,6,'Dumbbell curl',3,10,12,NULL,60,1.0,NULL),
      (2,7,'Hammer curl',2,10,12,NULL,60,1.0,NULL),
      (3,1,'Squats',3,6,10,NULL,150,2.5,'Main lift.'),
      (3,2,'Romanian deadlift',3,8,10,NULL,120,2.5,NULL),
      (3,3,'Leg press',3,10,12,NULL,120,5.0,NULL),
      (3,4,'Leg curl',3,10,12,NULL,75,2.5,NULL),
      (3,5,'Calf raises',3,12,15,NULL,60,2.5,NULL),
      (3,6,'Plank',3,NULL,NULL,30,60,0,'Build toward 45–60 s holds.'),
      (3,7,'Dead bug',3,8,10,NULL,60,0,'Reps per side.'),
      (4,1,'Hip flexor stretch',2,NULL,NULL,40,30,0,'Per side.'),
      (4,2,'Thoracic rotation',2,8,10,NULL,30,0,'Per side.'),
      (4,3,'Cat-cow',2,8,10,NULL,30,0,NULL),
      (5,1,'Chest press machine',3,8,12,NULL,90,2.5,NULL),
      (5,2,'Chest-supported row',3,8,12,NULL,90,2.5,NULL),
      (5,3,'Assisted pull-up',3,6,10,NULL,120,0,'Reduce assistance gradually.'),
      (5,4,'Pec deck',2,12,15,NULL,60,2.5,NULL),
      (5,5,'Dumbbell lateral raise',3,12,15,NULL,60,1.0,NULL),
      (5,6,'Barbell curl',2,8,12,NULL,60,2.5,NULL),
      (5,7,'Skull crushers',2,8,12,NULL,60,2.5,NULL),
      (6,1,'Split squats',3,8,10,NULL,90,2.0,'Reps per leg.'),
      (6,2,'Hip thrust',3,8,12,NULL,90,5.0,NULL),
      (6,3,'Leg extension',3,10,15,NULL,60,2.5,NULL),
      (6,4,'Leg curl',2,10,12,NULL,60,2.5,NULL),
      (6,5,'Calf raises',3,12,15,NULL,60,2.5,NULL),
      (6,6,'Cable crunch',3,10,15,NULL,60,2.5,NULL),
      (6,7,'Kettlebell swing',3,15,15,NULL,60,0,'Conditioning: only if recovered.'),
      (6,8,'Side plank',2,NULL,NULL,25,45,0,'Seconds per side.')
    ) AS v(day, ord, ex, sets, rmin, rmax, secs, rest, inc, note)
    JOIN workout_plans wp ON wp.user_id = uid AND wp.day_of_week = v.day
    JOIN exercise_library el ON el.user_id = uid AND lower(el.name) = lower(v.ex);
  END IF;

  -- ------------------------------------- default vegetarian meal templates
  -- Respect the default profile: vegetarian, eggs allowed, no dairy, soya allowed, no chicken.
  IF NOT EXISTS (SELECT 1 FROM meal_templates WHERE user_id = uid) THEN
    INSERT INTO meal_templates (user_id, name, meal_type, notes) VALUES
      (uid, 'Egg & oats breakfast', 'breakfast', 'Default vegetarian template (eggs, no dairy). Edit freely.'),
      (uid, 'Tofu, rice & veg lunch', 'lunch', 'Oil logged separately — skip it if your tofu was bought pre-fried.'),
      (uid, 'Post-workout shake', 'post_workout', 'Plant protein + banana.'),
      (uid, 'Soya chunk & chapati dinner', 'dinner', 'Soya chunks logged by DRY weight.');
    INSERT INTO meal_template_items (user_id, template_id, food_item_id, quantity, quantity_unit, grams, sort_order)
    SELECT uid, mt.id, fi.id, v.qty, v.unit, v.g, v.ord
    FROM (VALUES
      ('Egg & oats breakfast','Rolled oats','dry',60,'g',60,1),
      ('Egg & oats breakfast','Whole egg','raw',3,'piece',150,2),
      ('Egg & oats breakfast','Egg whites','raw',100,'g',100,3),
      ('Egg & oats breakfast','Banana','raw',1,'piece',120,4),
      ('Egg & oats breakfast','Soy milk, unsweetened','as_packaged',250,'ml',250,5),
      ('Tofu, rice & veg lunch','Tofu, firm','as_packaged',150,'g',150,1),
      ('Tofu, rice & veg lunch','White rice, cooked','cooked',200,'g',200,2),
      ('Tofu, rice & veg lunch','Broccoli','raw',100,'g',100,3),
      ('Tofu, rice & veg lunch','Carrot','raw',80,'g',80,4),
      ('Tofu, rice & veg lunch','Olive oil','not_applicable',5,'g',5,5),
      ('Post-workout shake','Plant protein powder (pea/rice)','as_packaged',1,'piece',30,1),
      ('Post-workout shake','Banana','raw',1,'piece',120,2),
      ('Soya chunk & chapati dinner','Soya chunks','dry',50,'g',50,1),
      ('Soya chunk & chapati dinner','Chapati / roti, plain','cooked',2,'piece',80,2),
      ('Soya chunk & chapati dinner','Lentils, boiled','cooked',150,'g',150,3),
      ('Soya chunk & chapati dinner','Spinach','raw',100,'g',100,4),
      ('Soya chunk & chapati dinner','Mustard oil','not_applicable',5,'g',5,5)
    ) AS v(tpl, food, st, qty, unit, g, ord)
    JOIN meal_templates mt ON mt.user_id = uid AND mt.name = v.tpl
    JOIN food_items fi ON fi.user_id = uid AND fi.name = v.food AND fi.state = v.st AND NOT fi.archived;
  END IF;

  -- ------------------------------------------------- default nutrition targets
  IF NOT EXISTS (SELECT 1 FROM nutrition_targets WHERE user_id = uid) THEN
    INSERT INTO nutrition_targets (user_id, effective_from, kcal_min, kcal_max, protein_min_g, protein_max_g,
                                   fat_min_g, fat_max_g, fibre_min_g, fibre_max_g, water_min_ml, water_max_ml,
                                   professional_guidance_note)
    SELECT uid, coalesce((SELECT start_date FROM transformation_programs WHERE user_id = uid AND is_active), current_date),
           2200, 2300, 150, 165, 60, 75, 25, 35, 2500, 3000,
           'Initial targets. Review with a registered dietitian or doctor before making large changes.';
  END IF;

  RETURN jsonb_build_object('foods', foods_added, 'exercises', exercises_added, 'plans', plans_added);
END;
$$;
REVOKE ALL ON FUNCTION public.pp_seed_defaults() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pp_seed_defaults() TO authenticated;
