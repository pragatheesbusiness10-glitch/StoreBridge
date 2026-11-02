import { useState } from "react";
import { Input } from "@/components/ui/input";
import { bmi, milestones, weeklyRateKg, weeklyRatePct } from "@/lib/pp/calc";
import { addDaysStr, fmtDate } from "@/lib/pp/dates";
import {
  BODY_FAT_METHODS,
  type BodyFatMethod,
  type FitnessProfile,
  type Program,
} from "@/lib/pp/types";
import { Field, NativeSelect, NumInput, Toggle, parseOptNum, strOf } from "./ui";

export type ProfileFormValues = {
  display_name: string;
  start_date: string;
  start_weight_kg: string;
  target_weight_kg: string;
  duration_weeks: string;
  height_cm: string;
  age: string;
  sex: string;
  initial_waist_cm: string;
  initial_body_fat_pct: string;
  initial_body_fat_method: string;
  training_days_per_week: string;
  training_equipment: string;
  physique_goal: string;
  diet_preference: FitnessProfile["diet_preference"];
  eggs_allowed: boolean;
  dairy_allowed: boolean;
  soya_allowed: boolean;
  chicken_in_meal_plan: boolean;
  low_calorie_warning_kcal: string;
};

/** Initial profile from the Prime Physique brief. Unknown values stay blank. */
export const DEFAULT_PROFILE: ProfileFormValues = {
  display_name: "",
  start_date: "2026-11-03",
  start_weight_kg: "93.25",
  target_weight_kg: "78",
  duration_weeks: "13",
  height_cm: "178",
  age: "25",
  sex: "",
  initial_waist_cm: "",
  initial_body_fat_pct: "",
  initial_body_fat_method: "",
  training_days_per_week: "6",
  training_equipment: "Full gym and home equipment",
  physique_goal: "Athletic, muscular and lean",
  diet_preference: "vegetarian",
  eggs_allowed: true,
  dairy_allowed: false,
  soya_allowed: true,
  chicken_in_meal_plan: false,
  low_calorie_warning_kcal: "1600",
};

export function valuesFrom(
  profile: FitnessProfile | null,
  program: Program | null,
): ProfileFormValues {
  if (!profile) return DEFAULT_PROFILE;
  return {
    display_name: profile.display_name ?? "",
    start_date: program?.start_date ?? DEFAULT_PROFILE.start_date,
    start_weight_kg: strOf(program?.start_weight_kg),
    target_weight_kg: strOf(program?.target_weight_kg),
    duration_weeks: strOf(program?.duration_weeks),
    height_cm: strOf(profile.height_cm),
    age: strOf(profile.age),
    sex: profile.sex ?? "",
    initial_waist_cm: strOf(profile.initial_waist_cm),
    initial_body_fat_pct: strOf(profile.initial_body_fat_pct),
    initial_body_fat_method: profile.initial_body_fat_method ?? "",
    training_days_per_week: strOf(profile.training_days_per_week),
    training_equipment: profile.training_equipment ?? "",
    physique_goal: profile.physique_goal ?? "",
    diet_preference: profile.diet_preference,
    eggs_allowed: profile.eggs_allowed,
    dairy_allowed: profile.dairy_allowed,
    soya_allowed: profile.soya_allowed,
    chicken_in_meal_plan: profile.chicken_in_meal_plan,
    low_calorie_warning_kcal: strOf(profile.low_calorie_warning_kcal),
  };
}

/** Validate and split into the two table payloads. Returns an error string on failure. */
export function toPayload(
  v: ProfileFormValues,
): { error: string } | { profile: Record<string, unknown>; program: Record<string, unknown> } {
  const sw = parseOptNum(v.start_weight_kg, { min: 30, max: 400 });
  const tw = parseOptNum(v.target_weight_kg, { min: 30, max: 400 });
  const weeks = parseOptNum(v.duration_weeks, { min: 1, max: 156, int: true });
  const h = parseOptNum(v.height_cm, { min: 100, max: 250 });
  const age = parseOptNum(v.age, { min: 13, max: 100, int: true });
  const waist = parseOptNum(v.initial_waist_cm, { min: 30, max: 250 });
  const bf = parseOptNum(v.initial_body_fat_pct, { min: 2, max: 70 });
  const days = parseOptNum(v.training_days_per_week, { min: 0, max: 7, int: true });
  const lowKcal = parseOptNum(v.low_calorie_warning_kcal, { min: 800, max: 5000, int: true });
  if (!v.start_date) return { error: "Choose a starting date" };
  if (!sw) return { error: "Starting weight must be 30–400 kg" };
  if (!tw) return { error: "Target weight must be 30–400 kg" };
  if (!weeks) return { error: "Programme duration must be 1–156 whole weeks" };
  if (h === undefined) return { error: "Height must be 100–250 cm" };
  if (age === undefined) return { error: "Age must be a whole number 13–100" };
  if (waist === undefined) return { error: "Waist must be 30–250 cm (or leave blank if unknown)" };
  if (bf === undefined) return { error: "Body fat must be 2–70 % (or leave blank if unknown)" };
  if (bf !== null && !v.initial_body_fat_method)
    return { error: "Select how the body fat value was obtained" };
  if (days === undefined || days === null) return { error: "Training days must be 0–7" };
  if (!lowKcal) return { error: "Low-calorie warning threshold must be 800–5000 kcal" };
  return {
    profile: {
      display_name: v.display_name.trim() || null,
      height_cm: h,
      age,
      sex: v.sex || null,
      initial_waist_cm: waist,
      initial_body_fat_pct: bf,
      initial_body_fat_method: bf === null ? null : v.initial_body_fat_method,
      training_days_per_week: days,
      training_equipment: v.training_equipment.trim() || null,
      physique_goal: v.physique_goal.trim() || null,
      diet_preference: v.diet_preference,
      eggs_allowed: v.eggs_allowed,
      dairy_allowed: v.dairy_allowed,
      soya_allowed: v.soya_allowed,
      chicken_in_meal_plan: v.chicken_in_meal_plan,
      low_calorie_warning_kcal: lowKcal,
    },
    program: {
      name: "Prime Physique",
      start_date: v.start_date,
      start_weight_kg: sw,
      target_weight_kg: tw,
      duration_weeks: weeks,
      is_active: true,
    },
  };
}

export function ProfileFields({
  v,
  setV,
}: {
  v: ProfileFormValues;
  setV: (v: ProfileFormValues) => void;
}) {
  const set = <K extends keyof ProfileFormValues>(k: K, val: ProfileFormValues[K]) =>
    setV({ ...v, [k]: val });
  const [showPlan, setShowPlan] = useState(false);
  const sw = Number(v.start_weight_kg);
  const tw = Number(v.target_weight_kg);
  const weeks = Number(v.duration_weeks);
  const valid = sw > 0 && tw > 0 && weeks >= 1 && Number.isInteger(weeks);
  const prog = valid
    ? ({
        start_date: v.start_date,
        start_weight_kg: sw,
        target_weight_kg: tw,
        duration_weeks: weeks,
      } as Program)
    : null;
  const ratePct = prog ? weeklyRatePct(prog) : null;
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Programme</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Starting date" id="p-start">
            <Input
              id="p-start"
              type="date"
              value={v.start_date}
              onChange={(e) => set("start_date", e.target.value)}
            />
          </Field>
          <Field label="Starting weight (kg)" id="p-sw">
            <NumInput
              id="p-sw"
              value={v.start_weight_kg}
              onChange={(x) => set("start_weight_kg", x)}
            />
          </Field>
          <Field label="Target weight (kg)" id="p-tw">
            <NumInput
              id="p-tw"
              value={v.target_weight_kg}
              onChange={(x) => set("target_weight_kg", x)}
            />
          </Field>
          <Field label="Duration (weeks)" id="p-weeks">
            <NumInput
              id="p-weeks"
              step="1"
              value={v.duration_weeks}
              onChange={(x) => set("duration_weeks", x)}
            />
          </Field>
        </div>
        {prog && (
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
            <div>
              Ends {fmtDate(addDaysStr(v.start_date, weeks * 7))} · implied average{" "}
              {weeklyRateKg(prog)} kg/week ({ratePct}% of starting weight per week). These are
              mathematical projections, not mandatory rates or guarantees.
            </div>
            {ratePct !== null && ratePct > 1 && (
              <div className="font-medium text-amber-700 dark:text-amber-300">
                More than ~1% of body weight per week is aggressive. Consider a longer duration and
                discuss with a healthcare professional. Never use crash dieting, dehydration or
                excessive exercise to hit a milestone.
              </div>
            )}
            <button type="button" className="underline" onClick={() => setShowPlan(!showPlan)}>
              {showPlan ? "Hide" : "Show"} weekly projection
            </button>
            {showPlan && (
              <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-4 pt-1">
                {milestones(prog).map((m) => (
                  <div key={m.week} className="tabular-nums">
                    {m.week === 0 ? "Start" : `Wk ${m.week}`} · {fmtDate(m.date, "d MMM")} ·{" "}
                    {m.target.toFixed(2)} kg
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Body</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Name (optional)" id="p-name">
            <Input
              id="p-name"
              value={v.display_name}
              onChange={(e) => set("display_name", e.target.value)}
            />
          </Field>
          <Field
            label="Height (cm)"
            id="p-h"
            hint={
              v.height_cm && v.start_weight_kg
                ? `Starting BMI ${bmi(sw, Number(v.height_cm)) ?? "—"}`
                : undefined
            }
          >
            <NumInput id="p-h" value={v.height_cm} onChange={(x) => set("height_cm", x)} />
          </Field>
          <Field label="Age" id="p-age">
            <NumInput id="p-age" step="1" value={v.age} onChange={(x) => set("age", x)} />
          </Field>
          <Field label="Sex (optional)" id="p-sex">
            <NativeSelect
              id="p-sex"
              value={v.sex}
              onChange={(x) => set("sex", x)}
              placeholder="Not specified"
              options={[
                { value: "male", label: "Male" },
                { value: "female", label: "Female" },
                { value: "prefer_not_to_say", label: "Prefer not to say" },
              ]}
            />
          </Field>
          <Field label="Waist (cm)" id="p-waist" hint="Leave blank if unknown">
            <NumInput
              id="p-waist"
              value={v.initial_waist_cm}
              onChange={(x) => set("initial_waist_cm", x)}
              placeholder="Unknown"
            />
          </Field>
          <Field label="Body fat (%)" id="p-bf" hint="Leave blank if unknown">
            <NumInput
              id="p-bf"
              value={v.initial_body_fat_pct}
              onChange={(x) => set("initial_body_fat_pct", x)}
              placeholder="Unknown"
            />
          </Field>
          {v.initial_body_fat_pct && (
            <Field label="Body fat method" id="p-bfm" className="col-span-2">
              <NativeSelect
                id="p-bfm"
                value={v.initial_body_fat_method}
                onChange={(x) => set("initial_body_fat_method", x as BodyFatMethod)}
                placeholder="How was it obtained?"
                options={BODY_FAT_METHODS.map((m) => ({
                  value: m.value,
                  label: m.label + (m.measured ? "" : " (estimate)"),
                }))}
              />
            </Field>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Training & diet</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Training days / week" id="p-days">
            <NumInput
              id="p-days"
              step="1"
              value={v.training_days_per_week}
              onChange={(x) => set("training_days_per_week", x)}
            />
          </Field>
          <Field label="Equipment" id="p-eq" className="col-span-1 sm:col-span-3">
            <Input
              id="p-eq"
              value={v.training_equipment}
              onChange={(e) => set("training_equipment", e.target.value)}
            />
          </Field>
          <Field label="Physique goal" id="p-goal" className="col-span-2">
            <Input
              id="p-goal"
              value={v.physique_goal}
              onChange={(e) => set("physique_goal", e.target.value)}
            />
          </Field>
          <Field label="Diet preference" id="p-diet">
            <NativeSelect
              id="p-diet"
              value={v.diet_preference}
              onChange={(x) => set("diet_preference", x as ProfileFormValues["diet_preference"])}
              options={[
                { value: "vegetarian", label: "Vegetarian" },
                { value: "vegan", label: "Vegan" },
                { value: "pescatarian", label: "Pescatarian" },
                { value: "non_vegetarian", label: "Non-vegetarian" },
              ]}
            />
          </Field>
          <Field label="Low-intake warning below (kcal/day)" id="p-low">
            <NumInput
              id="p-low"
              step="1"
              value={v.low_calorie_warning_kcal}
              onChange={(x) => set("low_calorie_warning_kcal", x)}
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Toggle
            id="p-eggs"
            checked={v.eggs_allowed}
            onChange={(x) => set("eggs_allowed", x)}
            label="Eggs allowed"
          />
          <Toggle
            id="p-dairy"
            checked={v.dairy_allowed}
            onChange={(x) => set("dairy_allowed", x)}
            label="Dairy allowed"
          />
          <Toggle
            id="p-soya"
            checked={v.soya_allowed}
            onChange={(x) => set("soya_allowed", x)}
            label="Soya allowed"
          />
          <Toggle
            id="p-chicken"
            checked={v.chicken_in_meal_plan}
            onChange={(x) => set("chicken_in_meal_plan", x)}
            label="Include chicken in meal plan"
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Chicken stays trackable in the food database either way; this only controls whether it
          appears in your default meal suggestions.
        </p>
      </section>
    </div>
  );
}
