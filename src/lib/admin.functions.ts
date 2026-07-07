import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId);
  if (error) throw new Error(error.message);
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.some((r: string) => r === "super_admin" || r === "agency_admin")) {
    throw new Error("Forbidden: admin role required");
  }
}

const createClientSchema = z.object({
  clientName: z.string().min(1).max(120),
  storeType: z.enum(["shopify", "woocommerce"]).nullable().optional(),
  storeUrl: z.string().max(500).optional().nullable(),
});

export const createClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => createClientSchema.parse(v))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("clients")
      .insert({
        client_name: data.clientName,
        store_type: data.storeType ?? null,
        store_url: data.storeUrl ?? null,
        agency_id: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

const inviteSchema = z.object({
  clientId: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string().max(120).optional(),
  role: z.enum(["client", "agency_admin"]).default("client"),
});

export const inviteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => inviteSchema.parse(v))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Create or lookup the auth user
    let userId: string | null = null;
    const { data: invited, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      data.email,
      { data: { full_name: data.fullName ?? null } },
    );
    if (inviteErr) {
      if (!/registered|exists/i.test(inviteErr.message)) throw new Error(inviteErr.message);
      // Look up existing user
      const { data: listed } = await supabaseAdmin.auth.admin.listUsers();
      userId = listed.users.find((u) => u.email?.toLowerCase() === data.email.toLowerCase())?.id ?? null;
    } else {
      userId = invited.user?.id ?? null;
    }
    if (!userId) throw new Error("Could not resolve invited user id");

    // Ensure role
    await supabaseAdmin.from("user_roles").upsert(
      { user_id: userId, role: data.role },
      { onConflict: "user_id,role" },
    );
    // Ensure membership
    await supabaseAdmin.from("client_members").upsert(
      { user_id: userId, client_id: data.clientId },
      { onConflict: "client_id,user_id" },
    );

    return { ok: true };
  });