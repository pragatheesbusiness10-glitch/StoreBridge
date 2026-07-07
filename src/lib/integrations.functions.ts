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

const upsertSchema = z.object({
  clientId: z.string().uuid(),
  platform: z.enum(["shopify", "woocommerce"]),
  storeUrl: z.string().url().max(500),
  storeName: z.string().max(200).optional().nullable(),
  apiVersion: z.string().max(20).optional().nullable(),
  defaultLocationId: z.string().max(120).optional().nullable(),
  defaultCollection: z.string().max(200).optional().nullable(),
  defaultCategory: z.string().max(200).optional().nullable(),
  accessToken: z.string().max(500).optional().nullable(),
  consumerKey: z.string().max(500).optional().nullable(),
  consumerSecret: z.string().max(500).optional().nullable(),
  isActive: z.boolean().default(true),
});

export const upsertIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => upsertSchema.parse(v))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { encryptString } = await import("@/lib/crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const payload: any = {
      client_id: data.clientId,
      platform: data.platform,
      store_url: data.storeUrl,
      store_name: data.storeName ?? null,
      api_version: data.apiVersion ?? null,
      default_location_id: data.defaultLocationId ?? null,
      default_collection: data.defaultCollection ?? null,
      default_category: data.defaultCategory ?? null,
      is_active: data.isActive,
    };
    if (data.accessToken) payload.enc_access_token = encryptString(data.accessToken);
    if (data.consumerKey) payload.enc_consumer_key = encryptString(data.consumerKey);
    if (data.consumerSecret) payload.enc_consumer_secret = encryptString(data.consumerSecret);

    const { error } = await supabaseAdmin
      .from("store_integrations")
      .upsert(payload, { onConflict: "client_id,platform" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const testSchema = z.object({ integrationId: z.string().uuid() });

export const testIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => testSchema.parse(v))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { decryptString } = await import("@/lib/crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: integ, error } = await supabaseAdmin
      .from("store_integrations")
      .select("*")
      .eq("id", data.integrationId)
      .single();
    if (error || !integ) throw new Error(error?.message ?? "Integration not found");

    let ok = false;
    let message = "";
    try {
      if (integ.platform === "shopify") {
        const token = decryptString(integ.enc_access_token);
        const version = integ.api_version || "2024-07";
        const url = `${integ.store_url.replace(/\/$/, "")}/admin/api/${version}/shop.json`;
        const res = await fetch(url, {
          headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
        });
        ok = res.ok;
        message = ok ? "Shopify connection OK" : `HTTP ${res.status}: ${await res.text()}`;
      } else {
        const key = decryptString(integ.enc_consumer_key);
        const secret = decryptString(integ.enc_consumer_secret);
        const url = `${integ.store_url.replace(/\/$/, "")}/wp-json/wc/v3/system_status`;
        const auth = Buffer.from(`${key}:${secret}`).toString("base64");
        const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
        ok = res.ok;
        message = ok ? "WooCommerce connection OK" : `HTTP ${res.status}: ${await res.text().catch(() => "")}`;
      }
    } catch (err) {
      ok = false;
      message = err instanceof Error ? err.message : String(err);
    }

    await supabaseAdmin
      .from("store_integrations")
      .update({ last_tested_at: new Date().toISOString(), last_test_status: ok ? "success" : "failure" })
      .eq("id", data.integrationId);

    await supabaseAdmin.from("import_logs").insert({
      client_id: integ.client_id,
      platform: integ.platform,
      action: "test_connection",
      status: ok ? "success" : "failure",
      error_message: ok ? null : message,
      actor_id: context.userId,
    });

    return { ok, message };
  });