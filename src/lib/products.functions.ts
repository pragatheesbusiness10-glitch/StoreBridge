import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAudit } from "@/lib/admin.functions";

const productInputSchema = z.object({
  client_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000).nullable().optional(),
  short_description: z.string().max(20000).nullable().optional(),
  price: z.number().finite().nullable().optional(),
  compare_at_price: z.number().finite().nullable().optional(),
  cost_price: z.number().finite().nullable().optional(),
  sku: z.string().max(80).nullable().optional(),
  barcode: z.string().max(80).nullable().optional(),
  inventory_quantity: z.number().int().nullable().optional(),
  category: z.string().nullable().optional(),
  product_type: z.string().nullable().optional(),
  vendor: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  collection_name: z.string().nullable().optional(),
  woo_category: z.string().nullable().optional(),
  seo_title: z.string().nullable().optional(),
  seo_description: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  status: z.enum(["draft", "submitted"]),
});

export const createProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value) => productInputSchema.parse(value))
  .handler(async ({ data, context }) => {
    // Access is enforced by RLS on the products INSERT policy.
    const { data: row, error } = await context.supabase
      .from("products")
      .insert({
        ...data,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => z.object({ productId: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    // Verify access using the user's authenticated client (RLS-enforced).
    const { data: product, error: readErr } = await context.supabase
      .from("products")
      .select("id, title, client_id, created_by")
      .eq("id", data.productId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!product) throw new Error("Product not found or access denied");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Cascade delete dependent rows.
    await supabaseAdmin.from("product_variants").delete().eq("product_id", data.productId);
    await supabaseAdmin.from("product_images").delete().eq("product_id", data.productId);
    await supabaseAdmin.from("platform_category_map").delete().eq("product_id", data.productId);

    const { error } = await supabaseAdmin.from("products").delete().eq("id", data.productId);
    if (error) throw new Error(error.message);

    await writeAudit(context, {
      action: "product.delete",
      targetType: "product",
      targetId: data.productId,
      clientId: product.client_id,
      metadata: { title: product.title },
    });
    return { ok: true };
  });