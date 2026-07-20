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

    // Load size variants (if any)
    const { data: sizeVariants } = await supabaseAdmin
      .from("product_variants")
      .select("size, sku, price, inventory_quantity, sort_order")
      .eq("product_id", product.id)
      .order("sort_order", { ascending: true })
      .order("size", { ascending: true });
    const variants = (sizeVariants ?? []) as Array<{
      size: string;
      sku: string | null;
      price: number | null;
      inventory_quantity: number;
      sort_order: number;
    }>;
    const hasVariants = variants.length > 0;

    // Resolve catalogue/category from product.category (text name) → product_categories row
    let categoryRow: { id: string; name: string; slug: string } | null = null;
    if (product.category) {
      const { data: cat } = await supabaseAdmin
        .from("product_categories")
        .select("id, name, slug")
        .eq("name", product.category)
        .maybeSingle();
      if (cat) categoryRow = cat;
    }

    type CategorySyncStatus = "cached" | "found" | "created";
    type SyncedCategory = { id: string; handle: string | null; status: CategorySyncStatus; name: string };

    // Ensure the catalogue exists on the target platform; returns platform id + how it was resolved.
    async function syncCategoryToPlatform(): Promise<SyncedCategory | null> {
      if (!categoryRow) return null;
      const { data: existing } = await supabaseAdmin
        .from("platform_category_map")
        .select("platform_category_id, platform_handle")
        .eq("integration_id", integ!.id)
        .eq("category_id", categoryRow.id)
        .maybeSingle();
      if (existing) return {
        id: existing.platform_category_id,
        handle: existing.platform_handle,
        status: "cached",
        name: categoryRow.name,
      };

      if (data.platform === "shopify") {
        const token = decryptString(integ!.enc_access_token);
        const version = integ!.api_version || "2024-07";
        const base = integ!.store_url.replace(/\/$/, "");
        // Try to find an existing custom collection with same title, else create one.
        const searchRes = await fetch(
          `${base}/admin/api/${version}/custom_collections.json?title=${encodeURIComponent(categoryRow.name)}&limit=1`,
          { headers: { "X-Shopify-Access-Token": token } },
        );
        const searchBody: any = await searchRes.json().catch(() => ({}));
        let collection = searchBody?.custom_collections?.[0];
        let status: CategorySyncStatus = "found";
        if (!collection) {
          const createRes = await fetch(`${base}/admin/api/${version}/custom_collections.json`, {
            method: "POST",
            headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
            body: JSON.stringify({
              custom_collection: {
                title: categoryRow.name,
                handle: categoryRow.slug,
                published: true,
              },
            }),
          });
          const cb: any = await createRes.json().catch(() => ({}));
          if (!createRes.ok) throw new Error(`Shopify collection create failed: ${JSON.stringify(cb)}`);
          collection = cb.custom_collection;
          status = "created";
        }
        const platformId = String(collection.id);
        await supabaseAdmin.from("platform_category_map").insert({
          integration_id: integ!.id,
          category_id: categoryRow.id,
          platform_category_id: platformId,
          platform_handle: collection.handle ?? null,
        });
        return { id: platformId, handle: collection.handle ?? null, status, name: categoryRow.name };
      } else {
        const key = decryptString(integ!.enc_consumer_key);
        const secret = decryptString(integ!.enc_consumer_secret);
        const auth = Buffer.from(`${key}:${secret}`).toString("base64");
        const base = integ!.store_url.replace(/\/$/, "");
        const searchRes = await fetch(
          `${base}/wp-json/wc/v3/products/categories?slug=${encodeURIComponent(categoryRow.slug)}`,
          { headers: { Authorization: `Basic ${auth}` } },
        );
        const searchBody: any = await searchRes.json().catch(() => []);
        let cat = Array.isArray(searchBody) ? searchBody[0] : null;
        let status: CategorySyncStatus = "found";
        if (!cat) {
          const createRes = await fetch(`${base}/wp-json/wc/v3/products/categories`, {
            method: "POST",
            headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
            body: JSON.stringify({ name: categoryRow.name, slug: categoryRow.slug }),
          });
          const cb: any = await createRes.json().catch(() => ({}));
          if (!createRes.ok) {
            // If duplicate (term_exists), Woo returns the existing id in data
            const existingId = cb?.data?.resource_id;
            if (!existingId) throw new Error(`Woo category create failed: ${JSON.stringify(cb)}`);
            cat = { id: existingId, slug: categoryRow.slug };
            status = "found";
          } else {
            cat = cb;
            status = "created";
          }
        }
        const platformId = String(cat.id);
        await supabaseAdmin.from("platform_category_map").insert({
          integration_id: integ!.id,
          category_id: categoryRow.id,
          platform_category_id: platformId,
          platform_handle: cat.slug ?? null,
        });
        return { id: platformId, handle: cat.slug ?? null, status, name: categoryRow.name };
      }
    }

    let syncedCategory: SyncedCategory | null = null;
    let categorySyncError: string | null = null;
    type AttachStatus = "attached" | "already_attached" | "failed" | "skipped_no_category" | "skipped_no_product";
    let attachStatus: AttachStatus = "skipped_no_category";
    let attachError: string | null = null;
    try {
      syncedCategory = await syncCategoryToPlatform();
    } catch (err) {
      // Fail publish early with clear message
      const msg = err instanceof Error ? err.message : String(err);
      categorySyncError = msg;
      await supabaseAdmin.from("import_logs").insert({
        product_id: product.id,
        client_id: product.client_id,
        platform: data.platform,
        action: "publish",
        status: "failure",
        error_message: `Category sync failed: ${msg}`,
        actor_id: context.userId,
      });
      return {
        ok: false,
        error: `Category sync failed: ${msg}`,
        platform_product_id: null,
        published_url: null,
        categorySync: {
          category: categoryRow?.name ?? null,
          platform: data.platform,
          resolution: "error" as const,
          error: msg,
          attach: "skipped_no_product" as AttachStatus,
          platformCategoryId: null,
          platformHandle: null,
        },
      };
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
        const shopifyVariants = hasVariants
          ? variants.map((v) => ({
              option1: v.size,
              price: (v.price ?? product.price) != null ? String(v.price ?? product.price) : undefined,
              sku: v.sku ?? undefined,
              inventory_management: "shopify",
              inventory_quantity: v.inventory_quantity ?? 0,
            }))
          : [
              {
                price: product.price != null ? String(product.price) : undefined,
                compare_at_price:
                  product.compare_at_price != null ? String(product.compare_at_price) : undefined,
                sku: product.sku ?? undefined,
                barcode: product.barcode ?? undefined,
                inventory_management: "shopify",
                inventory_quantity: product.inventory_quantity ?? 0,
              },
            ];
        requestPayload = {
          product: {
            title: product.title,
            body_html: product.description ?? "",
            vendor: product.vendor ?? undefined,
            product_type: product.product_type ?? categoryRow?.name ?? undefined,
            tags: (product.tags ?? []).join(", "),
            status: "active",
            options: hasVariants ? [{ name: "Size", values: variants.map((v) => v.size) }] : undefined,
            variants: shopifyVariants,
            images: imageUrls.map((i) => ({ src: i.url, alt: i.alt ?? undefined })),
            metafields_global_title_tag: product.seo_title ?? undefined,
            metafields_global_description_tag: product.seo_description ?? undefined,
          },
        };
        const base = integ.store_url.replace(/\/$/, "");
        const existingId = product.platform_product_id && product.published_platform === "shopify"
          ? product.platform_product_id
          : null;
        const url = existingId
          ? `${base}/admin/api/${version}/products/${existingId}.json`
          : `${base}/admin/api/${version}/products.json`;
        const res = await fetch(url, {
          method: existingId ? "PUT" : "POST",
          headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
          body: JSON.stringify(
            existingId ? { product: { id: Number(existingId), ...requestPayload.product } } : requestPayload,
          ),
        });
        responseBody = await res.json().catch(() => ({}));
        ok = res.ok;
        if (!ok) error_message = `Shopify HTTP ${res.status}: ${JSON.stringify(responseBody)}`;
        platform_product_id = responseBody?.product?.id ? String(responseBody.product.id) : null;
        if (platform_product_id) {
          published_url = `${base}/admin/products/${platform_product_id}`;
        }
        // Attach product to synced collection via collect API
        if (ok && platform_product_id && syncedCategory) {
          const collectRes = await fetch(
            `${base}/admin/api/${version}/collects.json`,
            {
              method: "POST",
              headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
              body: JSON.stringify({
                collect: { product_id: Number(platform_product_id), collection_id: Number(syncedCategory.id) },
              }),
            },
          );
          if (collectRes.ok) {
            attachStatus = "attached";
          } else if (collectRes.status === 422) {
            attachStatus = "already_attached";
          } else {
            const cb = await collectRes.json().catch(() => ({}));
            attachStatus = "failed";
            attachError = `Shopify collect ${collectRes.status}: ${JSON.stringify(cb)}`;
            error_message = `Product created but collection attach failed: ${JSON.stringify(cb)}`;
          }
        } else if (ok && platform_product_id && !syncedCategory) {
          attachStatus = "skipped_no_category";
        } else if (!platform_product_id) {
          attachStatus = "skipped_no_product";
        }
      } else {
        const key = decryptString(integ.enc_consumer_key);
        const secret = decryptString(integ.enc_consumer_secret);
        const base = integ.store_url.replace(/\/$/, "");
        const auth = Buffer.from(`${key}:${secret}`).toString("base64");
        requestPayload = {
          name: product.title,
          type: hasVariants ? "variable" : "simple",
          regular_price: hasVariants
            ? undefined
            : product.price != null ? String(product.price) : undefined,
          sale_price: product.compare_at_price != null ? String(product.compare_at_price) : undefined,
          description: product.description ?? "",
          short_description: product.short_description ?? "",
          sku: hasVariants ? undefined : (product.sku ?? undefined),
          manage_stock: hasVariants ? false : true,
          stock_quantity: hasVariants ? undefined : (product.inventory_quantity ?? 0),
          status: "publish",
          attributes: hasVariants
            ? [
                {
                  name: "Size",
                  visible: true,
                  variation: true,
                  options: variants.map((v) => v.size),
                },
              ]
            : undefined,
          categories: syncedCategory
            ? [{ id: Number(syncedCategory.id) }]
            : product.woo_category
              ? [{ name: product.woo_category }]
              : undefined,
          tags: (product.tags ?? []).map((name: string) => ({ name })),
          images: imageUrls.map((i) => ({ src: i.url, alt: i.alt ?? "" })),
          meta_data: [
            product.seo_title ? { key: "_yoast_wpseo_title", value: product.seo_title } : null,
            product.seo_description ? { key: "_yoast_wpseo_metadesc", value: product.seo_description } : null,
          ].filter(Boolean),
        };
        const existingId = product.platform_product_id && product.published_platform === "woocommerce"
          ? product.platform_product_id
          : null;
        const url = existingId
          ? `${base}/wp-json/wc/v3/products/${existingId}`
          : `${base}/wp-json/wc/v3/products`;
        const res = await fetch(url, {
          method: existingId ? "PUT" : "POST",
          headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
          body: JSON.stringify(requestPayload),
        });
        responseBody = await res.json().catch(() => ({}));
        ok = res.ok;
        if (!ok) error_message = `WooCommerce HTTP ${res.status}: ${JSON.stringify(responseBody)}`;
        platform_product_id = responseBody?.id ? String(responseBody.id) : null;
        published_url = responseBody?.permalink ?? null;
        // In WooCommerce we send category IDs in the product payload itself.
        if (ok && platform_product_id && syncedCategory) attachStatus = "attached";
        else if (ok && platform_product_id) attachStatus = "skipped_no_category";
        else attachStatus = "skipped_no_product";

        // Upsert size variations
        if (ok && platform_product_id && hasVariants) {
          // Fetch existing variations to update or create as needed
          const listRes = await fetch(
            `${base}/wp-json/wc/v3/products/${platform_product_id}/variations?per_page=100`,
            { headers: { Authorization: `Basic ${auth}` } },
          );
          const existingVariations: any[] = listRes.ok ? await listRes.json().catch(() => []) : [];
          const bySize = new Map<string, any>();
          for (const v of existingVariations) {
            const sizeAttr = (v.attributes ?? []).find(
              (a: any) => String(a.name).toLowerCase() === "size",
            );
            if (sizeAttr?.option) bySize.set(String(sizeAttr.option).toUpperCase(), v);
          }

          const variationErrors: string[] = [];
          for (const v of variants) {
            const payload = {
              regular_price:
                (v.price ?? product.price) != null ? String(v.price ?? product.price) : undefined,
              sku: v.sku ?? undefined,
              manage_stock: true,
              stock_quantity: v.inventory_quantity ?? 0,
              attributes: [{ name: "Size", option: v.size }],
            };
            const existing = bySize.get(v.size.toUpperCase());
            const vUrl = existing
              ? `${base}/wp-json/wc/v3/products/${platform_product_id}/variations/${existing.id}`
              : `${base}/wp-json/wc/v3/products/${platform_product_id}/variations`;
            const vRes = await fetch(vUrl, {
              method: existing ? "PUT" : "POST",
              headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            if (!vRes.ok) {
              const vb = await vRes.json().catch(() => ({}));
              variationErrors.push(`${v.size}: ${JSON.stringify(vb)}`);
            }
          }
          if (variationErrors.length > 0) {
            error_message = `Product saved but variation sync had errors: ${variationErrors.join("; ")}`;
          }
        }
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

    return {
      ok,
      error: error_message,
      platform_product_id,
      published_url,
      categorySync: {
        category: categoryRow?.name ?? null,
        platform: data.platform,
        resolution: (syncedCategory?.status ?? (categoryRow ? "error" : "none")) as
          | "cached" | "found" | "created" | "error" | "none",
        error: categorySyncError,
        attach: attachStatus,
        attachError,
        platformCategoryId: syncedCategory?.id ?? null,
        platformHandle: syncedCategory?.handle ?? null,
      },
    };
  });

const previewSchema = z.object({ productId: z.string().uuid() });

const categorySyncSchema = z.object({ productId: z.string().uuid() });

/**
 * Read-only preview: for the given product, report the category-sync state
 * against each active integration for its client. No external API calls.
 */
export const getCategorySyncStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => categorySyncSchema.parse(v))
  .handler(async ({ data, context }) => {
    const { data: product, error } = await context.supabase
      .from("products")
      .select("id, client_id, category, published_platform, platform_product_id")
      .eq("id", data.productId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!product) throw new Error("Product not found or not accessible");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let categoryRow: { id: string; name: string; slug: string } | null = null;
    if (product.category) {
      const { data: cat } = await supabaseAdmin
        .from("product_categories")
        .select("id, name, slug")
        .eq("name", product.category)
        .maybeSingle();
      if (cat) categoryRow = cat;
    }

    const { data: integrations } = await supabaseAdmin
      .from("store_integrations")
      .select("id, platform, store_url, is_active")
      .eq("client_id", product.client_id)
      .eq("is_active", true);

    const results: Array<{
      platform: "shopify" | "woocommerce";
      integrationId: string;
      storeUrl: string;
      status: "mapped" | "will_create" | "no_category";
      platformCategoryId: string | null;
      platformHandle: string | null;
    }> = [];

    for (const integ of (integrations ?? []) as any[]) {
      if (!categoryRow) {
        results.push({
          platform: integ.platform,
          integrationId: integ.id,
          storeUrl: integ.store_url,
          status: "no_category",
          platformCategoryId: null,
          platformHandle: null,
        });
        continue;
      }
      const { data: mapped } = await supabaseAdmin
        .from("platform_category_map")
        .select("platform_category_id, platform_handle")
        .eq("integration_id", integ.id)
        .eq("category_id", categoryRow.id)
        .maybeSingle();
      results.push({
        platform: integ.platform,
        integrationId: integ.id,
        storeUrl: integ.store_url,
        status: mapped ? "mapped" : "will_create",
        platformCategoryId: mapped?.platform_category_id ?? null,
        platformHandle: mapped?.platform_handle ?? null,
      });
    }

    return {
      category: categoryRow?.name ?? null,
      categorySlug: categoryRow?.slug ?? null,
      hasCategory: !!categoryRow,
      integrations: results,
    };
  });

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