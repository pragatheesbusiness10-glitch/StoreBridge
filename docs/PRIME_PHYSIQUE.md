# Prime Physique (offline)

A personal fitness transformation app that lives in this repository next to StoreBridge.
It is served under **`/fitness`** and runs **fully offline**:

* **No account and no server.** Every record and every progress photo is stored on the device,
  in the browser's IndexedDB. Nothing is sent over the network.
* **Installable.** It is a PWA ("Add to Home Screen" / "Install app"). After one online visit, a
  service worker has cached the whole app, so it opens and works with no internet connection.
* **Backups are files.** Settings has **Download full backup** (one `.json` file that includes
  photos), **Restore from backup** (also offered during onboarding, for moving to a new device),
  **Erase all data**, and a ZIP of CSV files for spreadsheets.

StoreBridge itself is unchanged and still uses Supabase.

## How it works

| Path | Purpose |
| --- | --- |
| `src/lib/pp/local-db.ts` | On-device relational engine. It exposes the same query API the pages use (`from().select().eq()…`, `insert`, `update`, `upsert`, `delete`, `rpc`, `storage`) and persists to IndexedDB |
| `src/lib/pp/local-schema.json` | Column defaults, generated from the SQL schema |
| `src/lib/pp/seed-data.json` | Default foods, exercises, 6-day plan, meal templates and targets: the exact output of `pp_seed_defaults()` |
| `src/lib/pp/backup.ts`, `src/components/pp/backup-panel.tsx` | Backup, restore and erase |
| `public/pp-sw.js`, `public/pp-manifest.webmanifest`, `public/pp-icon-*.png` | Service worker (scope `/fitness`), manifest and icons |
| `vite.config.ts` → `primePhysiquePrecache` | Emits `/pp-precache.json` at build time, listing every client file. The service worker caches all of them, so pages you have never opened still work offline |

The local engine applies the same rules as the SQL schema in
`supabase/migrations/*prime_physique*.sql`:

* **Nutrition:** for food-database entries, nutrients = grams ÷ 100 × the food's stored per-100 g
  values. Raw, cooked and dry foods are separate entries. Correcting a food changes past entries
  only when you explicitly ask for it.
* **Unique per day:** one weigh-in, one measurement set, one step total, one sleep entry and one
  note per day.
* **No invented data:** a measurement row needs at least one value, a body-fat value needs a
  method, and a set needs reps or seconds.
* **Deletes:** related rows are removed or detached the same way the database's foreign keys do it,
  and a food still used in a recipe can't be deleted.
* **Atomic writes:** a failed write changes nothing.
* **Calculated values:** the daily nutrition summary, sleep duration, recipe nutrition and the
  default-data seed.

Those SQL migrations are **not needed to run the app**. They are kept as the reference schema:
`tests/db` checks them, and `local-schema.json` and `seed-data.json` are generated from them.

## Running locally

```bash
npm install            # or: bun install
npm run dev            # http://localhost:5173/fitness  (the service worker only registers in production builds)
```

For a local production build:

```bash
NITRO_PRESET=node_server npx vite build
PORT=4173 node .output/server/index.mjs     # http://127.0.0.1:4173/fitness
```

Prime Physique needs no environment variables.

## Deploying

Publish from Lovable, or run `npm run build` and deploy `.output` as usual. Open `/fitness` once
while online on each device; it then works offline. Browsers only allow service workers on HTTPS
or `localhost`.

## Tests

```bash
bun test tests/unit                         # 63 tests: calculations + the offline database engine
PGHOST=/tmp PGPORT=54329 tests/db/run-db-tests.sh   # reference SQL schema (needs local PostgreSQL)

# Offline end-to-end test (production build running on :4173). It onboards, restores a 4-week backup,
# cuts the network, then uses every page, logs data offline and checks it persists across reloads:
node tests/e2e/make-backup.mjs fixtures.json backup.json   # fixtures exported from tests/e2e/seed-fixture.sql
APP_URL=http://127.0.0.1:4173 BACKUP=backup.json SHOTS=./shots node tests/e2e/offline.mjs
```

## Known limitations

* **No sync between devices.** Data stays on the device where it was entered; to move it, use a
  backup file.
* **Clearing data deletes everything.** Clearing site data or uninstalling the browser deletes the
  records. The app asks the browser to keep its storage (`navigator.storage.persist()`), but
  regular backups are still recommended. Private/incognito windows may not keep data at all.
* **PDF export** uses the browser's print dialog ("Save as PDF").
* **Reminders** appear inside the app only; there are no push notifications.
* **No integrations.** Steps, heart rate and device calories are entered by hand.
* **The default food values are generic approximations.** Each one is labelled and can be edited.
* **Week 8 of the brief's milestone table** says 83.86 kg. The exact projection rounds to 83.87 kg,
  so the app shows 83.87.
