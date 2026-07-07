import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  productIds: z.array(z.string().uuid()).min(1).max(200),
});

export type ImageZipEntry = {
  productId: string;
  productTitle: string;
  clientName: string | null;
  images: { path: string; filename: string; signedUrl: string }[];
};

export const getImagesForZip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => schema.parse(v))
  .handler(async ({ data, context }): Promise<ImageZipEntry[]> => {
    const { supabase } = context;
    const { data: products, error } = await supabase
      .from("products")
      .select("id, title, clients(client_name), product_images(storage_path, sort_order)")
      .in("id", data.productIds);
    if (error) throw new Error(error.message);

    const results: ImageZipEntry[] = [];
    for (const p of products ?? []) {
      const imgs = ((p as any).product_images ?? []).sort(
        (a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
      );
      const signed: ImageZipEntry["images"] = [];
      for (let i = 0; i < imgs.length; i++) {
        const path = imgs[i].storage_path as string;
        const { data: s } = await supabase.storage
          .from("product-images")
          .createSignedUrl(path, 60 * 30);
        if (!s?.signedUrl) continue;
        const ext = path.split(".").pop() || "jpg";
        signed.push({
          path,
          filename: `${String(i + 1).padStart(2, "0")}.${ext}`,
          signedUrl: s.signedUrl,
        });
      }
      results.push({
        productId: (p as any).id,
        productTitle: (p as any).title,
        clientName: (p as any).clients?.client_name ?? null,
        images: signed,
      });
    }
    return results;
  });