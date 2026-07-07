import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AppRole = "super_admin" | "agency_admin" | "client";

export type MePayload = {
  userId: string;
  email: string | null;
  fullName: string | null;
  roles: AppRole[];
  isAdmin: boolean;
  clientIds: string[];
};

export const getMe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MePayload> => {
    const { supabase, userId } = context;
    const [profileRes, rolesRes, membersRes] = await Promise.all([
      supabase.from("profiles").select("email,full_name").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("client_members").select("client_id").eq("user_id", userId),
    ]);
    const roles = (rolesRes.data ?? []).map((r) => r.role as AppRole);
    return {
      userId,
      email: profileRes.data?.email ?? null,
      fullName: profileRes.data?.full_name ?? null,
      roles,
      isAdmin: roles.some((r) => r === "super_admin" || r === "agency_admin"),
      clientIds: (membersRes.data ?? []).map((m) => m.client_id),
    };
  });