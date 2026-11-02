/**
 * Prime Physique offline database.
 *
 * A small, dependency-free relational store that runs entirely on the device and persists to
 * IndexedDB. It exposes the subset of the Supabase/PostgREST query-builder API the app uses
 * (`from().select().eq()…`, `insert`, `update`, `upsert`, `delete`, `rpc`, `storage`), and
 * re-implements the server rules from supabase/migrations/*prime_physique*.sql:
 *
 *  - column defaults, generated ids and timestamps (local-schema.json is generated from the SQL schema)
 *  - food entry nutrition trigger: nutrient = grams / 100 × the food's stored per-100 g value
 *  - sleep duration (generated column), updated_at
 *  - unique-per-day rules and other unique keys, required parent rows
 *  - foreign-key cascades / set-null on delete
 *  - the daily_nutrition_summaries view
 *  - RPCs pp_seed_defaults, pp_recompute_recipe, pp_recalculate_food_entries
 *  - private photo storage (blobs never leave the device)
 */
import SCHEMA from "./local-schema.json";
import SEED from "./seed-data.json";

export type Row = Record<string, unknown>;
export type DbError = { message: string; code?: string; details?: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Result<T = any> = { data: T; error: DbError | null; count?: number | null };

export const LOCAL_USER_ID = "local";
const VIEW = "daily_nutrition_summaries";
const TABLES = Object.keys(SCHEMA) as string[];
const PK: Record<string, string> = { fitness_profiles: "user_id" };
const pkOf = (t: string) => PK[t] ?? "id";

// Unique keys (besides the primary key). Values compared case-insensitively where noted.
const UNIQUE: Record<
  string,
  { cols: string[]; ci?: string[]; where?: (r: Row) => boolean; msg: string }[]
> = {
  daily_weight_logs: [{ cols: ["log_date"], msg: "There is already a weigh-in for this date" }],
  daily_body_measurements: [
    { cols: ["measured_on"], msg: "Measurements already exist for this date — edit them instead" },
  ],
  step_logs: [{ cols: ["log_date"], msg: "Steps already logged for this date" }],
  sleep_logs: [{ cols: ["sleep_date"], msg: "Sleep is already logged for this night" }],
  daily_notes: [{ cols: ["note_date"], msg: "A note already exists for this date" }],
  achievements: [{ cols: ["code"], msg: "Achievement already recorded" }],
  nutrition_targets: [
    { cols: ["effective_from"], msg: "A target period already starts on this date" },
  ],
  progress_photos: [{ cols: ["storage_path"], msg: "Photo already recorded" }],
  transformation_programs: [
    {
      cols: ["is_active"],
      where: (r) => r.is_active === true,
      msg: "Only one active programme is allowed",
    },
  ],
  food_items: [
    {
      cols: ["name", "state"],
      ci: ["name"],
      where: (r) => !r.archived,
      msg: "A food with this name and state already exists",
    },
  ],
  exercise_library: [
    { cols: ["name"], ci: ["name"], msg: "An exercise with this name already exists" },
  ],
};

// Foreign keys: child table/column → parent table, and what happens when the parent is deleted.
const FK: {
  child: string;
  col: string;
  parent: string;
  onDelete: "cascade" | "set null" | "restrict";
}[] = [
  { child: "recipe_ingredients", col: "recipe_id", parent: "food_items", onDelete: "cascade" },
  { child: "recipe_ingredients", col: "ingredient_id", parent: "food_items", onDelete: "restrict" },
  { child: "food_entries", col: "food_item_id", parent: "food_items", onDelete: "set null" },
  {
    child: "meal_template_items",
    col: "template_id",
    parent: "meal_templates",
    onDelete: "cascade",
  },
  { child: "meal_template_items", col: "food_item_id", parent: "food_items", onDelete: "cascade" },
  { child: "workout_plan_exercises", col: "plan_id", parent: "workout_plans", onDelete: "cascade" },
  {
    child: "workout_plan_exercises",
    col: "exercise_id",
    parent: "exercise_library",
    onDelete: "cascade",
  },
  { child: "workout_sessions", col: "plan_id", parent: "workout_plans", onDelete: "set null" },
  {
    child: "workout_exercises",
    col: "session_id",
    parent: "workout_sessions",
    onDelete: "cascade",
  },
  {
    child: "workout_exercises",
    col: "exercise_id",
    parent: "exercise_library",
    onDelete: "set null",
  },
  {
    child: "workout_exercises",
    col: "plan_exercise_id",
    parent: "workout_plan_exercises",
    onDelete: "set null",
  },
  {
    child: "workout_sets",
    col: "workout_exercise_id",
    parent: "workout_exercises",
    onDelete: "cascade",
  },
];
// Embeddable relations for select("*, child(*)") / select("*, parent!inner(*)")
const REL: Record<string, Record<string, { many?: boolean; fk: string }>> = {
  workout_sessions: { workout_exercises: { many: true, fk: "session_id" } },
  workout_exercises: {
    workout_sets: { many: true, fk: "workout_exercise_id" },
    workout_sessions: { fk: "session_id" },
  },
  workout_plan_exercises: { exercise_library: { fk: "exercise_id" } },
};

class DbFailure extends Error {
  constructor(
    message: string,
    public code = "P0001",
  ) {
    super(message);
  }
}

// ======================================================================= persistence

export interface Persistence {
  loadAll(): Promise<{ tables: Record<string, Row[]>; files: Map<string, Blob> }>;
  saveTable(name: string, rows: Row[]): Promise<void>;
  saveFile(path: string, blob: Blob): Promise<void>;
  deleteFile(path: string): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryPersistence implements Persistence {
  tables: Record<string, Row[]> = {};
  files = new Map<string, Blob>();
  async loadAll() {
    return { tables: structuredClone(this.tables), files: new Map(this.files) };
  }
  async saveTable(name: string, rows: Row[]) {
    this.tables[name] = structuredClone(rows);
  }
  async saveFile(path: string, blob: Blob) {
    this.files.set(path, blob);
  }
  async deleteFile(path: string) {
    this.files.delete(path);
  }
  async clear() {
    this.tables = {};
    this.files.clear();
  }
}

const IDB_NAME = "prime-physique";
function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("tables")) d.createObjectStore("tables");
      if (!d.objectStoreNames.contains("files")) d.createObjectStore("files");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbTx<T>(
  d: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const r = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(r ? r.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}
async function idbAll(d: IDBDatabase, store: string): Promise<[string, unknown][]> {
  return new Promise((resolve, reject) => {
    const out: [string, unknown][] = [];
    const req = d.transaction(store, "readonly").objectStore(store).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(out);
      out.push([String(c.key), c.value]);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export class IndexedDbPersistence implements Persistence {
  private dbp: Promise<IDBDatabase> | null = null;
  private get d() {
    return (this.dbp ??= idbOpen());
  }
  async loadAll() {
    const d = await this.d;
    const tables = Object.fromEntries((await idbAll(d, "tables")) as [string, Row[]][]);
    const files = new Map((await idbAll(d, "files")) as [string, Blob][]);
    return { tables, files };
  }
  async saveTable(name: string, rows: Row[]) {
    await idbTx(await this.d, "tables", "readwrite", (s) => s.put(rows, name));
  }
  async saveFile(path: string, blob: Blob) {
    await idbTx(await this.d, "files", "readwrite", (s) => s.put(blob, path));
  }
  async deleteFile(path: string) {
    await idbTx(await this.d, "files", "readwrite", (s) => s.delete(path));
  }
  async clear() {
    const d = await this.d;
    await idbTx(d, "tables", "readwrite", (s) => s.clear());
    await idbTx(d, "files", "readwrite", (s) => s.clear());
  }
}

// ======================================================================= helpers

const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
const nowIso = () => new Date().toISOString();
const round = (n: number, dp: number) => Math.round((n + Number.EPSILON) * 10 ** dp) / 10 ** dp;
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1; // nulls last (PostgreSQL default for ASC)
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}
function same(a: unknown, b: unknown) {
  if (a === null || a === undefined || b === null || b === undefined) return a == b;
  return typeof a === "number" || typeof b === "number"
    ? Number(a) === Number(b)
    : String(a) === String(b);
}

type Filter = {
  col: string;
  op: "eq" | "neq" | "gte" | "lte" | "lt" | "gt" | "in" | "is";
  value: unknown;
};
function matches(row: Row, f: Filter): boolean {
  let v: unknown;
  if (f.col.includes(".")) {
    const [emb, col] = f.col.split(".");
    const e = row[emb] as Row | null | undefined;
    if (!e) return false;
    v = e[col];
  } else v = row[f.col];
  switch (f.op) {
    case "eq":
    case "is":
      return same(v, f.value);
    case "neq":
      return !same(v, f.value);
    case "gte":
      return v !== null && v !== undefined && cmp(v, f.value) >= 0;
    case "lte":
      return v !== null && v !== undefined && cmp(v, f.value) <= 0;
    case "lt":
      return v !== null && v !== undefined && cmp(v, f.value) < 0;
    case "gt":
      return v !== null && v !== undefined && cmp(v, f.value) > 0;
    case "in":
      return (f.value as unknown[]).some((x) => same(v, x));
  }
}

function parseEmbeds(sel: string): { name: string; inner: boolean; sub: string }[] {
  const out: { name: string; inner: boolean; sub: string }[] = [];
  let depth = 0;
  let start = 0;
  let name = "";
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === "(") {
      if (depth === 0) {
        name = sel.slice(start, i).split(",").pop()!.trim();
        start = i + 1;
      }
      depth++;
    } else if (c === ")") {
      depth--;
      if (depth === 0) {
        const [n, mod] = name.split("!");
        out.push({ name: n, inner: mod === "inner", sub: sel.slice(start, i) });
        start = i + 1;
      }
    } else if (c === "," && depth === 0) start = i + 1;
  }
  return out;
}

// ======================================================================= engine

export class LocalDb {
  private tables: Record<string, Row[]> = {};
  private files = new Map<string, Blob>();
  private ready: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();

  constructor(private persistence: Persistence) {}

  private init() {
    return (this.ready ??= (async () => {
      const { tables, files } = await this.persistence.loadAll();
      for (const t of TABLES) this.tables[t] = (tables[t] as Row[] | undefined) ?? [];
      this.files = files;
    })());
  }

  /** Serialise all operations so reads see completed writes and persistence happens in order. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(async () => {
      await this.init();
      return fn();
    });
    this.queue = p.catch(() => undefined);
    return p;
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private t(name: string): Row[] {
    if (name !== VIEW && !(name in SCHEMA)) throw new DbFailure(`Unknown table ${name}`, "42P01");
    return (this.tables[name] ??= []);
  }

  private async persist(names: Iterable<string>) {
    for (const n of new Set(names)) await this.persistence.saveTable(n, this.tables[n]);
    this.listeners.forEach((l) => l());
  }

  // ------------------------------------------------------------------ rules

  private withDefaults(table: string, input: Row): Row {
    const cols = (SCHEMA as Record<string, Record<string, unknown>>)[table];
    const row: Row = {};
    for (const [c, d] of Object.entries(cols)) {
      if (input[c] !== undefined) row[c] = input[c];
      else if (d && typeof d === "object" && !Array.isArray(d) && "$fn" in d) {
        const fn = (d as { $fn: string }).$fn;
        row[c] = fn === "uid" ? LOCAL_USER_ID : fn === "now" ? nowIso() : uuid();
      } else row[c] = Array.isArray(d) ? [...d] : (d ?? null);
    }
    // ignore unknown columns (e.g. client-side helpers), keep only schema columns
    return row;
  }

  private beforeWrite(table: string, row: Row, old: Row | null) {
    if (table === "food_entries") this.foodEntryTrigger(row, old);
    if (table === "sleep_logs") {
      const mins = Math.round(
        (Date.parse(String(row.wake_time)) - Date.parse(String(row.bedtime))) / 60000,
      );
      if (!(mins > 0) || mins > 20 * 60)
        throw new DbFailure("Wake-up time must be after bedtime and within 20 hours", "23514");
      row.duration_minutes = mins;
    }
    if (table === "daily_body_measurements") {
      const keys = [
        "waist_cm",
        "chest_cm",
        "neck_cm",
        "left_arm_cm",
        "right_arm_cm",
        "left_thigh_cm",
        "right_thigh_cm",
        "hips_cm",
        "calf_cm",
        "body_fat_pct",
        "skinfold_chest_mm",
        "skinfold_abdomen_mm",
        "skinfold_thigh_mm",
        "skinfold_triceps_mm",
        "skinfold_suprailiac_mm",
      ];
      if (keys.every((k) => row[k] === null || row[k] === undefined))
        throw new DbFailure("Enter at least one measurement", "23514");
      if (row.body_fat_pct !== null && !row.body_fat_method)
        throw new DbFailure("Body fat needs a method", "23514");
    }
    if (table === "workout_sets" && row.reps === null && row.duration_seconds === null)
      throw new DbFailure("A set needs reps or a duration", "23514");
    if (old && "updated_at" in row) row.updated_at = nowIso();
    // parent rows must exist
    for (const fk of FK.filter((f) => f.child === table)) {
      const v = row[fk.col];
      if (v !== null && v !== undefined && !this.t(fk.parent).some((p) => same(p.id, v))) {
        throw new DbFailure(`Referenced ${fk.parent.replace(/_/g, " ")} not found`, "23503");
      }
    }
    // unique keys
    const pk = pkOf(table);
    for (const u of UNIQUE[table] ?? []) {
      if (u.where && !u.where(row)) continue;
      const norm = (r: Row, c: string) =>
        u.ci?.includes(c)
          ? String(r[c] ?? "")
              .trim()
              .toLowerCase()
          : r[c];
      const clash = this.t(table).find(
        (r) =>
          r !== old &&
          !same(r[pk], row[pk]) &&
          (!u.where || u.where(r)) &&
          u.cols.every((c) => same(norm(r, c), norm(row, c))),
      );
      if (clash) throw new DbFailure(u.msg, "23505");
    }
  }

  /** Port of pp_food_entry_compute(). */
  private foodEntryTrigger(row: Row, old: Row | null) {
    if (row.nutrition_source !== "food_database") return;
    if (!row.food_item_id) {
      if (!old)
        throw new DbFailure("food_item_id is required when nutrition_source = food_database");
      return;
    }
    const changed =
      !old ||
      !same(row.grams, old.grams) ||
      !same(row.food_item_id, old.food_item_id) ||
      !same(row.nutrition_source, old.nutrition_source);
    if (!changed) return;
    const f = this.t("food_items").find((x) => same(x.id, row.food_item_id));
    if (!f) throw new DbFailure("Food item not found");
    this.applyFood(row, f);
  }

  private applyFood(row: Row, f: Row) {
    const g = Number(row.grams);
    row.food_name = f.name;
    row.food_category = f.category;
    row.food_state = f.state;
    row.tracking_tag = f.tracking_tag;
    row.unit_weight_g = f.unit_weight_g;
    row.kcal = round((g / 100) * Number(f.kcal_per_100g), 1);
    row.protein_g = round((g / 100) * Number(f.protein_per_100g), 2);
    row.carbs_g = round((g / 100) * Number(f.carbs_per_100g), 2);
    row.fat_g = round((g / 100) * Number(f.fat_per_100g), 2);
    row.fibre_g = f.fibre_per_100g === null ? null : round((g / 100) * Number(f.fibre_per_100g), 2);
    row.source_note = f.source;
  }

  /** Delete rows and apply FK actions recursively. Returns touched table names. */
  private deleteRows(table: string, victims: Row[], touched: Set<string>) {
    if (!victims.length) return;
    const ids = new Set(victims.map((v) => v.id));
    for (const fk of FK.filter((f) => f.parent === table)) {
      const kids = this.t(fk.child).filter((c) => c[fk.col] !== null && ids.has(c[fk.col]));
      if (!kids.length) continue;
      if (fk.onDelete === "restrict")
        throw new DbFailure(`Cannot delete: still used by ${fk.child.replace(/_/g, " ")}`, "23503");
      if (fk.onDelete === "set null") {
        kids.forEach((k) => (k[fk.col] = null));
        touched.add(fk.child);
      } else this.deleteRows(fk.child, kids, touched);
    }
    this.tables[table] = this.t(table).filter((r) => !victims.includes(r));
    touched.add(table);
  }

  // ------------------------------------------------------------------ view

  private nutritionSummaries(): Row[] {
    const by = new Map<string, Row[]>();
    for (const e of this.t("food_entries"))
      by.set(String(e.entry_date), [...(by.get(String(e.entry_date)) ?? []), e]);
    const s = (rows: Row[], k: string) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    const tag = (rows: Row[], t: string) =>
      round(
        s(
          rows.filter((r) => r.tracking_tag === t),
          "grams",
        ),
        1,
      );
    return [...by.entries()].map(([date, rows]) => {
      const eggs = rows.filter((r) => r.tracking_tag === "whole_egg");
      const eggCount = eggs.reduce(
        (a, r) =>
          a +
          (r.quantity_unit === "piece"
            ? Number(r.quantity)
            : Number(r.unit_weight_g) > 0
              ? Number(r.grams) / Number(r.unit_weight_g)
              : 0),
        0,
      );
      const withFibre = rows.filter((r) => r.fibre_g !== null);
      return {
        user_id: LOCAL_USER_ID,
        entry_date: date,
        entry_count: rows.length,
        kcal: round(s(rows, "kcal"), 1),
        protein_g: round(s(rows, "protein_g"), 1),
        carbs_g: round(s(rows, "carbs_g"), 1),
        fat_g: round(s(rows, "fat_g"), 1),
        fibre_g: withFibre.length ? round(s(withFibre, "fibre_g"), 1) : null,
        entries_missing_fibre: rows.length - withFibre.length,
        total_food_g: round(s(rows, "grams"), 1),
        chicken_g: tag(rows, "chicken"),
        whole_egg_g: tag(rows, "whole_egg"),
        whole_egg_count: round(eggCount, 1),
        egg_white_g: tag(rows, "egg_white"),
        tofu_g: tag(rows, "tofu"),
        soya_g: tag(rows, "soya"),
        protein_powder_g: tag(rows, "protein_powder"),
      };
    });
  }

  private embed(table: string, row: Row, sel: string): Row {
    const out: Row = { ...row };
    for (const e of parseEmbeds(sel)) {
      const rel = REL[table]?.[e.name];
      if (!rel) continue;
      if (rel.many)
        out[e.name] = this.t(e.name)
          .filter((c) => same(c[rel.fk], row.id))
          .map((c) => this.embed(e.name, c, e.sub));
      else {
        const p = this.t(e.name).find((x) => same(x.id, row[rel.fk]));
        out[e.name] = p ? this.embed(e.name, p, e.sub) : null;
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ operations used by the builder

  async exec(q: QueryState): Promise<Result> {
    try {
      const data = await this.run(() => this.execInner(q));
      return { data, error: null } as Result;
    } catch (e) {
      const err = e as { message?: string; code?: string };
      return { data: null, error: { message: err.message ?? String(e), code: err.code } } as Result;
    }
  }

  private async execInner(q: QueryState): Promise<unknown> {
    const sel = q.select ?? "*";
    const read = (rows: Row[]) => {
      let out = rows.map((r) => this.embed(q.table, r, sel));
      const inner = parseEmbeds(sel)
        .filter((e) => e.inner)
        .map((e) => e.name);
      out = out.filter((r) => inner.every((n) => r[n]));
      out = out.filter((r) => q.filters.every((f) => matches(r, f)));
      for (const o of [...q.orders].reverse())
        out.sort((a, b) => (o.ascending ? 1 : -1) * cmp(a[o.col], b[o.col]));
      if (q.limit !== null) out = out.slice(0, q.limit);
      return structuredClone(out);
    };
    const finish = (rows: Row[]) => {
      if (q.single === "single") {
        if (rows.length !== 1)
          throw new DbFailure(`Expected one row, found ${rows.length}`, "PGRST116");
        return rows[0];
      }
      if (q.single === "maybe") {
        if (rows.length > 1)
          throw new DbFailure(`Expected at most one row, found ${rows.length}`, "PGRST116");
        return rows[0] ?? null;
      }
      return rows;
    };

    if (q.op === "select") {
      const src = q.table === VIEW ? this.nutritionSummaries() : this.t(q.table);
      return finish(read(src));
    }
    if (q.table === VIEW) throw new DbFailure("View is read-only");
    const table = this.t(q.table);
    const touched = new Set<string>([q.table]);
    const snapshot = structuredClone(this.tables);
    try {
      let result: Row[] = [];
      if (q.op === "insert" || q.op === "upsert") {
        const list = Array.isArray(q.payload) ? q.payload : [q.payload as Row];
        const conflict =
          q.onConflict?.split(",").map((c) => c.trim()) ??
          (q.op === "upsert" ? [pkOf(q.table)] : null);
        for (const input of list) {
          const candidate = this.withDefaults(q.table, input);
          const existing =
            q.op === "upsert" && conflict
              ? table.find((r) => conflict.every((c) => same(r[c], candidate[c])))
              : undefined;
          if (existing) {
            const next = {
              ...existing,
              ...Object.fromEntries(Object.entries(input).filter(([k]) => k in existing)),
            };
            next[pkOf(q.table)] = existing[pkOf(q.table)];
            this.beforeWrite(q.table, next, existing);
            Object.assign(existing, next);
            result.push(existing);
          } else {
            this.beforeWrite(q.table, candidate, null);
            table.push(candidate);
            result.push(candidate);
          }
        }
      } else if (q.op === "update") {
        const targets = table.filter((r) => q.filters.every((f) => matches(r, f)));
        for (const r of targets) {
          const next = {
            ...r,
            ...Object.fromEntries(Object.entries(q.payload as Row).filter(([k]) => k in r)),
          };
          this.beforeWrite(q.table, next, r);
          Object.assign(r, next);
        }
        result = targets;
      } else if (q.op === "delete") {
        result = table.filter((r) => q.filters.every((f) => matches(r, f)));
        this.deleteRows(q.table, result, touched);
      }
      await this.persist(touched);
      return finish(
        q.select !== null ? structuredClone(result.map((r) => this.embed(q.table, r, sel))) : [],
      );
    } catch (e) {
      this.tables = snapshot; // all-or-nothing, like a transaction
      throw e;
    }
  }

  // ------------------------------------------------------------------ RPCs

  async rpc(name: string, args: Row = {}): Promise<Result> {
    try {
      const data = await this.run(async () => {
        if (name === "pp_seed_defaults") return this.seedDefaults();
        if (name === "pp_recompute_recipe") return this.recomputeRecipe(String(args._recipe_id));
        if (name === "pp_recalculate_food_entries")
          return this.recalculate(
            String(args._food_item_id),
            (args._from as string | null) ?? null,
          );
        throw new DbFailure(`Unknown function ${name}`, "42883");
      });
      return { data, error: null };
    } catch (e) {
      return {
        data: null,
        error: { message: (e as Error).message, code: (e as DbFailure).code },
      } as Result;
    }
  }

  /** Port of pp_seed_defaults(): copies default data into this device's database, idempotently. */
  private async seedDefaults() {
    const seed = SEED as Record<string, Row[]>;
    const touched = new Set<string>();
    const counts = { foods: 0, exercises: 0, plans: 0 };
    const add = (t: string, rows: Row[]) => {
      for (const r of rows)
        this.t(t).push(this.withDefaults(t, { ...structuredClone(r), user_id: LOCAL_USER_ID }));
      touched.add(t);
      return rows.length;
    };
    if (!this.t("food_items").some((f) => !f.is_custom))
      counts.foods = add("food_items", seed.food_items);
    if (!this.t("exercise_library").some((f) => !f.is_custom))
      counts.exercises = add("exercise_library", seed.exercise_library);
    if (!this.t("workout_plans").length) {
      counts.plans = add("workout_plans", seed.workout_plans);
      const exIds = new Set(this.t("exercise_library").map((e) => e.id));
      add(
        "workout_plan_exercises",
        seed.workout_plan_exercises.filter((p) => exIds.has(p.exercise_id)),
      );
    }
    if (!this.t("meal_templates").length) {
      add("meal_templates", seed.meal_templates);
      const foodIds = new Set(this.t("food_items").map((e) => e.id));
      add(
        "meal_template_items",
        seed.meal_template_items.filter((p) => foodIds.has(p.food_item_id)),
      );
    }
    if (!this.t("nutrition_targets").length) {
      const prog = this.t("transformation_programs").find((p) => p.is_active);
      add(
        "nutrition_targets",
        seed.nutrition_targets.map((t) => ({
          ...t,
          effective_from: prog?.start_date ?? todayLocal(),
        })),
      );
    }
    await this.persist(touched);
    return counts;
  }

  /** Port of pp_recompute_recipe(): per-100 g values of the finished dish. */
  private async recomputeRecipe(id: string) {
    const r = this.t("food_items").find((f) => same(f.id, id) && f.is_recipe);
    if (!r) throw new DbFailure("Recipe not found");
    const ings = this.t("recipe_ingredients")
      .filter((i) => same(i.recipe_id, id))
      .map((i) => ({ i, f: this.t("food_items").find((f) => same(f.id, i.ingredient_id))! }))
      .filter((x) => x.f);
    const raw = ings.reduce((a, x) => a + Number(x.i.grams), 0);
    if (!raw) throw new DbFailure("Recipe has no ingredients");
    const tot = (k: string) =>
      ings.reduce((a, x) => a + (Number(x.i.grams) / 100) * Number(x.f[k] ?? 0), 0);
    const total = r.recipe_total_cooked_g ? Number(r.recipe_total_cooked_g) : raw;
    r.kcal_per_100g = round((tot("kcal_per_100g") / total) * 100, 1);
    r.protein_per_100g = round((tot("protein_per_100g") / total) * 100, 2);
    r.carbs_per_100g = round((tot("carbs_per_100g") / total) * 100, 2);
    r.fat_per_100g = round((tot("fat_per_100g") / total) * 100, 2);
    r.fibre_per_100g = ings.some((x) => x.f.fibre_per_100g === null)
      ? null
      : round((tot("fibre_per_100g") / total) * 100, 2);
    r.recipe_total_cooked_g = total;
    if (r.recipe_servings) r.default_serving_g = round(total / Number(r.recipe_servings), 1);
    r.includes_cooking_oil = ings.some((x) => x.f.tracking_tag === "cooking_oil");
    r.source = "Calculated from recipe ingredients";
    r.updated_at = nowIso();
    await this.persist(["food_items"]);
    return structuredClone(r);
  }

  /** Port of pp_recalculate_food_entries(): explicit user-initiated correction of past entries. */
  private async recalculate(foodId: string, from: string | null) {
    const f = this.t("food_items").find((x) => same(x.id, foodId));
    if (!f) return 0;
    const rows = this.t("food_entries").filter(
      (e) =>
        same(e.food_item_id, foodId) &&
        e.nutrition_source === "food_database" &&
        (!from || String(e.entry_date) >= from),
    );
    rows.forEach((e) => this.applyFood(e, f));
    await this.persist(["food_entries"]);
    return rows.length;
  }

  // ------------------------------------------------------------------ files (photos)

  async putFile(path: string, blob: Blob) {
    return this.run(async () => {
      this.files.set(path, blob);
      await this.persistence.saveFile(path, blob);
    });
  }
  async removeFiles(paths: string[]) {
    return this.run(async () => {
      for (const p of paths) {
        this.files.delete(p);
        await this.persistence.deleteFile(p);
      }
    });
  }
  async getFile(path: string): Promise<Blob | null> {
    return this.run(async () => this.files.get(path) ?? null);
  }

  // ------------------------------------------------------------------ backup / restore

  async exportAll(): Promise<{ tables: Record<string, Row[]>; files: [string, Blob][] }> {
    return this.run(async () => ({
      tables: structuredClone(this.tables),
      files: [...this.files.entries()],
    }));
  }
  async importAll(tables: Record<string, Row[]>, files: [string, Blob][]) {
    return this.run(async () => {
      await this.persistence.clear();
      this.tables = {};
      for (const t of TABLES)
        this.tables[t] = (tables[t] ?? []).map((r) => this.withDefaults(t, r));
      this.files = new Map(files);
      for (const t of TABLES) await this.persistence.saveTable(t, this.tables[t]);
      for (const [p, b] of files) await this.persistence.saveFile(p, b);
      this.listeners.forEach((l) => l());
    });
  }
  async eraseAll() {
    return this.importAll({}, []);
  }

  // ------------------------------------------------------------------ public API (Supabase-compatible subset)

  from(table: string) {
    return new QueryBuilder(this, table);
  }

  storage = {
    from: (bucket: string) => ({
      upload: async (path: string, blob: Blob, _opts?: unknown) => {
        await this.putFile(`${bucket}/${path}`, blob);
        return { data: { path }, error: null };
      },
      remove: async (paths: string[]) => {
        await this.removeFiles(paths.map((p) => `${bucket}/${p}`));
        return { data: paths.map((p) => ({ name: p })), error: null };
      },
      /** Local equivalent of signed URLs: object URLs that only exist inside this browser tab. */
      createSignedUrls: async (paths: string[], _expiresIn?: number) => {
        const out: { path: string; signedUrl: string | null; error: string | null }[] = [];
        for (const p of paths) {
          const b = await this.getFile(`${bucket}/${p}`);
          out.push({
            path: p,
            signedUrl: b ? URL.createObjectURL(b) : null,
            error: b ? null : "Not found",
          });
        }
        return { data: out, error: null };
      },
    }),
  };
}

// ======================================================================= query builder

interface QueryState {
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "delete";
  select: string | null;
  payload: Row | Row[] | null;
  onConflict: string | null;
  filters: Filter[];
  orders: { col: string; ascending: boolean }[];
  limit: number | null;
  single: "single" | "maybe" | null;
}

export class QueryBuilder implements PromiseLike<Result> {
  private q: QueryState;
  constructor(
    private db: LocalDb,
    table: string,
  ) {
    this.q = {
      table,
      op: "select",
      select: null,
      payload: null,
      onConflict: null,
      filters: [],
      orders: [],
      limit: null,
      single: null,
    };
  }
  select(cols = "*") {
    this.q.select = cols;
    return this;
  }
  insert(rows: object | object[]) {
    this.q.op = "insert";
    this.q.payload = rows as Row | Row[];
    return this;
  }
  upsert(rows: object | object[], opts: { onConflict?: string } = {}) {
    this.q.op = "upsert";
    this.q.payload = rows as Row | Row[];
    this.q.onConflict = opts.onConflict ?? null;
    return this;
  }
  update(patch: object) {
    this.q.op = "update";
    this.q.payload = patch as Row;
    return this;
  }
  delete() {
    this.q.op = "delete";
    return this;
  }
  private f(col: string, op: Filter["op"], value: unknown) {
    this.q.filters.push({ col, op, value });
    return this;
  }
  eq(c: string, v: unknown) {
    return this.f(c, "eq", v);
  }
  neq(c: string, v: unknown) {
    return this.f(c, "neq", v);
  }
  gte(c: string, v: unknown) {
    return this.f(c, "gte", v);
  }
  lte(c: string, v: unknown) {
    return this.f(c, "lte", v);
  }
  lt(c: string, v: unknown) {
    return this.f(c, "lt", v);
  }
  gt(c: string, v: unknown) {
    return this.f(c, "gt", v);
  }
  is(c: string, v: unknown) {
    return this.f(c, "is", v);
  }
  in(c: string, v: unknown[]) {
    return this.f(c, "in", v);
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.q.orders.push({ col, ascending: opts.ascending ?? true });
    return this;
  }
  limit(n: number) {
    this.q.limit = n;
    return this;
  }
  single() {
    this.q.single = "single";
    return this;
  }
  maybeSingle() {
    this.q.single = "maybe";
    return this;
  }
  then<A = Result, B = never>(
    onOk?: ((v: Result) => A | PromiseLike<A>) | null,
    onErr?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    if (this.q.op === "select" && this.q.select === null) this.q.select = "*";
    return this.db.exec(this.q).then(onOk, onErr);
  }
}
