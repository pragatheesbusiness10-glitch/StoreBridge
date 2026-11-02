// Prime Physique offline end-to-end test (no mocks).
//
// Against a production build it: onboards through the UI, restores a 4-week backup through
// Settings, lets the service worker cache the app, then CUTS THE NETWORK and uses every page,
// logs new data offline, reloads offline, and checks data persisted on the device.
// It also asserts the module never contacts Supabase or any other host.
//
// Build & serve:  NITRO_PRESET=node_server npx vite build && PORT=4173 node .output/server/index.mjs
// Run:            APP_URL=http://127.0.0.1:4173 BACKUP=backup.json SHOTS=./shots node tests/e2e/offline.mjs
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const { chromium } = createRequire(import.meta.url)("playwright");
const APP = process.env.APP_URL ?? "http://127.0.0.1:4173";
const SHOTS = process.env.SHOTS ?? "./e2e-shots";
mkdirSync(SHOTS, { recursive: true });

const failures = [];
const check = (cond, msg) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}`);
  if (!cond) failures.push(msg);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  serviceWorkers: "allow",
});
const page = await ctx.newPage();
await page.clock.setFixedTime(new Date("2026-12-01T19:30:00"));
const external = [];
ctx.on("request", (r) => {
  const u = new URL(r.url());
  if (
    u.origin !== new URL(APP).origin &&
    !u.protocol.startsWith("blob") &&
    !u.protocol.startsWith("data")
  )
    external.push(r.url());
});
const errs = [];
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (
    m.type() === "error" &&
    !/ERR_INTERNET_DISCONNECTED|Failed to load resource|favicon/.test(m.text())
  )
    errs.push(`console: ${m.text()}`);
});

// ---------------------------------------------------------------- online: first run
await page.goto(APP + "/fitness", { waitUntil: "networkidle" });
check(
  page.url().endsWith("/fitness/onboarding"),
  "first visit with empty device goes to onboarding (no login)",
);
check(
  (await page.locator("#p-sw").inputValue()) === "93.25" &&
    (await page.locator("#p-tw").inputValue()) === "78",
  "onboarding pre-filled with the brief's profile",
);
await page.getByRole("button", { name: "Start my transformation" }).click();
await page.waitForURL(/\/fitness$/);
check(true, "onboarding completed on-device");

// Restore 4 weeks of realistic data from a backup file
await page.goto(APP + "/fitness/settings", { waitUntil: "networkidle" });
await page.locator('input[aria-label="Backup file"]').setInputFiles(process.env.BACKUP);
await page.getByRole("button", { name: "Replace and restore" }).click();
await page.waitForURL(/\/fitness$/);
await page.waitForTimeout(500);
check(
  /day 29 of 91/i.test(await page.locator("main").innerText()),
  "backup restored; dashboard shows programme day 29",
);

// Wait for the service worker to finish caching every app file
await page.waitForFunction(
  async () => {
    const reg = await navigator.serviceWorker.getRegistration("/fitness");
    if (!reg?.active) return false;
    const list = await (await fetch("/pp-precache.json")).json();
    const c = await caches.open("pp-assets-v1");
    return (await c.keys()).length >= list.length;
  },
  null,
  { timeout: 60000, polling: 500 },
);
check(true, "service worker active and all app files cached");

// ---------------------------------------------------------------- OFFLINE
await ctx.setOffline(true);
const PAGES = [
  "/fitness",
  "/fitness/daily",
  "/fitness/weight",
  "/fitness/nutrition",
  "/fitness/foods",
  "/fitness/planner",
  "/fitness/exercises",
  "/fitness/workouts",
  "/fitness/measurements",
  "/fitness/photos",
  "/fitness/cardio",
  "/fitness/sleep-water",
  "/fitness/analytics",
  "/fitness/settings",
];
for (const path of PAGES) {
  errs.length = 0;
  await page.goto(APP + path, { waitUntil: "load" }); // full page load with the network cut
  await page.waitForTimeout(900);
  const text = await page
    .locator("main")
    .innerText()
    .catch(() => "");
  const ok =
    !/This page didn't load|Page not found|offline and has not been cached/.test(text) &&
    text.length > 40 &&
    errs.length === 0;
  await page.screenshot({ path: `${SHOTS}/offline-${path.replace(/\//g, "_")}.png` });
  check(ok, `offline page load ${path}${errs.length ? " — " + errs.join("; ") : ""}`);
}

// Offline data entry
await page.goto(APP + "/fitness/nutrition", { waitUntil: "load" });
await page.getByRole("button", { name: "Add food" }).first().click();
await page.getByPlaceholder("Search foods…").fill("soya chunks");
await page.locator("button", { hasText: "Soya chunks" }).filter({ hasText: "Dry" }).click();
await page.locator("#qty").fill("50");
const dlg = await page.getByRole("dialog").innerText();
check(
  /173/.test(dlg) && /26 g/.test(dlg) && /DRY weight/.test(dlg),
  "offline: 50 g dry soya previews 173 kcal (172.5) / 26 g protein with dry-weight warning",
);
await page.getByRole("button", { name: "Add food", exact: true }).last().click();
await page.waitForTimeout(500);

await page.goto(APP + "/fitness/weight", { waitUntil: "load" });
await page.getByRole("button", { name: "Log weight" }).click();
await page.locator("#w-kg").fill("89.10");
await page.getByRole("button", { name: "Save" }).click();
await page.waitForTimeout(500);

await page.goto(APP + "/fitness/workouts/cccccccc-0000-0000-0000-000000000001", {
  waitUntil: "load",
});
await page.waitForTimeout(600);
await page.getByRole("button", { name: /^Set$/ }).first().click();
await page.waitForTimeout(500);

// Reload while still offline: data must come back from the device
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(800);
check(
  /Working sets\s*\n?\s*2|WORKING SETS[\s\S]{0,40}2/i.test(await page.locator("main").innerText()),
  "offline: new set persisted across reload (2 working sets)",
);
await page.goto(APP + "/fitness/weight", { waitUntil: "load" });
await page.waitForTimeout(600);
check(
  /89\.10/.test(await page.locator("main").innerText()),
  "offline: new weigh-in persisted across reload",
);
await page.goto(APP + "/fitness/nutrition", { waitUntil: "load" });
await page.waitForTimeout(600);
check(
  /Soya chunks/.test(await page.locator("main").innerText()),
  "offline: food entry persisted across reload",
);
await page.goto(APP + "/fitness/photos", { waitUntil: "load" });
await page.waitForTimeout(800);
check(
  (await page.locator("main img").count()) >= 2,
  "offline: progress photos load from on-device storage",
);

await ctx.setOffline(false);
check(
  external.length === 0,
  `no requests to any external host (saw ${external.length}${external.length ? ": " + [...new Set(external.map((u) => new URL(u).host))].join(", ") : ""})`,
);

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nALL OFFLINE CHECKS PASSED");
