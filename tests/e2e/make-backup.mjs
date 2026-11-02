// Converts a table dump (JSON object: table -> rows, e.g. exported from the Postgres fixture built by
// tests/e2e/seed-fixture.sql) into a Prime Physique backup file that Settings → Restore accepts.
// Usage: node tests/e2e/make-backup.mjs fixtures.json backup.json
import { readFileSync, writeFileSync } from "node:fs";

const [, , src, out] = process.argv;
const tables = JSON.parse(readFileSync(src, "utf8"));
delete tables.daily_nutrition_summaries; // a computed view, not stored
for (const rows of Object.values(tables))
  for (const r of rows) if ("user_id" in r) r.user_id = "local";
for (const r of tables.progress_photos ?? [])
  r.storage_path = r.storage_path.replace(/^[^/]+\//, "local/");
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
const files = (tables.progress_photos ?? []).map((r) => ({
  path: `progress-photos/${r.storage_path}`,
  type: "image/png",
  data: PNG,
}));
writeFileSync(
  out,
  JSON.stringify({
    app: "prime-physique",
    version: 1,
    exported_at: new Date().toISOString(),
    tables,
    files,
  }),
);
console.log(`wrote ${out}`);
