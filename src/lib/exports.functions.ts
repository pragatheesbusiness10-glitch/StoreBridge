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