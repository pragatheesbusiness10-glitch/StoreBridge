import type { SupabaseClient } from "@supabase/supabase-js";
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { FitnessProfile, NutritionTarget, Program } from "./types";

/**
 * The Prime Physique tables are not part of the generated StoreBridge `Database` type yet,
 * so we use an untyped client view and the hand-written row types in ./types.
 * Security is enforced server-side by Row Level Security (user_id = auth.uid()).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as unknown as SupabaseClient<any, "public", any>;

export const qk = (table: string, ...rest: unknown[]): QueryKey => ["pp", table, ...rest];

export function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e)
    return String((e as { message: unknown }).message);
  return "Something went wrong";
}

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

export async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

/** Generic date-ranged list query. */
export function useRange<T>(
  table: string,
  dateCol: string,
  from: string | null,
  to: string | null,
  opts: { order?: string; ascending?: boolean; select?: string; enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: qk(table, "range", from, to, opts.select ?? "*"),
    enabled: opts.enabled ?? true,
    queryFn: async () => {
      let q = db.from(table).select(opts.select ?? "*");
      if (from) q = q.gte(dateCol, from);
      if (to) q = q.lte(dateCol, to);
      q = q.order(opts.order ?? dateCol, { ascending: opts.ascending ?? true });
      return unwrap<T[]>(
        q.limit(5000) as unknown as PromiseLike<{ data: T[] | null; error: unknown }>,
      );
    },
  });
}

/** Generic full-table list (user-scoped by RLS). */
export function useList<T>(
  table: string,
  opts: {
    order?: string;
    ascending?: boolean;
    select?: string;
    filter?: Record<string, unknown>;
  } = {},
) {
  return useQuery({
    queryKey: qk(table, "list", opts.select ?? "*", opts.filter ?? null),
    queryFn: async () => {
      let q = db.from(table).select(opts.select ?? "*");
      for (const [k, v] of Object.entries(opts.filter ?? {})) q = q.eq(k, v as string);
      if (opts.order) q = q.order(opts.order, { ascending: opts.ascending ?? true });
      return unwrap<T[]>(
        q.limit(5000) as unknown as PromiseLike<{ data: T[] | null; error: unknown }>,
      );
    },
  });
}

/** Insert / update / delete helpers with toasts and cache invalidation of the table (and dependants). */
export function useTableMutations(table: string, alsoInvalidate: string[] = []) {
  const qc = useQueryClient();
  const invalidate = () => {
    for (const t of [table, ...alsoInvalidate]) qc.invalidateQueries({ queryKey: ["pp", t] });
    qc.invalidateQueries({ queryKey: ["pp", "daily"] });
  };
  const onError = (e: unknown) => toast.error(errMsg(e));
  const insert = useMutation({
    mutationFn: async (row: Record<string, unknown> | Record<string, unknown>[]) =>
      unwrap(db.from(table).insert(row).select()),
    onSuccess: invalidate,
    onError,
  });
  const upsert = useMutation({
    mutationFn: async ({ row, onConflict }: { row: Record<string, unknown>; onConflict: string }) =>
      unwrap(db.from(table).upsert(row, { onConflict }).select()),
    onSuccess: invalidate,
    onError,
  });
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      unwrap(db.from(table).update(patch).eq("id", id).select()),
    onSuccess: invalidate,
    onError,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(db.from(table).delete().eq("id", id).select()),
    onSuccess: invalidate,
    onError,
  });
  return { insert, upsert, update, remove, invalidate };
}

// ------------------------------------------------------------------ core singletons

export function useProfile() {
  return useQuery({
    queryKey: qk("fitness_profiles"),
    queryFn: async () =>
      unwrap<FitnessProfile | null>(db.from("fitness_profiles").select("*").maybeSingle()),
  });
}

export function useProgram() {
  return useQuery({
    queryKey: qk("transformation_programs", "active"),
    queryFn: async () =>
      unwrap<Program | null>(
        db.from("transformation_programs").select("*").eq("is_active", true).maybeSingle(),
      ),
  });
}

export function useTargets() {
  return useQuery({
    queryKey: qk("nutrition_targets"),
    queryFn: async () =>
      unwrap<NutritionTarget[]>(
        db.from("nutrition_targets").select("*").order("effective_from", { ascending: true }),
      ),
  });
}

/** Target row in effect on a given date (latest effective_from ≤ date; falls back to the earliest). */
export function targetFor(
  targets: NutritionTarget[] | undefined,
  date: string,
): NutritionTarget | null {
  if (!targets?.length) return null;
  const applicable = targets.filter((t) => t.effective_from <= date);
  return applicable.length ? applicable[applicable.length - 1] : targets[0];
}

export { unwrap };
