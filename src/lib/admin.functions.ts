import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function forbidden(message: string): never {
  throw new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}

async function writeAudit(
  ctx: { supabase: any; userId: string; claims?: any },
  entry: {
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    clientId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email =
      (ctx.claims?.email as string | undefined) ??
      (ctx.claims?.user_metadata?.email as string | undefined) ??
      null;
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: ctx.userId,
      actor_email: email,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      client_id: entry.clientId ?? null,
      metadata: (entry.metadata ?? {}) as any,
    });
  } catch (err) {
    console.error("audit log write failed", err);
  }
}

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId);
  if (error) throw new Error(error.message);
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.some((r: string) => r === "super_admin" || r === "agency_admin")) {
    forbidden("Forbidden: admin role required");
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
  if (!data) forbidden("Forbidden: not the assigned agency for this client");
  return info;
}

// Block reusing an email that already belongs to a user with a different role.
// Returns the existing user's id (or null if the email is not yet registered).
async function assertEmailAvailableForRole(email: string, intendedRole: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const normalized = email.toLowerCase();
  const { data: listed, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
  if (listErr) throw new Error(listErr.message);
  const existing = listed.users.find((u) => u.email?.toLowerCase() === normalized);
  if (!existing) return null;
  const { data: roleRows, error: roleErr } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", existing.id);
  if (roleErr) throw new Error(roleErr.message);
  const roles = (roleRows ?? []).map((r: any) => String(r.role));
  const conflicting = roles.filter((r) => r !== intendedRole);
  if (conflicting.length > 0) {
    const pretty = conflicting.map((r) => r.replace(/_/g, " ")).join(", ");
    forbidden(
      `This email is already registered as ${pretty}. Use a different email — one account can't be reused across roles.`,
    );
  }
  return existing.id;
}

export const deleteProductCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ categoryId: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: category, error: categoryError } = await supabaseAdmin
      .from("product_categories")
      .select("id, name, created_by")
      .eq("id", data.categoryId)
      .maybeSingle();
    if (categoryError) throw new Error(categoryError.message);
    if (!category) throw new Error("Category not found");

    // Permission: admin or original creator
    const actorInfo = await assertAdmin(context).catch(() => null);
    const isAdminActor = !!actorInfo;
    if (!isAdminActor && category.created_by !== context.userId) {
      throw new Error("You do not have permission to delete this category");
    }

    // Block delete when in use by any product
    const { count, error: countError } = await supabaseAdmin
      .from("products")
      .select("id", { count: "exact", head: true })
      .ilike("category", category.name);
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) > 0) {
      throw new Error(
        "This category is used by one or more products. Reassign those products before deleting.",
      );
    }

    const { error } = await supabaseAdmin
      .from("product_categories")
      .delete()
      .eq("id", data.categoryId);
    if (error) throw new Error(error.message);

    await writeAudit(context, {
      action: "category.delete",
      targetType: "category",
      targetId: data.categoryId,
      metadata: { name: category.name },
    });
    return { ok: true };
  });

const createClientSchema = z.object({
  clientName: z.string().min(1).max(120),
  storeType: z.enum(["shopify", "woocommerce"]).nullable().optional(),
  storeUrl: z.string().max(500).optional().nullable(),
});

const updateClientSchema = z.object({
  clientId: z.string().uuid(),
  clientName: z.string().min(1).max(120).optional(),
  storeType: z.enum(["shopify", "woocommerce"]).nullable().optional(),
  storeUrl: z.string().max(500).nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export const updateClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => updateClientSchema.parse(v))
  .handler(async ({ data, context }) => {
    await assertCanManageClient(context, data.clientId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {};
    if (data.clientName !== undefined) patch.client_name = data.clientName;
    if (data.storeType !== undefined) patch.store_type = data.storeType;
    if (data.storeUrl !== undefined) patch.store_url = data.storeUrl;
    if (data.status !== undefined) patch.status = data.status;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabaseAdmin.from("clients").update(patch).eq("id", data.clientId);
    if (error) throw new Error(error.message);
    await writeAudit(context, {
      action: "client.update",
      targetType: "client",
      targetId: data.clientId,
      clientId: data.clientId,
      metadata: patch,
    });
    return { ok: true };
  });

export const deleteClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ clientId: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    const info = await assertAdmin(context);
    if (!info.isSuperAdmin) forbidden("Forbidden: super admin only");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: client, error: cErr } = await supabaseAdmin
      .from("clients")
      .select("id, client_name")
      .eq("id", data.clientId)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!client) throw new Error("Client not found");

    const { count, error: countErr } = await supabaseAdmin
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("client_id", data.clientId);
    if (countErr) throw new Error(countErr.message);
    if ((count ?? 0) > 0) {
      throw new Error(
        `This client has ${count} product${count === 1 ? "" : "s"}. Delete or reassign them before deleting the client.`,
      );
    }

    // Clean up dependent rows the DB may not cascade automatically.
    await supabaseAdmin.from("client_members").delete().eq("client_id", data.clientId);
    await supabaseAdmin.from("store_integrations").delete().eq("client_id", data.clientId);

    const { error } = await supabaseAdmin.from("clients").delete().eq("id", data.clientId);
    if (error) throw new Error(error.message);

    await writeAudit(context, {
      action: "client.delete",
      targetType: "client",
      targetId: data.clientId,
      clientId: data.clientId,
      metadata: { clientName: client.client_name },
    });
    return { ok: true };
  });

export const createClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => createClientSchema.parse(v))
  .handler(async ({ data, context }) => {
    const info = await assertAdmin(context);
    if (!info.isSuperAdmin) forbidden("Forbidden: super admin only");
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
    await writeAudit(context, {
      action: "client.create",
      targetType: "client",
      targetId: row.id,
      clientId: row.id,
      metadata: { clientName: data.clientName, storeType: data.storeType ?? null, storeUrl: data.storeUrl ?? null },
    });
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
    const info = await assertAdmin(context);
    if (!info.isSuperAdmin) forbidden("Forbidden: super admin only");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Reject if this email already belongs to a user with a different role.
    await assertEmailAvailableForRole(data.email, data.role);

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
    // Ensure membership — detect whether we actually added a new row so we
    // can distinguish "invited existing member" from "granted new access".
    const { data: existingMembership } = await supabaseAdmin
      .from("client_members")
      .select("id")
      .eq("user_id", userId)
      .eq("client_id", data.clientId)
      .maybeSingle();
    const membershipAdded = !existingMembership;
    if (membershipAdded) {
      const { error: memErr } = await supabaseAdmin
        .from("client_members")
        .insert({ user_id: userId, client_id: data.clientId });
      if (memErr) throw new Error(memErr.message);
    }

    await writeAudit(context, {
      action: "member.invite",
      targetType: "user",
      targetId: userId,
      clientId: data.clientId,
      metadata: { email: data.email, role: data.role, fullName: data.fullName ?? null },
    });
    if (membershipAdded) {
      await writeAudit(context, {
        action: "member.add",
        targetType: "user",
        targetId: userId,
        clientId: data.clientId,
        metadata: { email: data.email, via: "invite" },
      });
    }
    await writeAudit(context, {
      action: "role.assign",
      targetType: "user",
      targetId: userId,
      clientId: data.clientId,
      metadata: { role: data.role },
    });
    return { ok: true };
  });

export const listAgencies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const info = await assertAdmin(context);
    if (!info.isSuperAdmin) forbidden("Forbidden: super admin only");
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
    if (!info.isSuperAdmin) forbidden("Forbidden: only super admins can assign agencies");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("clients")
      .update({ agency_id: data.agencyId })
      .eq("id", data.clientId);
    if (error) throw new Error(error.message);
    await writeAudit(context, {
      action: "client.assign_agency",
      targetType: "client",
      targetId: data.clientId,
      clientId: data.clientId,
      metadata: { agencyId: data.agencyId },
    });
    return { ok: true };
  });

const createLoginSchema = z.object({
  clientId: z.string().uuid(),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  fullName: z.string().max(120).optional(),
});

export const createClientLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => createLoginSchema.parse(v))
  .handler(async ({ data, context }) => {
    const info = await assertAdmin(context);
    if (!info.isSuperAdmin) forbidden("Forbidden: super admin only");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Reject if this email already belongs to a user with a different role.
    await assertEmailAvailableForRole(data.email, "client");

    let userId: string | null = null;
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName ?? null },
    });
    if (createErr) {
      if (!/registered|exists|already/i.test(createErr.message)) throw new Error(createErr.message);
      // Existing user — update password + confirm
      const { data: listed } = await supabaseAdmin.auth.admin.listUsers();
      const existing = listed.users.find((u) => u.email?.toLowerCase() === data.email.toLowerCase());
      if (!existing) throw new Error("Could not resolve user for existing email");
      userId = existing.id;
      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: data.password,
        email_confirm: true,
        user_metadata: { ...(existing.user_metadata ?? {}), full_name: data.fullName ?? (existing.user_metadata as any)?.full_name ?? null },
      });
      if (updErr) throw new Error(updErr.message);
    } else {
      userId = created.user?.id ?? null;
    }
    if (!userId) throw new Error("Could not resolve user id");

    await supabaseAdmin.from("user_roles").upsert(
      { user_id: userId, role: "client" },
      { onConflict: "user_id,role" },
    );

    const { data: existingMembership } = await supabaseAdmin
      .from("client_members")
      .select("id")
      .eq("user_id", userId)
      .eq("client_id", data.clientId)
      .maybeSingle();
    const membershipAdded = !existingMembership;
    if (membershipAdded) {
      const { error: memErr } = await supabaseAdmin
        .from("client_members")
        .insert({ user_id: userId, client_id: data.clientId });
      if (memErr) throw new Error(memErr.message);
    }

    await writeAudit(context, {
      action: "member.create_login",
      targetType: "user",
      targetId: userId,
      clientId: data.clientId,
      metadata: { email: data.email, fullName: data.fullName ?? null },
    });
    if (membershipAdded) {
      await writeAudit(context, {
        action: "member.add",
        targetType: "user",
        targetId: userId,
        clientId: data.clientId,
        metadata: { email: data.email, via: "create_login" },
      });
    }
    return { ok: true, userId };
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
    let removedClientId: string | null = null;
    let removedUserId: string | null = null;
    const { data: mRow } = await supabaseAdmin
      .from("client_members")
      .select("client_id, user_id")
      .eq("id", data.membershipId)
      .maybeSingle();
    removedClientId = mRow?.client_id ?? null;
    removedUserId = mRow?.user_id ?? null;
    if (!info.isSuperAdmin) {
      if (!mRow) throw new Error("Membership not found");
      const { data: c } = await supabaseAdmin
        .from("clients")
        .select("id")
        .eq("id", mRow.client_id)
        .eq("agency_id", context.userId)
        .maybeSingle();
      if (!c) forbidden("Forbidden: not the assigned agency for this client");
    }
    const { error } = await supabaseAdmin.from("client_members").delete().eq("id", data.membershipId);
    if (error) throw new Error(error.message);
    await writeAudit(context, {
      action: "member.remove",
      targetType: "user",
      targetId: removedUserId,
      clientId: removedClientId,
      metadata: { membershipId: data.membershipId },
    });
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
    if (!c) forbidden("Forbidden: not the assigned agency for this client");
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
    await writeAudit(context, {
      action: "member.update",
      targetType: "user",
      targetId: member.user_id,
      clientId: member.client_id,
      metadata: {
        fullNameChanged: data.fullName !== undefined,
        passwordReset: !!data.newPassword,
      },
    });
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
    await writeAudit(context, {
      action: data.active ? "member.reactivate" : "member.deactivate",
      targetType: "user",
      targetId: member.user_id,
      clientId: member.client_id,
      metadata: {},
    });
    return { ok: true };
  });

export const listAuditLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) =>
    z
      .object({
        clientId: z.string().uuid().nullable().optional(),
        limit: z.number().int().min(1).max(200).default(100),
      })
      .parse(v ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    let q = context.supabase
      .from("audit_logs")
      .select("id, actor_id, actor_email, action, target_type, target_id, client_id, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.clientId) q = q.eq("client_id", data.clientId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const clientIds = Array.from(new Set((rows ?? []).map((r: any) => r.client_id).filter(Boolean))) as string[];
    let clientNameMap = new Map<string, string>();
    if (clientIds.length) {
      const { data: cs } = await context.supabase
        .from("clients")
        .select("id, client_name")
        .in("id", clientIds);
      clientNameMap = new Map((cs ?? []).map((c: any) => [c.id, c.client_name]));
    }
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      actorId: r.actor_id,
      actorEmail: r.actor_email,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      clientId: r.client_id,
      clientName: r.client_id ? clientNameMap.get(r.client_id) ?? null : null,
      metadata: r.metadata ?? {},
      createdAt: r.created_at,
    }));
  });

export const setMyExclusiveClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ clientId: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    await assertCanManageClient(context, data.clientId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing, error: listErr } = await supabaseAdmin
      .from("client_members")
      .select("id, client_id")
      .eq("user_id", context.userId);
    if (listErr) throw new Error(listErr.message);

    const toRemove = (existing ?? []).filter((r: any) => r.client_id !== data.clientId);
    const removedClientIds = toRemove.map((r: any) => r.client_id);
    if (toRemove.length) {
      const { error: delErr } = await supabaseAdmin
        .from("client_members")
        .delete()
        .in("id", toRemove.map((r: any) => r.id));
      if (delErr) throw new Error(delErr.message);
    }

    const alreadyMember = (existing ?? []).some((r: any) => r.client_id === data.clientId);
    if (!alreadyMember) {
      const { error: insErr } = await supabaseAdmin
        .from("client_members")
        .insert({ user_id: context.userId, client_id: data.clientId });
      if (insErr) throw new Error(insErr.message);
    }

    for (const removedClientId of removedClientIds) {
      await writeAudit(context, {
        action: "member.remove",
        targetType: "user",
        targetId: context.userId,
        clientId: removedClientId,
        metadata: { via: "set_exclusive", newClientId: data.clientId },
      });
    }
    if (!alreadyMember) {
      await writeAudit(context, {
        action: "member.add",
        targetType: "user",
        targetId: context.userId,
        clientId: data.clientId,
        metadata: { via: "set_exclusive" },
      });
    }
    await writeAudit(context, {
      action: "member.set_exclusive",
      targetType: "user",
      targetId: context.userId,
      clientId: data.clientId,
      metadata: { addedToClientId: data.clientId, removedClientIds },
    });
    return { ok: true, addedToClientId: data.clientId, removedClientIds };
  });