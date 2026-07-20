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
      .select("*, product_images(storage_path, sort_order, alt_text), product_variants(size, sku, price, inventory_quantity)")
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
        "Published", "Option1 Name", "Option1 Value",
        "Variant SKU", "Variant Price", "Variant Compare At Price",
        "Variant Inventory Qty", "Variant Barcode", "SEO Title", "SEO Description",
      ];
      const rows: Record<string, unknown>[] = [];
      for (const p of (products ?? []) as any[]) {
        const handle = p.slug || p.title?.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const variants = (p.product_variants ?? []) as any[];
        const base = {
          "Handle": handle,
          "Title": p.title,
          "Body (HTML)": p.description ?? "",
          "Vendor": p.vendor ?? "",
          "Type": p.product_type ?? "",
          "Tags": (p.tags ?? []).join(", "),
          "Published": "TRUE",
          "Variant Compare At Price": p.compare_at_price ?? "",
          "Variant Barcode": p.barcode ?? "",
          "SEO Title": p.seo_title ?? "",
          "SEO Description": p.seo_description ?? "",
        };
        if (variants.length === 0) {
          rows.push({
            ...base,
            "Option1 Name": "",
            "Option1 Value": "",
            "Variant SKU": p.sku ?? "",
            "Variant Price": p.price ?? "",
            "Variant Inventory Qty": p.inventory_quantity ?? 0,
          });
        } else {
          variants.forEach((v, idx) => {
            rows.push({
              ...(idx === 0 ? base : { "Handle": handle }),
              "Option1 Name": "Size",
              "Option1 Value": v.size,
              "Variant SKU": v.sku ?? "",
              "Variant Price": v.price ?? p.price ?? "",
              "Variant Inventory Qty": v.inventory_quantity ?? 0,
            });
          });
        }
      }
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
      "Parent", "Attribute 1 name", "Attribute 1 value(s)", "Attribute 1 visible", "Attribute 1 global",
    ];
    const rows: Record<string, unknown>[] = [];
    for (const p of (products ?? []) as any[]) {
      const variants = (p.product_variants ?? []) as any[];
      const parentSku = p.sku || (p.slug ?? p.title?.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
      const totalStock = variants.length
        ? variants.reduce((s, v) => s + (v.inventory_quantity ?? 0), 0)
        : (p.inventory_quantity ?? 0);
      rows.push({
        "ID": "",
        "Type": variants.length > 0 ? "variable" : "simple",
        "SKU": parentSku,
        "Name": p.title,
        "Published": 1,
        "Short description": p.short_description ?? "",
        "Description": p.description ?? "",
        "Tax status": "taxable",
        "In stock?": totalStock > 0 ? 1 : 0,
        "Stock": variants.length > 0 ? "" : totalStock,
        "Regular price": variants.length > 0 ? "" : (p.price ?? ""),
        "Sale price": p.compare_at_price ?? "",
        "Categories": p.woo_category ?? "",
        "Tags": (p.tags ?? []).join(", "),
        "Meta: _yoast_wpseo_title": p.seo_title ?? "",
        "Meta: _yoast_wpseo_metadesc": p.seo_description ?? "",
        "Parent": "",
        "Attribute 1 name": variants.length > 0 ? "Size" : "",
        "Attribute 1 value(s)": variants.length > 0 ? variants.map((v) => v.size).join(" | ") : "",
        "Attribute 1 visible": variants.length > 0 ? 1 : "",
        "Attribute 1 global": variants.length > 0 ? 1 : "",
      });
      for (const v of variants) {
        rows.push({
          "ID": "",
          "Type": "variation",
          "SKU": v.sku ?? "",
          "Name": `${p.title} - ${v.size}`,
          "Published": 1,
          "Short description": "",
          "Description": "",
          "Tax status": "taxable",
          "In stock?": (v.inventory_quantity ?? 0) > 0 ? 1 : 0,
          "Stock": v.inventory_quantity ?? 0,
          "Regular price": v.price ?? p.price ?? "",
          "Sale price": "",
          "Categories": "",
          "Tags": "",
          "Meta: _yoast_wpseo_title": "",
          "Meta: _yoast_wpseo_metadesc": "",
          "Parent": parentSku,
          "Attribute 1 name": "Size",
          "Attribute 1 value(s)": v.size,
          "Attribute 1 visible": 1,
          "Attribute 1 global": 1,
        });
      }
    }
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
      .select("*, clients(client_name, store_type), product_images(storage_path, alt_text, sort_order), product_variants(size, sku, price, inventory_quantity)")
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
        "Option1 Name", "Option1 Value",
        "Variant SKU", "Variant Price", "Variant Compare At Price",
        "Variant Inventory Qty", "Variant Barcode", "Variant Inventory Management",
        "SEO Title", "SEO Description", "Image Src", "Image Alt Text", "Image Position",
      ];
      const rows: Record<string, unknown>[] = [];
      for (const p of scoped as any[]) {
        const imgs = signedByProduct.get(p.id) ?? [];
        const handle = p.slug || p.title?.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const variants = (p.product_variants ?? []) as any[];
        const baseCommon = {
          "Handle": handle,
          "Title": p.title,
          "Body (HTML)": p.description ?? "",
          "Vendor": p.vendor ?? "",
          "Type": p.product_type ?? "",
          "Tags": (p.tags ?? []).join(", "),
          "Status": "active",
          "Variant Compare At Price": p.compare_at_price ?? "",
          "Variant Barcode": p.barcode ?? "",
          "Variant Inventory Management": "shopify",
          "SEO Title": p.seo_title ?? "",
          "SEO Description": p.seo_description ?? "",
        };
        const variantRows = variants.length > 0
          ? variants.map((v) => ({
              "Option1 Name": "Size",
              "Option1 Value": v.size,
              "Variant SKU": v.sku ?? "",
              "Variant Price": v.price ?? p.price ?? "",
              "Variant Inventory Qty": v.inventory_quantity ?? 0,
            }))
          : [{
              "Option1 Name": "",
              "Option1 Value": "",
              "Variant SKU": p.sku ?? "",
              "Variant Price": p.price ?? "",
              "Variant Inventory Qty": p.inventory_quantity ?? 0,
            }];
        const maxRows = Math.max(variantRows.length, imgs.length, 1);
        for (let i = 0; i < maxRows; i++) {
          const vr = variantRows[i];
          const url = imgs[i];
          const isFirst = i === 0;
          rows.push({
            ...(isFirst ? baseCommon : { "Handle": handle }),
            ...(vr ?? {
              "Option1 Name": "", "Option1 Value": "",
              "Variant SKU": "", "Variant Price": "", "Variant Inventory Qty": "",
            }),
            "Image Src": url ?? "",
            "Image Alt Text": "",
            "Image Position": url ? i + 1 : "",
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
      "Parent", "Attribute 1 name", "Attribute 1 value(s)", "Attribute 1 visible", "Attribute 1 global",
    ];
    const rows: Record<string, unknown>[] = [];
    for (const p of scoped as any[]) {
      const variants = ((p as any).product_variants ?? []) as any[];
      const parentSku = p.sku || (p.slug ?? p.title?.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
      const totalStock = variants.length
        ? variants.reduce((s, v) => s + (v.inventory_quantity ?? 0), 0)
        : (p.inventory_quantity ?? 0);
      rows.push({
        "ID": "",
        "Type": variants.length > 0 ? "variable" : "simple",
        "SKU": parentSku,
        "Name": p.title,
        "Status": "publish",
        "Short description": p.short_description ?? "",
        "Description": p.description ?? "",
        "Tax status": "taxable",
        "Manage stock": 1,
        "In stock?": totalStock > 0 ? 1 : 0,
        "Stock": variants.length > 0 ? "" : totalStock,
        "Regular price": variants.length > 0 ? "" : (p.price ?? ""),
        "Sale price": p.compare_at_price ?? "",
        "Categories": p.woo_category ?? "",
        "Tags": (p.tags ?? []).join(", "),
        "Images": (signedByProduct.get(p.id) ?? []).join(" | "),
        "Meta: _yoast_wpseo_title": p.seo_title ?? "",
        "Meta: _yoast_wpseo_metadesc": p.seo_description ?? "",
        "Parent": "",
        "Attribute 1 name": variants.length > 0 ? "Size" : "",
        "Attribute 1 value(s)": variants.length > 0 ? variants.map((v) => v.size).join(" | ") : "",
        "Attribute 1 visible": variants.length > 0 ? 1 : "",
        "Attribute 1 global": variants.length > 0 ? 1 : "",
      });
      for (const v of variants) {
        rows.push({
          "ID": "",
          "Type": "variation",
          "SKU": v.sku ?? "",
          "Name": `${p.title} - ${v.size}`,
          "Status": "publish",
          "Short description": "",
          "Description": "",
          "Tax status": "taxable",
          "Manage stock": 1,
          "In stock?": (v.inventory_quantity ?? 0) > 0 ? 1 : 0,
          "Stock": v.inventory_quantity ?? 0,
          "Regular price": v.price ?? p.price ?? "",
          "Sale price": "",
          "Categories": "",
          "Tags": "",
          "Images": "",
          "Meta: _yoast_wpseo_title": "",
          "Meta: _yoast_wpseo_metadesc": "",
          "Parent": parentSku,
          "Attribute 1 name": "Size",
          "Attribute 1 value(s)": v.size,
          "Attribute 1 visible": 1,
          "Attribute 1 global": 1,
        });
      }
    }
    return {
      filename: `woocommerce-approved-feed-${stamp}.csv`,
      contentType: "text/csv",
      content: toCsv(rows, headers),
      productCount: scoped.length,
    };
  });