-- Helper: true when the user has any recognized platform role.
CREATE OR REPLACE FUNCTION private.has_platform_role(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('super_admin','agency_admin','client')
  );
$$;

REVOKE ALL ON FUNCTION private.has_platform_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_platform_role(uuid) TO authenticated;

-- Tighten catalogue policies to require a role.
DROP POLICY IF EXISTS "Signed-in users can create categories" ON public.product_categories;
CREATE POLICY "Roled users can create categories"
  ON public.product_categories FOR INSERT
  TO authenticated
  WITH CHECK (
    private.has_platform_role(auth.uid())
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "Update own or admin categories" ON public.product_categories;
CREATE POLICY "Roled creator or admin can update categories"
  ON public.product_categories FOR UPDATE
  TO authenticated
  USING (
    private.has_platform_role(auth.uid())
    AND (private.is_admin(auth.uid()) OR created_by = auth.uid())
  )
  WITH CHECK (
    private.has_platform_role(auth.uid())
    AND (private.is_admin(auth.uid()) OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS "Delete own or admin categories" ON public.product_categories;
CREATE POLICY "Roled creator or admin can delete categories"
  ON public.product_categories FOR DELETE
  TO authenticated
  USING (
    private.has_platform_role(auth.uid())
    AND (private.is_admin(auth.uid()) OR created_by = auth.uid())
  );