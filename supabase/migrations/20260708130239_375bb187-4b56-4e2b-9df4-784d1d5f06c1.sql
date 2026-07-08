DROP POLICY IF EXISTS "Admins can insert categories" ON public.product_categories;
CREATE POLICY "Authenticated users can insert categories"
ON public.product_categories
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);