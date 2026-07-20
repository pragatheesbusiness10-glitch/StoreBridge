
DROP POLICY IF EXISTS "Read variants" ON public.product_variants;
DROP POLICY IF EXISTS "Insert variants" ON public.product_variants;
DROP POLICY IF EXISTS "Update variants" ON public.product_variants;
DROP POLICY IF EXISTS "Delete variants" ON public.product_variants;

CREATE POLICY "Read variants" ON public.product_variants FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM products p WHERE p.id = product_variants.product_id AND private.user_can_access_client(auth.uid(), p.client_id)));

CREATE POLICY "Insert variants" ON public.product_variants FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM products p WHERE p.id = product_variants.product_id AND private.user_can_access_client(auth.uid(), p.client_id)));

CREATE POLICY "Update variants" ON public.product_variants FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM products p WHERE p.id = product_variants.product_id AND private.user_can_access_client(auth.uid(), p.client_id)))
WITH CHECK (EXISTS (SELECT 1 FROM products p WHERE p.id = product_variants.product_id AND private.user_can_access_client(auth.uid(), p.client_id)));

CREATE POLICY "Delete variants" ON public.product_variants FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM products p WHERE p.id = product_variants.product_id AND private.user_can_access_client(auth.uid(), p.client_id)));
