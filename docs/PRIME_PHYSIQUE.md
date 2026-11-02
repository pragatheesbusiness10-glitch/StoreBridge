# Prime Physique

A personal fitness transformation app that lives in this repository next to StoreBridge.
It is served under **`/fitness`** and uses the same Supabase project and login. It has its own
tables, theme and navigation, and does not change StoreBridge data or behaviour.

## Stack

TanStack Start (React 19, file routes in `src/routes/fitness*.tsx`) · Tailwind v4 + shadcn/ui ·
Recharts · Supabase (Postgres + Auth + Storage). The browser talks to Supabase directly, and
Row Level Security limits every query to the signed-in user's rows. The app needs no service-role
key.

| Path | Purpose |
| --- | --- |
| `supabase/migrations/20261102100000_prime_physique_schema.sql` | Tables, view, triggers, RLS, private photo bucket |
| `supabase/migrations/20261102100100_prime_physique_seed_function.sql` | `pp_seed_defaults()`: default foods, exercises, 6-day plan, meal templates, targets |
| `src/lib/pp/calc.ts` | Pure calculations (BMI, moving averages, milestones, nutrient scaling, volume, e1RM, progression, streaks, achievements) |
| `src/lib/pp/*` | Data access, daily aggregation, workouts, nutrition helpers, CSV/PDF |
| `src/components/pp/*` | Shell, quick-entry dialogs, charts, shared UI |
| `tests/unit` | Calculation tests (`bun test tests/unit`) |
| `tests/db` | Migration + RLS/trigger tests against PostgreSQL |
| `tests/e2e` | Fixture generator + Playwright smoke test |

## Database

The migrations are additive. StoreBridge already owns `profiles`, so fitness attributes are stored
in `fitness_profiles`. The other tables are `transformation_programs`, `daily_weight_logs`,
`daily_body_measurements`, `food_items`, `recipe_ingredients`, `food_entries`, `meal_templates`,
`meal_template_items`, `nutrition_targets`, `exercise_library`, `workout_plans`,
`workout_plan_exercises`, `workout_sessions`, `workout_exercises`, `workout_sets` (one row per
set), `cardio_logs`, `step_logs`, `water_logs`, `sleep_logs`, `progress_photos`, `achievements`,
`reminders` and `daily_notes`. `daily_nutrition_summaries` is a `security_invoker` view.

* **RLS:** every table is owner-only (`user_id = auth.uid()`), with `FORCE ROW LEVEL SECURITY`.
  Child rows such as sets, plan exercises and recipe ingredients also check that the parent row
  belongs to the same user.
* **Nutrition integrity:** a trigger calculates the nutrients of food-database entries as
  `grams / 100 × per-100 g value`, using the food's stored values. Whatever the client sends is
  ignored. Each entry keeps a snapshot of those values. Correcting a food changes past entries only
  when the user explicitly calls `pp_recalculate_food_entries`.
* **Photos:** the `progress-photos` bucket is private. Files are stored under `<user_id>/…`, storage
  policies are owner-only, and the browser shows them through one-hour signed URLs. Uploads are
  re-encoded in the browser, which removes EXIF data such as GPS location.

## Running locally

```bash
npm install            # or: bun install
npm run dev            # http://localhost:5173/fitness
```

Environment variables (already in `.env`, managed by Lovable Cloud): `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` (plus the same values without `VITE_`
for SSR). Prime Physique needs no other variables.

### Apply the migrations

Apply the two `*prime_physique*` migrations to the Supabase project. You can do this through
Lovable, with `supabase db push`, or by running them in the SQL editor in timestamp order. Until
they are applied, the onboarding page shows a message explaining what to do.

## Tests

```bash
bun test tests/unit                                   # 43 calculation tests
PGHOST=/tmp PGPORT=54329 tests/db/run-db-tests.sh     # migrations + RLS + triggers (needs local PostgreSQL)
# Browser smoke test (dev server running; fixtures exported from tests/e2e/seed-fixture.sql):
APP_URL=http://localhost:5173 FIXTURES=fixtures.json SHOTS=./shots node tests/e2e/smoke.mjs
```

## Deploying

Publish from Lovable, or run `npm run build` and deploy the generated `.output` (Cloudflare target)
as usual. The migrations have to be applied to the production Supabase project.

## Known limitations

* The **PDF** export uses the browser's print dialog ("Save as PDF") with a print stylesheet. No
  PDF library is bundled.
* **Reminders** appear inside the app, on the dashboard. Push and email delivery are not set up.
* **No wearable or food-API integrations.** Steps, heart rate and device calories are entered by
  hand.
* **The seeded food values are generic approximations** (USDA FoodData Central style). Each food is
  labelled with its source and can be edited.
* **Week 8 of the brief's milestone table** says 83.86 kg. The exact projection is 83.8654, which
  rounds to 83.87 kg, so the app shows 83.87.
