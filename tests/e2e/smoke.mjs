// Prime Physique browser smoke test.
//
// Serves rows exported from a real Postgres (built by tests/e2e/seed-fixture.sql through the real
// triggers + RLS) to the app through a minimal in-memory emulation of the Supabase REST, auth and
// storage endpoints, then visits every page at desktop and phone widths and exercises the main
// entry flows. Fails on any uncaught page error or console error.
//
// Usage: APP_URL=http://localhost:5173 FIXTURES=/path/fixtures.json SHOTS=/path/dir node tests/e2e/smoke.mjs
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const SHOTS = process.env.SHOTS ?? "./e2e-shots";
const db = JSON.parse(readFileSync(process.env.FIXTURES, "utf8"));
const env = readFileSync(new URL("../../.env", import.meta.url), "utf8");
const SUPA = /VITE_SUPABASE_URL="?([^"\n]+)/.exec(env)[1].replace(/\/$/, "");
const REF = new URL(SUPA).hostname.split(".")[0];
const USER = { id: "aaaaaaaa-0000-0000-0000-000000000001", email: "athlete@example.com", aud: "authenticated", role: "authenticated" };
mkdirSync(SHOTS, { recursive: true });
// Playwright is pre-installed globally in CI images; resolve it via require so no project dependency is needed.
const { chromium } = createRequire(import.meta.url)("playwright");

// --------------------------------------------------------------------- PostgREST emulation
const REL = {
  workout_sessions: { workout_exercises: { many: true, fk: "session_id" } },
  workout_exercises: { workout_sets: { many: true, fk: "workout_exercise_id" }, workout_sessions: { one: true, fk: "session_id" } },
  workout_plan_exercises: { exercise_library: { one: true, fk: "exercise_id" } },
};
function parseSelect(sel) {
  // returns list of embeds: {name, inner, sub}
  const embeds = [];
  let depth = 0, start = 0, name = "";
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === "(") {
      if (depth === 0) { name = sel.slice(start, i).split(",").pop().trim(); start = i + 1; }
      depth++;
    } else if (c === ")") {
      depth--;
      if (depth === 0) { const [n, mod] = name.split("!"); embeds.push({ name: n, inner: mod === "inner", sub: sel.slice(start, i) }); start = i + 1; }
    } else if (c === "," && depth === 0) start = i + 1;
  }
  return embeds;
}
function embed(table, row, sel) {
  const out = { ...row };
  for (const e of parseSelect(sel)) {
    const rel = REL[table]?.[e.name];
    if (!rel) continue;
    if (rel.many) out[e.name] = db[e.name].filter((c) => c[rel.fk] === row.id).map((c) => embed(e.name, c, e.sub));
    else out[e.name] = (() => { const p = db[e.name].find((x) => x.id === row[rel.fk]); return p ? embed(e.name, p, e.sub) : null; })();
  }
  return out;
}
const cmp = (a, b) => (a === b ? 0 : a === null || a === undefined ? 1 : b === null || b === undefined ? -1 : a < b ? -1 : 1);
function test(v, op, raw) {
  const val = raw === "null" ? null : raw;
  const n = (x) => (typeof v === "number" ? Number(x) : x);
  switch (op) {
    case "eq": return val === "true" ? v === true : val === "false" ? v === false : String(v) === String(val);
    case "neq": return String(v) !== String(val);
    case "gte": return v !== null && v >= n(val);
    case "lte": return v !== null && v <= n(val);
    case "lt": return v !== null && v < n(val);
    case "gt": return v !== null && v > n(val);
    case "in": return raw.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/"/g, "")).includes(String(v));
    case "is": return val === null ? v === null : String(v) === val;
    default: throw new Error("op " + op);
  }
}
function applyFilters(table, rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (["select", "order", "limit", "on_conflict", "columns", "offset"].includes(k)) continue;
    const m = /^(\w+)\.(.*)$/.exec(v);
    if (!m) continue;
    const [, op, raw] = m;
    if (k.includes(".")) {
      const [emb, col] = k.split(".");
      out = out.filter((r) => r[emb] && test(r[emb][col], op, raw));
    } else out = out.filter((r) => test(r[k], op, raw));
  }
  return out;
}
function order(rows, spec) {
  if (!spec) return rows;
  const parts = spec.split(",").map((p) => p.split("."));
  return [...rows].sort((a, b) => {
    for (const [c, dir] of parts) {
      const r = cmp(a[c], b[c]);
      if (r) return dir === "desc" ? -r : r;
    }
    return 0;
  });
}
function rest(method, table, url, body, headers) {
  const params = [...url.searchParams.entries()];
  const sel = url.searchParams.get("select") ?? "*";
  if (!db[table]) db[table] = [];
  if (method === "GET" || method === "HEAD") {
    let rows = db[table].map((r) => embed(table, r, sel));
    const inner = parseSelect(sel).filter((e) => e.inner).map((e) => e.name);
    rows = rows.filter((r) => inner.every((n) => r[n]));
    rows = order(applyFilters(table, rows, params), url.searchParams.get("order"));
    const lim = url.searchParams.get("limit");
    if (lim) rows = rows.slice(0, Number(lim));
    return single(rows, headers);
  }
  if (method === "POST") {
    const list = (Array.isArray(body) ? body : [body]).map((r) => ({ id: randomUUID(), user_id: USER.id, created_at: new Date().toISOString(), ...r }));
    const conflict = url.searchParams.get("on_conflict")?.split(",");
    const result = [];
    for (const r of list) {
      const ex = conflict ? db[table].find((x) => conflict.every((c) => String(x[c]) === String(r[c]))) : null;
      if (ex) { Object.assign(ex, r, { id: ex.id }); result.push(ex); } else { db[table].push(r); result.push(r); }
    }
    return single(result.map((r) => embed(table, r, sel)), headers, 201);
  }
  if (method === "PATCH") {
    const rows = applyFilters(table, db[table], params);
    rows.forEach((r) => Object.assign(r, body));
    return single(rows, headers);
  }
  if (method === "DELETE") {
    const rows = applyFilters(table, db[table], params);
    db[table] = db[table].filter((r) => !rows.includes(r));
    // cascade the relations the UI relies on
    if (table === "workout_sessions") db.workout_exercises = db.workout_exercises.filter((e) => !rows.some((r) => r.id === e.session_id));
    return single(rows, headers);
  }
  throw new Error("method " + method);
}
function single(rows, headers, status = 200) {
  if ((headers.accept ?? "").includes("vnd.pgrst.object")) {
    if (rows.length !== 1) return { status: 406, json: { code: "PGRST116", details: `The result contains ${rows.length} rows`, hint: null, message: "JSON object requested, multiple (or no) rows returned" } };
    return { status, json: rows[0] };
  }
  return { status, json: rows };
}

const RPC = {
  pp_seed_defaults: () => ({ foods: 0, exercises: 0, plans: 0 }),
  pp_recalculate_food_entries: () => 0,
  pp_recompute_recipe: (b) => db.food_items.find((f) => f.id === b._recipe_id),
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", "base64");

async function route(r) {
  const req = r.request();
  const url = new URL(req.url());
  const p = url.pathname;
  let body = null;
  try { body = req.postDataJSON(); } catch { /* not json */ }
  const reply = (status, json) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(json), headers: { "access-control-allow-origin": "*" } });
  if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (p.startsWith("/auth/v1/user")) return reply(200, USER);
  if (p.startsWith("/auth/v1/")) return reply(200, {});
  if (p.startsWith("/rest/v1/rpc/")) { const fn = p.split("/").pop(); return reply(200, RPC[fn]?.(body) ?? null); }
  if (p.startsWith("/rest/v1/")) { const res = rest(req.method(), p.split("/")[3], url, body, req.headers()); return reply(res.status, res.json); }
  if (p.startsWith("/storage/v1/object/sign/")) {
    const paths = body?.paths ?? [];
    return reply(200, paths.map((x) => ({ path: x, signedURL: `/object/sign/progress-photos/${x}?token=t`, error: null })));
  }
  if (p.startsWith("/storage/v1/")) return r.fulfill({ status: 200, contentType: "image/png", body: PNG });
  return reply(404, { message: "unmocked " + p });
}

// --------------------------------------------------------------------- run
const PAGES = ["/fitness", "/fitness/daily", "/fitness/weight", "/fitness/nutrition", "/fitness/foods", "/fitness/foods?tab=recipes", "/fitness/foods?tab=templates",
  "/fitness/planner", "/fitness/exercises", "/fitness/workouts", "/fitness/workouts/cccccccc-0000-0000-0000-000000000001", "/fitness/measurements",
  "/fitness/photos", "/fitness/cardio", "/fitness/sleep-water", "/fitness/analytics", "/fitness/settings", "/fitness/onboarding"];

const failures = [];
const browser = await chromium.launch();
for (const vp of [{ name: "desktop", width: 1366, height: 900 }, { name: "mobile", width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
  await ctx.route(`${SUPA}/**`, route);
  await ctx.addInitScript(({ ref, user }) => {
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({ access_token: "test", refresh_token: "test", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 * 24 * 365, user }));
  }, { ref: REF, user: USER });
  const page = await ctx.newPage();
  // Fixed "now" (1 Dec 2026, programme day 29) without freezing timers/animation frames.
  await page.clock.setFixedTime(new Date("2026-12-01T19:30:00"));
  const errs = [];
  page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Download the React DevTools|favicon/.test(m.text())) errs.push(`console: ${m.text()}`); });
  for (const path of PAGES) {
    errs.length = 0;
    await page.goto(APP + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const name = `${vp.name}-${path.replace(/[/?=]/g, "_").replace(/^_/, "") || "root"}`.slice(0, 80);
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: vp.name === "desktop" });
    const text = await page.locator("main").innerText().catch(() => "");
    if (/This page didn't load|Page not found/.test(text)) errs.push("error boundary rendered");
    if (vp.name === "mobile" && overflow > 4) errs.push(`horizontal page overflow ${overflow}px`);
    console.log(`${errs.length ? "FAIL" : "ok  "} ${vp.name} ${path}${errs.length ? "\n   " + errs.join("\n   ") : ""}`);
    if (errs.length) failures.push({ vp: vp.name, path, errs: [...errs] });
  }

  if (vp.name === "desktop") {
    // ---- interaction checks
    const check = (cond, msg) => { console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) failures.push({ path: "interaction", errs: [msg] }); };
    await page.goto(APP + "/fitness", { waitUntil: "networkidle" });
    const dash = await page.locator("main").innerText();
    check(/day 29 of 91/i.test(dash), "dashboard shows programme day 29 of 91 on 1 Dec");
    check(/93\.25/.test(dash) && /78/.test(dash), "dashboard shows start and target weight");
    check(/Unknown|BIA/.test(dash), "body fat shows its method (never presented as generic)");

    // Food logging: chicken breast raw 250 g → 300 kcal preview
    await page.goto(APP + "/fitness/nutrition", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Add food" }).first().click();
    await page.getByPlaceholder("Search foods…").fill("chicken breast");
    await page.getByLabel("Show foods outside my diet").check();
    await page.locator("button", { hasText: "Chicken breast, skinless" }).filter({ hasText: "Raw" }).click();
    await page.locator("#qty").fill("250");
    const dlg = await page.getByRole("dialog").innerText();
    check(/300\s*\n?\s*/.test(dlg) && /56\.3/.test(dlg) && /RAW weight/.test(dlg), "food preview: 250 g raw chicken = 300 kcal, 56.3 g protein, raw-weight warning");
    check(/Outside your meal plan/.test(dlg), "chicken flagged as outside the vegetarian meal plan but still trackable");
    await page.getByRole("button", { name: "Add food", exact: true }).last().click();
    await page.waitForTimeout(500);
    check(db.food_entries.some((e) => e.grams === 250 && e.food_state === "raw" && e.kcal === 300), "food entry saved with grams, state and computed nutrients");

    // Oil double counting warning: soya chunk template dinner has mustard oil; add olive oil to a meal containing a recipe with oil
    // Weight logging
    await page.goto(APP + "/fitness/weight", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Log weight" }).click();
    await page.locator("#w-date").fill("2026-11-03");
    await page.waitForTimeout(300);
    const wv = await page.locator("#w-kg").inputValue();
    check(wv !== "", "weight dialog loads the existing weigh-in for the chosen date (edit, no duplicate)");
    await page.keyboard.press("Escape");

    // Set logging on the in-progress session
    await page.goto(APP + "/fitness/workouts/cccccccc-0000-0000-0000-000000000001", { waitUntil: "networkidle" });
    const before = db.workout_sets.length;
    await page.getByRole("button", { name: /^Set$/ }).first().click();
    await page.waitForTimeout(400);
    const added = db.workout_sets[db.workout_sets.length - 1];
    check(db.workout_sets.length === before + 1 && added.set_number === 2 && Number(added.weight_kg) === 45 && added.reps === 10, "new set stored individually with set_number 2 (pre-filled from previous set of this session)");
    const sessionText = await page.locator("main").innerText();
    check(/Reference only/.test(sessionText), "previous performance shown as reference, not prescription");

    // Analytics CSV export
    await page.goto(APP + "/fitness/analytics", { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "Daily" }).click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "CSV" }).first().click()]);
    const csvPath = `${SHOTS}/daily.csv`;
    await dl.saveAs(csvPath);
    const csv = readFileSync(csvPath, "utf8");
    check(/date,weight_kg,weight_7day_avg_kg,calories_kcal/.test(csv) && csv.split("\n").length > 80, "daily CSV export has headers and one row per day");
    await page.getByRole("tab", { name: "Milestones" }).click();
    const ms = await page.locator("main").innerText();
    check(/92\.08 kg/.test(ms) && /78\.00 kg/.test(ms) && /not a required rate or a guarantee/.test(ms), "milestones table matches projection and carries the safety note");
  }
  await ctx.close();
}
await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nALL SMOKE CHECKS PASSED");
