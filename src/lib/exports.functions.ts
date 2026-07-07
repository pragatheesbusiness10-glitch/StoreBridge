import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  productIds: z.array(z.string().uuid()).min(1).max(500),
  format: z.enum(["shopify_csv", "woo_csv", "json"]),
});

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: Record<string, unknown>[], headers: string[]): string {
  const head = headers.join(",");
  const body = rows.map((r) => headers.map((h) => csvEscape(r[h])).join(",")).join("\n");
  return head + "\n" + body;
}

export const generateExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => schema.parse(v))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: products, error } = await supabase
      .from("products")
      .select("*, product_images(storage_path, sort_order, alt_text)")
      .in("id", data.productIds);
    if (error) throw new Error(error.message);

    if (data.format === "json") {
      return {
        filename: `products-${Date.now()}.json`,
        contentType: "application/json",
        content: JSON.stringify(products, null, 2),
      };
    }

    if (data.format === "shopify_csv") {
      const headers = [
        "Handle", "Title", "Body (HTML)", "Vendor", "Type", "Tags",
        "Published", "Variant SKU", "Variant Price", "Variant Compare At Price",
        "Variant Inventory Qty", "Variant Barcode", "SEO Title", "SEO Description",
      ];
      const rows = (products ?? []).map((p: any) => ({
        "Handle": p.slug || p.title?.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        "Title": p.title,
        "Body (HTML)": p.description ?? "",
        "Vendor": p.vendor ?? "",
        "Type": p.product_type ?? "",
        "Tags": (p.tags ?? []).join(", "),
        "Published": "TRUE",
        "Variant SKU": p.sku ?? "",
        "Variant Price": p.price ?? "",
        "Variant Compare At Price": p.compare_at_price ?? "",
        "Variant Inventory Qty": p.inventory_quantity ?? 0,
        "Variant Barcode": p.barcode ?? "",
        "SEO Title": p.seo_title ?? "",
        "SEO Description": p.seo_description ?? "",
      }));
      return {
        filename: `shopify-${Date.now()}.csv`,
        contentType: "text/csv",
        content: toCsv(rows, headers),
      };
    }

    // woo_csv
    const headers = [
      "ID", "Type", "SKU", "Name", "Published", "Short description", "Description",
      "Tax status", "In stock?", "Stock", "Regular price", "Sale price",
      "Categories", "Tags", "Meta: _yoast_wpseo_title", "Meta: _yoast_wpseo_metadesc",
    ];
    const rows = (products ?? []).map((p: any) => ({
      "ID": "",
      "Type": "simple",
      "SKU": p.sku ?? "",
      "Name": p.title,
      "Published": 1,
      "Short description": p.short_description ?? "",
      "Description": p.description ?? "",
      "Tax status": "taxable",
      "In stock?": (p.inventory_quantity ?? 0) > 0 ? 1 : 0,
      "Stock": p.inventory_quantity ?? 0,
      "Regular price": p.price ?? "",
      "Sale price": p.compare_at_price ?? "",
      "Categories": p.woo_category ?? "",
      "Tags": (p.tags ?? []).join(", "),
      "Meta: _yoast_wpseo_title": p.seo_title ?? "",
      "Meta: _yoast_wpseo_metadesc": p.seo_description ?? "",
    }));
    return {
      filename: `woocommerce-${Date.now()}.csv`,
      contentType: "text/csv",
      content: toCsv(rows, headers),
    };
  });

const approvedSchema = z.object({
  platform: z.enum(["shopify", "woocommerce"]),
  clientId: z.string().uuid().nullable().optional(),
});

/**
 * Export the exact feed pushed to Shopify / WooCommerce for products in
 * status='approved'. Column set mirrors the JSON payloads built in
 * publish.functions.ts so the CSV row-for-row matches what would be sent.
 */
export const exportApprovedFeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => approvedSchema.parse(v))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let q = supabase
      .from("products")
      .select("*, clients(client_name, store_type), product_images(storage_path, alt_text, sort_order)")
      .eq("status", "approved")
      .order("updated_at", { ascending: false })
      .limit(2000);
    if (data.clientId) q = q.eq("client_id", data.clientId);
    const { data: products, error } = await q;
    if (error) throw new Error(error.message);

    // Only keep products whose client uses (or is being exported for) this platform
    const scoped = (products ?? []).filter((p: any) =>
      !p.clients?.store_type || p.clients.store_type === data.platform,
    );

    // Sign image URLs so the CSV contains fetchable image sources (7 days).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const signedByProduct = new Map<string, string[]>();
    for (const p of scoped) {
      const imgs = ((p as any).product_images ?? []).slice().sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      const urls: string[] = [];
      for (const img of imgs) {
        const { data: signed } = await supabaseAdmin.storage
          .from("product-images")
          .createSignedUrl(img.storage_path, 60 * 60 * 24 * 7);
        if (signed?.signedUrl) urls.push(signed.signedUrl);
      }
      signedByProduct.set(p.id, urls);
    }

    const stamp = new Date().toISOString().slice(0, 10);

    if (data.platform === "shopify") {
      // Mirrors Shopify Admin API product payload (publish.functions.ts).
      const headers = [
        "Handle", "Title", "Body (HTML)", "Vendor", "Type", "Tags", "Status",
        "Variant SKU", "Variant Price", "Variant Compare At Price",
        "Variant Inventory Qty", "Variant Barcode", "Variant Inventory Management",
        "SEO Title", "SEO Description", "Image Src", "Image Alt Text", "Image Position",
      ];
      const rows: Record<string, unknown>[] = [];
      for (const p of scoped as any[]) {
        const imgs = signedByProduct.get(p.id) ?? [];
        const handle = p.slug || p.title?.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const base = {
          "Handle": handle,
          "Title": p.title,
          "Body (HTML)": p.description ?? "",
          "Vendor": p.vendor ?? "",
          "Type": p.product_type ?? "",
          "Tags": (p.tags ?? []).join(", "),
          "Status": "active",
          "Variant SKU": p.sku ?? "",
          "Variant Price": p.price ?? "",
          "Variant Compare At Price": p.compare_at_price ?? "",
          "Variant Inventory Qty": p.inventory_quantity ?? 0,
          "Variant Barcode": p.barcode ?? "",
          "Variant Inventory Management": "shopify",
          "SEO Title": p.seo_title ?? "",
          "SEO Description": p.seo_description ?? "",
        };
        if (imgs.length === 0) {
          rows.push({ ...base, "Image Src": "", "Image Alt Text": "", "Image Position": "" });
        } else {
          imgs.forEach((url, idx) => {
            rows.push({
              ...(idx === 0 ? base : { "Handle": handle }),
              "Image Src": url,
              "Image Alt Text": "",
              "Image Position": idx + 1,
            });
          });
        }
      }
      return {
        filename: `shopify-approved-feed-${stamp}.csv`,
        contentType: "text/csv",
        content: toCsv(rows, headers),
        productCount: scoped.length,
      };
    }

    // WooCommerce — mirrors the WC REST v3 product body.
    const headers = [
      "ID", "Type", "SKU", "Name", "Status", "Short description", "Description",
      "Tax status", "Manage stock", "In stock?", "Stock", "Regular price", "Sale price",
      "Categories", "Tags", "Images",
      "Meta: _yoast_wpseo_title", "Meta: _yoast_wpseo_metadesc",
    ];
    const rows = scoped.map((p: any) => ({
      "ID": "",
      "Type": "simple",
      "SKU": p.sku ?? "",
      "Name": p.title,
      "Status": "publish",
      "Short description": p.short_description ?? "",
      "Description": p.description ?? "",
      "Tax status": "taxable",
      "Manage stock": 1,
      "In stock?": (p.inventory_quantity ?? 0) > 0 ? 1 : 0,
      "Stock": p.inventory_quantity ?? 0,
      "Regular price": p.price ?? "",
      "Sale price": p.compare_at_price ?? "",
      "Categories": p.woo_category ?? "",
      "Tags": (p.tags ?? []).join(", "),
      "Images": (signedByProduct.get(p.id) ?? []).join(" | "),
      "Meta: _yoast_wpseo_title": p.seo_title ?? "",
      "Meta: _yoast_wpseo_metadesc": p.seo_description ?? "",
    }));
    return {
      filename: `woocommerce-approved-feed-${stamp}.csv`,
      contentType: "text/csv",
      content: toCsv(rows, headers),
      productCount: scoped.length,
    };
  });