import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AppRole = "super_admin" | "agency_admin" | "client";

export type MePayload = {
  userId: string;
  email: string | null;
  fullName: string | null;
  roles: AppRole[];
  isAdmin: boolean;
  isSuperAdmin: boolean;
  clientIds: string[];
};

export const getMe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MePayload> => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [profileRes, rolesRes, membersRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("email,full_name").eq("id", userId).maybeSingle(),
      supabaseAdmin.from("user_roles").select("role").eq("user_id", userId),
      supabaseAdmin.from("client_members").select("client_id").eq("user_id", userId),
    ]);
    if (profileRes.error) throw new Error(profileRes.error.message);
    if (rolesRes.error) throw new Error(rolesRes.error.message);
    if (membersRes.error) throw new Error(membersRes.error.message);
    const roles = (rolesRes.data ?? []).map((r) => r.role as AppRole);
    return {
      userId,
      email: profileRes.data?.email ?? null,
      fullName: profileRes.data?.full_name ?? null,
      roles,
      isAdmin: roles.some((r) => r === "super_admin" || r === "agency_admin"),
      isSuperAdmin: roles.some((r) => r === "super_admin"),
      clientIds: (membersRes.data ?? []).map((m) => m.client_id),
    };
  });