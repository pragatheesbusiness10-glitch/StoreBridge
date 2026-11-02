// Offline database engine: the same rules the Postgres suite (tests/db) verifies, run against
// the on-device engine with in-memory persistence. Run with: bun test tests/unit
import { beforeEach, describe, expect, test } from "bun:test";
import { LocalDb, MemoryPersistence } from "../../src/lib/pp/local-db";

let p: MemoryPersistence;
let db: LocalDb;
const food = async (name: string, state: string) =>
  (await db.from("food_items").select("*").eq("name", name).eq("state", state).single()).data;
const log = (f: { id: string }, grams: number, extra: Record<string, unknown> = {}) =>
  db
    .from("food_entries")
    .insert({
      entry_date: "2026-11-03",
      meal_type: "lunch",
      food_item_id: f.id,
      food_name: "x",
      food_state: "raw",
      quantity: grams,
      quantity_unit: "g",
      grams,
      kcal: 0,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
      ...extra,
    })
    .select()
    .single();

beforeEach(async () => {
  p = new MemoryPersistence();
  db = new LocalDb(p);
  await db
    .from("fitness_profiles")
    .upsert({ display_name: "A", height_cm: 178, age: 25, onboarded_at: new Date().toISOString() });
  await db
    .from("transformation_programs")
    .insert({
      name: "PP",
      start_date: "2026-11-03",
      start_weight_kg: 93.25,
      target_weight_kg: 78,
      duration_weeks: 13,
    });
  await db.rpc("pp_seed_defaults");
});

describe("defaults & seeding", () => {
  test("seed matches the SQL seed function and is idempotent", async () => {
    const counts = async () => ({
      foods: (await db.from("food_items").select("*")).data.length,
      ex: (await db.from("exercise_library").select("*")).data.length,
      plans: (await db.from("workout_plans").select("*")).data.length,
      pe: (await db.from("workout_plan_exercises").select("*")).data.length,
      tplItems: (await db.from("meal_template_items").select("*")).data.length,
    });
    expect(await counts()).toEqual({ foods: 62, ex: 41, plans: 7, pe: 39, tplItems: 17 });
    expect((await db.rpc("pp_seed_defaults")).data).toEqual({ foods: 0, exercises: 0, plans: 0 });
    expect((await counts()).foods).toBe(62);
  });
  test("targets effective from programme start; no assumed weights", async () => {
    const t = (await db.from("nutrition_targets").select("*").single()).data;
    expect(t.effective_from).toBe("2026-11-03");
    expect(t.kcal_min).toBe(2200);
    const pe = (await db.from("workout_plan_exercises").select("*")).data;
    expect(pe.every((x: { suggested_weight_kg: unknown }) => x.suggested_weight_kg === null)).toBe(
      true,
    );
  });
  test("column defaults and nulls are filled", async () => {
    const { data } = await db
      .from("water_logs")
      .insert({ log_date: "2026-11-03", amount_ml: 250 })
      .select()
      .single();
    expect(data.id).toBeString();
    expect(data.user_id).toBe("local");
    expect(data.logged_at).toBeString();
    const ex = (
      await db
        .from("exercise_library")
        .insert({ name: "Sled push", muscle_group: "full_body", category: "conditioning" })
        .select()
        .single()
    ).data;
    expect(ex.secondary_muscles).toEqual([]);
    expect(ex.is_custom).toBe(true);
    expect(ex.instructions).toBeNull();
  });
});

describe("nutrition rules", () => {
  test("raw chicken 250 g = 300 kcal / 56.25 g protein, state taken from the food", async () => {
    const e = (
      await log(await food("Chicken breast, skinless", "raw"), 250, { food_state: "cooked" })
    ).data;
    expect(e.kcal).toBe(300);
    expect(e.protein_g).toBe(56.25);
    expect(e.food_state).toBe("raw");
    expect(e.tracking_tag).toBe("chicken");
  });
  test("dry soya 50 g = 172.5 kcal / 26 g protein", async () => {
    const e = (await log(await food("Soya chunks", "dry"), 50)).data;
    expect([e.kcal, e.protein_g]).toEqual([172.5, 26]);
  });
  test("database entry requires a food; manual entries keep typed values", async () => {
    const bad = await db
      .from("food_entries")
      .insert({
        entry_date: "2026-11-03",
        meal_type: "lunch",
        food_name: "x",
        food_state: "raw",
        quantity: 1,
        quantity_unit: "g",
        grams: 100,
        kcal: 1,
        protein_g: 1,
        carbs_g: 1,
        fat_g: 1,
      });
    expect(bad.error?.message).toMatch(/food_item_id is required/);
    const ok = await db
      .from("food_entries")
      .insert({
        entry_date: "2026-11-03",
        meal_type: "dinner",
        food_name: "Thali",
        food_state: "cooked",
        quantity: 1,
        quantity_unit: "serving",
        grams: 450,
        kcal: 640,
        protein_g: 18,
        carbs_g: 90,
        fat_g: 22,
        nutrition_source: "manual",
      })
      .select()
      .single();
    expect(ok.data.kcal).toBe(640);
  });
  test("editing grams recalculates; food corrections only apply when requested", async () => {
    const rice = await food("White rice, cooked", "cooked");
    const e = (await log(rice, 200)).data;
    expect(e.kcal).toBe(260);
    await db.from("food_entries").update({ grams: 100 }).eq("id", e.id);
    expect((await db.from("food_entries").select("*").eq("id", e.id).single()).data.kcal).toBe(130);
    await db.from("food_items").update({ kcal_per_100g: 140 }).eq("id", rice.id);
    expect((await db.from("food_entries").select("*").eq("id", e.id).single()).data.kcal).toBe(130);
    expect(
      (await db.rpc("pp_recalculate_food_entries", { _food_item_id: rice.id, _from: null })).data,
    ).toBe(1);
    expect((await db.from("food_entries").select("*").eq("id", e.id).single()).data.kcal).toBe(140);
  });
  test("daily summary view", async () => {
    await log(await food("Chicken breast, skinless", "raw"), 250);
    await log(await food("Soya chunks", "dry"), 50);
    const egg = await food("Whole egg", "raw");
    await log(egg, 150, { quantity: 3, quantity_unit: "piece" });
    const s = (
      await db.from("daily_nutrition_summaries").select("*").eq("entry_date", "2026-11-03").single()
    ).data;
    expect([s.chicken_g, s.soya_g, s.whole_egg_count, s.entry_count]).toEqual([250, 50, 3, 3]);
    expect(s.kcal).toBe(300 + 172.5 + 214.5);
  });
  test("recipe: 117.7 kcal / 100 g, 250 g servings, includes oil", async () => {
    const r = (
      await db
        .from("food_items")
        .insert({
          name: "Tofu stir fry",
          category: "recipe",
          state: "cooked",
          kcal_per_100g: 0,
          protein_per_100g: 0,
          carbs_per_100g: 0,
          fat_per_100g: 0,
          is_recipe: true,
          recipe_total_cooked_g: 500,
          recipe_servings: 2,
        })
        .select()
        .single()
    ).data;
    for (const [n, st, g] of [
      ["Tofu, firm", "as_packaged", 300],
      ["Broccoli", "raw", 200],
      ["Olive oil", "not_applicable", 10],
    ] as const) {
      await db
        .from("recipe_ingredients")
        .insert({ recipe_id: r.id, ingredient_id: (await food(n, st)).id, grams: g });
    }
    const out = (await db.rpc("pp_recompute_recipe", { _recipe_id: r.id })).data;
    expect([out.kcal_per_100g, out.default_serving_g, out.includes_cooking_oil]).toEqual([
      117.7,
      250,
      true,
    ]);
    // an ingredient used by a recipe cannot be deleted
    const del = await db
      .from("food_items")
      .delete()
      .eq("id", (await food("Broccoli", "raw")).id);
    expect(del.error?.message).toMatch(/still used/);
  });
  test("deleting a food keeps past entries (set null) and removes template items", async () => {
    const tofu = await food("Tofu, firm", "as_packaged");
    const e = (await log(tofu, 150)).data;
    await db.from("food_items").delete().eq("id", tofu.id);
    const after = (await db.from("food_entries").select("*").eq("id", e.id).single()).data;
    expect(after.food_item_id).toBeNull();
    expect(after.kcal).toBe(216);
    expect(
      (await db.from("meal_template_items").select("*").eq("food_item_id", tofu.id)).data,
    ).toEqual([]);
  });
});

describe("integrity rules", () => {
  test("one weigh-in per day; upsert updates in place", async () => {
    await db.from("daily_weight_logs").insert({ log_date: "2026-11-03", morning_weight_kg: 93.25 });
    const dup = await db
      .from("daily_weight_logs")
      .insert({ log_date: "2026-11-03", morning_weight_kg: 93 });
    expect(dup.error?.message).toMatch(/already a weigh-in/);
    await db
      .from("step_logs")
      .upsert({ log_date: "2026-11-03", steps: 5000 }, { onConflict: "user_id,log_date" });
    await db
      .from("step_logs")
      .upsert({ log_date: "2026-11-03", steps: 8000 }, { onConflict: "user_id,log_date" });
    expect(
      (await db.from("step_logs").select("*")).data.map((s: { steps: number }) => s.steps),
    ).toEqual([8000]);
  });
  test("measurements: no empty rows, body fat needs a method", async () => {
    expect(
      (await db.from("daily_body_measurements").insert({ measured_on: "2026-11-03" })).error,
    ).not.toBeNull();
    expect(
      (
        await db
          .from("daily_body_measurements")
          .insert({ measured_on: "2026-11-03", body_fat_pct: 25 })
      ).error,
    ).not.toBeNull();
    expect(
      (
        await db
          .from("daily_body_measurements")
          .insert({ measured_on: "2026-11-03", waist_cm: 98.5 })
      ).error,
    ).toBeNull();
  });
  test("sleep duration computed; invalid window rejected", async () => {
    const s = (
      await db
        .from("sleep_logs")
        .insert({
          sleep_date: "2026-11-04",
          bedtime: "2026-11-03T17:45:00Z",
          wake_time: "2026-11-04T01:15:00Z",
        })
        .select()
        .single()
    ).data;
    expect(s.duration_minutes).toBe(450);
    expect(
      (
        await db
          .from("sleep_logs")
          .insert({
            sleep_date: "2026-11-05",
            bedtime: "2026-11-05T07:00:00Z",
            wake_time: "2026-11-05T06:00:00Z",
          })
      ).error,
    ).not.toBeNull();
  });
  test("workout: sets stored individually, volume, cascade delete, embedded selects", async () => {
    const s = (
      await db
        .from("workout_sessions")
        .insert({ session_date: "2026-11-03", name: "Push A", status: "completed" })
        .select()
        .single()
    ).data;
    const we = (
      await db
        .from("workout_exercises")
        .insert({ session_id: s.id, exercise_name: "Bench press" })
        .select()
        .single()
    ).data;
    await db.from("workout_sets").insert([
      { workout_exercise_id: we.id, set_number: 1, weight_kg: 20, reps: 12 },
      { workout_exercise_id: we.id, set_number: 2, weight_kg: 25, reps: 10 },
      { workout_exercise_id: we.id, set_number: 3, weight_kg: 30, reps: 8 },
    ]);
    expect(
      (await db.from("workout_sets").insert({ workout_exercise_id: we.id, set_number: 4 })).error,
    ).not.toBeNull();
    const nested = (
      await db
        .from("workout_sessions")
        .select("*, workout_exercises(*, workout_sets(*))")
        .eq("id", s.id)
        .single()
    ).data;
    const sets = nested.workout_exercises[0].workout_sets as { weight_kg: number; reps: number }[];
    expect(sets.reduce((a, x) => a + x.weight_kg * x.reps, 0)).toBe(730);
    const hist = (
      await db
        .from("workout_exercises")
        .select("*, workout_sessions!inner(id, session_date, status), workout_sets(*)")
        .neq("workout_sessions.status", "skipped")
    ).data;
    expect(hist[0].workout_sessions.session_date).toBe("2026-11-03");
    await db.from("workout_sessions").delete().eq("id", s.id);
    expect((await db.from("workout_sets").select("*")).data).toEqual([]);
    expect((await db.from("workout_exercises").select("*")).data).toEqual([]);
  });
  test("a set cannot point at a missing exercise", async () => {
    expect(
      (
        await db
          .from("workout_sets")
          .insert({ workout_exercise_id: "nope", set_number: 1, reps: 5 })
      ).error?.message,
    ).toMatch(/not found/);
  });
  test("failed multi-row insert is all-or-nothing", async () => {
    const r = await db.from("water_logs").insert([
      { log_date: "2026-11-03", amount_ml: 250 },
      { log_date: "2026-11-03", amount_ml: 250, user_id: "local", id: "x" },
      { log_date: "2026-11-04", amount_ml: 300 },
    ]);
    expect(r.error).toBeNull();
    const bad = await db.from("daily_weight_logs").insert([
      { log_date: "2026-11-10", morning_weight_kg: 90 },
      { log_date: "2026-11-10", morning_weight_kg: 91 },
    ]);
    expect(bad.error).not.toBeNull();
    expect(
      (await db.from("daily_weight_logs").select("*").eq("log_date", "2026-11-10")).data,
    ).toEqual([]);
  });
  test("single / maybeSingle semantics", async () => {
    expect(
      (await db.from("daily_notes").select("*").eq("note_date", "2026-11-03").maybeSingle()).data,
    ).toBeNull();
    expect(
      (await db.from("daily_notes").select("*").eq("note_date", "2026-11-03").single()).error,
    ).not.toBeNull();
  });
});

describe("persistence, photos, backup", () => {
  test("data survives a reload from storage", async () => {
    await db.from("daily_weight_logs").insert({ log_date: "2026-11-03", morning_weight_kg: 93.25 });
    const db2 = new LocalDb(p);
    expect((await db2.from("daily_weight_logs").select("*")).data[0].morning_weight_kg).toBe(93.25);
    expect((await db2.from("food_items").select("*")).data.length).toBe(62);
  });
  test("photos stored as blobs, removable", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    await db.storage.from("progress-photos").upload("local/2026-11-03/front.jpg", blob);
    expect(p.files.has("progress-photos/local/2026-11-03/front.jpg")).toBe(true);
    await db.storage.from("progress-photos").remove(["local/2026-11-03/front.jpg"]);
    expect(p.files.size).toBe(0);
  });
  test("export → erase → import round-trip", async () => {
    await db.from("daily_weight_logs").insert({ log_date: "2026-11-03", morning_weight_kg: 93.25 });
    await db.storage.from("progress-photos").upload("local/a.jpg", new Blob(["x"]));
    const dump = await db.exportAll();
    await db.eraseAll();
    expect((await db.from("daily_weight_logs").select("*")).data).toEqual([]);
    expect((await db.from("food_items").select("*")).data).toEqual([]);
    await db.importAll(dump.tables, dump.files);
    expect((await db.from("daily_weight_logs").select("*")).data.length).toBe(1);
    expect((await db.from("food_items").select("*")).data.length).toBe(62);
    expect(p.files.size).toBe(1);
  });
});
