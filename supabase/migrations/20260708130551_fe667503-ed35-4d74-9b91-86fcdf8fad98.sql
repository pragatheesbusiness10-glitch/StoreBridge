ALTER TABLE public.product_categories ALTER COLUMN created_by SET DEFAULT auth.uid();

DROP POLICY IF EXISTS "Admins can update categories" ON public.product_categories;
DROP POLICY IF EXISTS "Admins can delete categories" ON public.product_categories;

CREATE POLICY "Update own or admin categories"
ON public.product_categories
FOR UPDATE
TO authenticated
USING (public.is_admin(auth.uid()) OR created_by = auth.uid())
WITH CHECK (public.is_admin(auth.uid()) OR created_by = auth.uid());

CREATE POLICY "Delete own or admin categories"
ON public.product_categories
FOR DELETE
TO authenticated
USING (public.is_admin(auth.uid()) OR created_by = auth.uid());