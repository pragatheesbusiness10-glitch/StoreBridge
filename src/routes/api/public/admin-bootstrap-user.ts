import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/admin-bootstrap-user")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ADMIN_BOOTSTRAP_SECRET;
        if (!secret) return new Response("Not configured", { status: 500 });
        if (request.headers.get("x-admin-secret") !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }
        const body = (await request.json()) as {
          email?: string;
          password?: string;
          fullName?: string;
          role?: "super_admin" | "agency_admin" | "client";
        };
        if (!body.email || !body.password) {
          return new Response("Missing email or password", { status: 400 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
          email: body.email,
          password: body.password,
          email_confirm: true,
          user_metadata: body.fullName ? { full_name: body.fullName } : undefined,
        });
        if (error || !created.user) {
          return Response.json({ error: error?.message ?? "Failed" }, { status: 400 });
        }
        const role = body.role ?? "super_admin";
        const { error: rErr } = await supabaseAdmin
          .from("user_roles")
          .upsert({ user_id: created.user.id, role }, { onConflict: "user_id,role" });
        if (rErr) return Response.json({ error: rErr.message }, { status: 500 });
        return Response.json({ ok: true, userId: created.user.id });
      },
    },
  },
});