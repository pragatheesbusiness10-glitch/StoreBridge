CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('super_admin'::public.app_role, 'agency_admin'::public.app_role)
  );
$$;

DROP POLICY IF EXISTS "Delete own or admin categories" ON public.product_categories;
CREATE POLICY "Delete own or admin categories"
ON public.product_categories
FOR DELETE
TO authenticated
USING (public.is_admin(auth.uid()) OR created_by = auth.uid());

DROP POLICY IF EXISTS "Update own or admin categories" ON public.product_categories;
CREATE POLICY "Update own or admin categories"
ON public.product_categories
FOR UPDATE
TO authenticated
USING (public.is_admin(auth.uid()) OR created_by = auth.uid())
WITH CHECK (public.is_admin(auth.uid()) OR created_by = auth.uid());