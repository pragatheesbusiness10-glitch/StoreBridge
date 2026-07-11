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
  return {
    roles: roles as string[],
    isSuperAdmin: roles.includes("super_admin"),
  };
}

async function assertCanManageClient(
  ctx: { supabase: any; userId: string },
  clientId: string,
) {
  const info = await assertAdmin(ctx);
  if (info.isSuperAdmin) return info;
  const { data, error } = await ctx.supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("agency_id", ctx.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: not the assigned agency for this client");
  return info;
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
    await assertCanManageClient(context, data.clientId);
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

export const listAgencies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const info = await assertAdmin(context);
    if (!info.isSuperAdmin) throw new Error("Forbidden: super admin only");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles, error } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .in("role", ["agency_admin", "super_admin"]);
    if (error) throw new Error(error.message);
    const ids = Array.from(new Set((roles ?? []).map((r: any) => r.user_id)));
    if (ids.length === 0) return [];
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids);
    return (profs ?? []).map((p: any) => ({ id: p.id, name: p.full_name || p.email || p.id, email: p.email }));
  });

export const assignAgency = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ clientId: z.string().uuid(), agencyId: z.string().uuid().nullable() }).parse(v))
  .handler(async ({ data, context }) => {
    const info = await assertAdmin(context);
    if (!info.isSuperAdmin) throw new Error("Forbidden: only super admins can assign agencies");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("clients")
      .update({ agency_id: data.agencyId })
      .eq("id", data.clientId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listClientMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ clientId: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    await assertCanManageClient(context, data.clientId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: members, error } = await supabaseAdmin
      .from("client_members")
      .select("id, user_id, created_at")
      .eq("client_id", data.clientId);
    if (error) throw new Error(error.message);
    const ids = (members ?? []).map((m: any) => m.user_id);
    if (ids.length === 0) return [];
    const [{ data: profs }, { data: roles }, { data: authList }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, email").in("id", ids),
      supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
      supabaseAdmin.auth.admin.listUsers(),
    ]);
    const profMap = new Map((profs ?? []).map((p: any) => [p.id, p]));
    const rolesMap = new Map<string, string[]>();
    (roles ?? []).forEach((r: any) => {
      rolesMap.set(r.user_id, [...(rolesMap.get(r.user_id) ?? []), r.role]);
    });
    const confirmedMap = new Map(authList.users.map((u) => [u.id, !!u.email_confirmed_at || !!u.last_sign_in_at]));
    const bannedMap = new Map(
      authList.users.map((u) => {
        const until = (u as any).banned_until as string | null | undefined;
        const active = !until || new Date(until).getTime() <= Date.now();
        return [u.id, !active];
      }),
    );
    return (members ?? []).map((m: any) => {
      const p = profMap.get(m.user_id) as any;
      return {
        membershipId: m.id,
        userId: m.user_id,
        fullName: p?.full_name ?? null,
        email: p?.email ?? null,
        roles: rolesMap.get(m.user_id) ?? [],
        confirmed: confirmedMap.get(m.user_id) ?? false,
        banned: bannedMap.get(m.user_id) ?? false,
        joinedAt: m.created_at,
      };
    });
  });

export const removeClientMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ membershipId: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    const info = await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!info.isSuperAdmin) {
      const { data: m } = await supabaseAdmin
        .from("client_members")
        .select("client_id")
        .eq("id", data.membershipId)
        .maybeSingle();
      if (!m) throw new Error("Membership not found");
      const { data: c } = await supabaseAdmin
        .from("clients")
        .select("id")
        .eq("id", m.client_id)
        .eq("agency_id", context.userId)
        .maybeSingle();
      if (!c) throw new Error("Forbidden: not the assigned agency for this client");
    }
    const { error } = await supabaseAdmin.from("client_members").delete().eq("id", data.membershipId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resendInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ email: z.string().email() }).parse(v))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email);
    if (error && !/registered|exists/i.test(error.message)) throw new Error(error.message);
    return { ok: true };
  });

async function assertCanManageMember(
  ctx: { supabase: any; userId: string },
  membershipId: string,
) {
  const info = await assertAdmin(ctx);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: m, error } = await supabaseAdmin
    .from("client_members")
    .select("client_id, user_id")
    .eq("id", membershipId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!m) throw new Error("Membership not found");
  if (!info.isSuperAdmin) {
    const { data: c } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("id", m.client_id)
      .eq("agency_id", ctx.userId)
      .maybeSingle();
    if (!c) throw new Error("Forbidden: not the assigned agency for this client");
  }
  return { info, member: m };
}

export const updateMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) =>
    z
      .object({
        membershipId: z.string().uuid(),
        fullName: z.string().max(120).optional(),
        newPassword: z.string().min(8).max(200).optional(),
      })
      .parse(v),
  )
  .handler(async ({ data, context }) => {
    const { member } = await assertCanManageMember(context, data.membershipId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.fullName !== undefined) {
      const { error } = await supabaseAdmin
        .from("profiles")
        .update({ full_name: data.fullName })
        .eq("id", member.user_id);
      if (error) throw new Error(error.message);
    }
    if (data.newPassword) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(member.user_id, {
        password: data.newPassword,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const setMemberActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) =>
    z.object({ membershipId: z.string().uuid(), active: z.boolean() }).parse(v),
  )
  .handler(async ({ data, context }) => {
    const { member } = await assertCanManageMember(context, data.membershipId);
    if (member.user_id === context.userId) throw new Error("You cannot change your own status");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(member.user_id, {
      ban_duration: data.active ? "none" : "876000h",
    } as any);
    if (error) throw new Error(error.message);
    return { ok: true };
  });