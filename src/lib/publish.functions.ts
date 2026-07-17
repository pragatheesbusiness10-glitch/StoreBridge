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
  return { isSuperAdmin: (roles as string[]).includes("super_admin") };
}

const schema = z.object({
  productId: z.string().uuid(),
  platform: z.enum(["shopify", "woocommerce"]),
});

export const publishProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => schema.parse(v))
  .handler(async ({ data, context }) => {
    const info = await assertAdmin(context);
    const { decryptString } = await import("@/lib/crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: product, error: pErr } = await supabaseAdmin
      .from("products")
      .select("*")
      .eq("id", data.productId)
      .single();
    if (pErr || !product) throw new Error(pErr?.message ?? "Product not found");

    // Scope agency admins to clients they own
    if (!info.isSuperAdmin) {
      const { data: owned } = await supabaseAdmin
        .from("clients")
        .select("id")
        .eq("id", product.client_id)
        .eq("agency_id", context.userId)
        .maybeSingle();
      if (!owned) throw new Error("Forbidden: not the assigned agency for this client");
    }

    const { data: integ } = await supabaseAdmin
      .from("store_integrations")
      .select("*")
      .eq("client_id", product.client_id)
      .eq("platform", data.platform)
      .eq("is_active", true)
      .maybeSingle();
    if (!integ) throw new Error(`No active ${data.platform} integration for this client`);

    const { data: images } = await supabaseAdmin
      .from("product_images")
      .select("storage_path,alt_text,sort_order")
      .eq("product_id", product.id)
      .order("sort_order", { ascending: true });

    // Long-lived signed URLs so the platform can fetch images once.
    const imageUrls: { url: string; alt: string | null }[] = [];
    for (const img of images ?? []) {
      const { data: signed } = await supabaseAdmin.storage
        .from("product-images")
        .createSignedUrl(img.storage_path, 60 * 60 * 24 * 7);
      if (signed?.signedUrl) imageUrls.push({ url: signed.signedUrl, alt: img.alt_text });
    }

    let ok = false;
    let responseBody: any = null;
    let error_message: string | null = null;
    let platform_product_id: string | null = null;
    let published_url: string | null = null;
    let requestPayload: any = null;

    try {
      if (data.platform === "shopify") {
        const token = decryptString(integ.enc_access_token);
        const version = integ.api_version || "2024-07";
        requestPayload = {
          product: {
            title: product.title,
            body_html: product.description ?? "",
            vendor: product.vendor ?? undefined,
            product_type: product.product_type ?? undefined,
            tags: (product.tags ?? []).join(", "),
            status: "active",
            variants: [
              {
                price: product.price != null ? String(product.price) : undefined,
                compare_at_price: product.compare_at_price != null ? String(product.compare_at_price) : undefined,
                sku: product.sku ?? undefined,
                barcode: product.barcode ?? undefined,
                inventory_management: "shopify",
                inventory_quantity: product.inventory_quantity ?? 0,
              },
            ],
            images: imageUrls.map((i) => ({ src: i.url, alt: i.alt ?? undefined })),
            metafields_global_title_tag: product.seo_title ?? undefined,
            metafields_global_description_tag: product.seo_description ?? undefined,
          },
        };
        const url = `${integ.store_url.replace(/\/$/, "")}/admin/api/${version}/products.json`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
          body: JSON.stringify(requestPayload),
        });
        responseBody = await res.json().catch(() => ({}));
        ok = res.ok;
        if (!ok) error_message = `Shopify HTTP ${res.status}: ${JSON.stringify(responseBody)}`;
        platform_product_id = responseBody?.product?.id ? String(responseBody.product.id) : null;
        if (platform_product_id) {
          published_url = `${integ.store_url.replace(/\/$/, "")}/admin/products/${platform_product_id}`;
        }
      } else {
        const key = decryptString(integ.enc_consumer_key);
        const secret = decryptString(integ.enc_consumer_secret);
        requestPayload = {
          name: product.title,
          type: "simple",
          regular_price: product.price != null ? String(product.price) : undefined,
          sale_price: product.compare_at_price != null ? String(product.compare_at_price) : undefined,
          description: product.description ?? "",
          short_description: product.short_description ?? "",
          sku: product.sku ?? undefined,
          manage_stock: true,
          stock_quantity: product.inventory_quantity ?? 0,
          status: "publish",
          categories: product.woo_category ? [{ name: product.woo_category }] : undefined,
          tags: (product.tags ?? []).map((name: string) => ({ name })),
          images: imageUrls.map((i) => ({ src: i.url, alt: i.alt ?? "" })),
          meta_data: [
            product.seo_title ? { key: "_yoast_wpseo_title", value: product.seo_title } : null,
            product.seo_description ? { key: "_yoast_wpseo_metadesc", value: product.seo_description } : null,
          ].filter(Boolean),
        };
        const url = `${integ.store_url.replace(/\/$/, "")}/wp-json/wc/v3/products`;
        const auth = Buffer.from(`${key}:${secret}`).toString("base64");
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
          body: JSON.stringify(requestPayload),
        });
        responseBody = await res.json().catch(() => ({}));
        ok = res.ok;
        if (!ok) error_message = `WooCommerce HTTP ${res.status}: ${JSON.stringify(responseBody)}`;
        platform_product_id = responseBody?.id ? String(responseBody.id) : null;
        published_url = responseBody?.permalink ?? null;
      }
    } catch (err) {
      ok = false;
      error_message = err instanceof Error ? err.message : String(err);
    }

    // Update product status
    await supabaseAdmin
      .from("products")
      .update({
        status: ok ? "published" : "failed",
        platform_product_id,
        published_url,
        published_platform: ok ? data.platform : null,
      })
      .eq("id", product.id);

    await supabaseAdmin.from("import_logs").insert({
      product_id: product.id,
      client_id: product.client_id,
      platform: data.platform,
      action: "publish",
      status: ok ? "success" : "failure",
      request_payload: requestPayload,
      response_payload: responseBody,
      error_message,
      actor_id: context.userId,
    });

    return { ok, error: error_message, platform_product_id, published_url };
  });

const previewSchema = z.object({ productId: z.string().uuid() });

export const previewImagePayload = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => previewSchema.parse(v))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Access check via the caller's RLS-scoped client, then use admin to sign URLs.
    const { data: product, error: pErr } = await context.supabase
      .from("products")
      .select("id, client_id, title")
      .eq("id", data.productId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!product) throw new Error("Product not found or not accessible");

    const { data: images } = await supabaseAdmin
      .from("product_images")
      .select("storage_path, alt_text, sort_order")
      .eq("product_id", product.id)
      .order("sort_order", { ascending: true });

    const signed: { url: string; alt: string | null; sort_order: number }[] = [];
    for (const img of images ?? []) {
      const { data: s } = await supabaseAdmin.storage
        .from("product-images")
        .createSignedUrl(img.storage_path, 60 * 5);
      if (s?.signedUrl) signed.push({ url: s.signedUrl, alt: img.alt_text, sort_order: img.sort_order });
    }

    return {
      count: signed.length,
      cover: signed[0] ?? null,
      shopify: {
        images: signed.map((i, idx) => ({
          src: i.url,
          alt: i.alt ?? undefined,
        })),
      },
      woocommerce: {
        images: signed.map((i) => ({
          src: i.url,
          alt: i.alt ?? "",
        })),
      },
    };
  });