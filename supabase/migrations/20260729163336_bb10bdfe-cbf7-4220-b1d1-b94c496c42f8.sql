DROP POLICY IF EXISTS "Anyone signed in can view categories" ON public.product_categories;

CREATE POLICY "Creators and admins can view categories"
ON public.product_categories
FOR SELECT
TO authenticated
USING (
  created_by = auth.uid()
  OR private.is_admin(auth.uid())
);