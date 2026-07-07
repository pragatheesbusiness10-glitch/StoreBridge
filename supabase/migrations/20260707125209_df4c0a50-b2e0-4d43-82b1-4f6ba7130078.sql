
-- Scope agency admins to their assigned clients; keep super admins global.

CREATE OR REPLACE FUNCTION public.user_can_access_client(_user_id uuid, _client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.clients
       WHERE id = _client_id
         AND agency_id = _user_id
         AND public.has_role(_user_id, 'agency_admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.client_members
       WHERE client_id = _client_id
         AND user_id = _user_id
    )
$$;

CREATE OR REPLACE FUNCTION public.user_can_manage_client(_user_id uuid, _client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.clients
       WHERE id = _client_id
         AND agency_id = _user_id
         AND public.has_role(_user_id, 'agency_admin')
    )
$$;

-- clients: SELECT scoped, writes scoped to owning agency admin or super admin
DROP POLICY IF EXISTS "Clients read own client" ON public.clients;
CREATE POLICY "Clients read scoped" ON public.clients
  FOR SELECT TO authenticated
  USING (public.user_can_access_client(auth.uid(), id));

DROP POLICY IF EXISTS "Admins update clients" ON public.clients;
CREATE POLICY "Manage clients update" ON public.clients
  FOR UPDATE TO authenticated
  USING (public.user_can_manage_client(auth.uid(), id))
  WITH CHECK (public.user_can_manage_client(auth.uid(), id));

DROP POLICY IF EXISTS "Admins delete clients" ON public.clients;
CREATE POLICY "Manage clients delete" ON public.clients
  FOR DELETE TO authenticated
  USING (public.user_can_manage_client(auth.uid(), id));

-- Keep INSERT admin (super or agency admin). Server fn assigns agency_id.
-- (existing "Admins insert clients" stays.)

-- products
DROP POLICY IF EXISTS "Read products" ON public.products;
CREATE POLICY "Read products" ON public.products
  FOR SELECT TO authenticated
  USING (public.user_can_access_client(auth.uid(), client_id));

DROP POLICY IF EXISTS "Insert products" ON public.products;
CREATE POLICY "Insert products" ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_client(auth.uid(), client_id));

DROP POLICY IF EXISTS "Update products" ON public.products;
CREATE POLICY "Update products" ON public.products
  FOR UPDATE TO authenticated
  USING (public.user_can_access_client(auth.uid(), client_id))
  WITH CHECK (public.user_can_access_client(auth.uid(), client_id));

DROP POLICY IF EXISTS "Delete products" ON public.products;
CREATE POLICY "Delete products" ON public.products
  FOR DELETE TO authenticated
  USING (public.user_can_access_client(auth.uid(), client_id));

-- client_members: manage restricted to super_admin or owning agency admin
DROP POLICY IF EXISTS "Members read own memberships" ON public.client_members;
CREATE POLICY "Members read scoped" ON public.client_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.user_can_manage_client(auth.uid(), client_id)
  );

DROP POLICY IF EXISTS "Admins manage memberships insert" ON public.client_members;
CREATE POLICY "Manage memberships insert" ON public.client_members
  FOR INSERT TO authenticated
  WITH CHECK (public.user_can_manage_client(auth.uid(), client_id));

DROP POLICY IF EXISTS "Admins manage memberships delete" ON public.client_members;
CREATE POLICY "Manage memberships delete" ON public.client_members
  FOR DELETE TO authenticated
  USING (public.user_can_manage_client(auth.uid(), client_id));

-- product_images: scope via parent product's client
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT polname FROM pg_policy WHERE polrelid = 'public.product_images'::regclass LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.product_images', p.polname);
  END LOOP;
END $$;

CREATE POLICY "Read product images" ON public.product_images
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.products pr
    WHERE pr.id = product_images.product_id
      AND public.user_can_access_client(auth.uid(), pr.client_id)
  ));

CREATE POLICY "Write product images" ON public.product_images
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.products pr
    WHERE pr.id = product_images.product_id
      AND public.user_can_access_client(auth.uid(), pr.client_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.products pr
    WHERE pr.id = product_images.product_id
      AND public.user_can_access_client(auth.uid(), pr.client_id)
  ));

-- store_integrations: managers only (super_admin or owning agency admin)
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT polname FROM pg_policy WHERE polrelid = 'public.store_integrations'::regclass LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.store_integrations', p.polname);
  END LOOP;
END $$;

CREATE POLICY "Managers read integrations" ON public.store_integrations
  FOR SELECT TO authenticated
  USING (public.user_can_manage_client(auth.uid(), client_id));

CREATE POLICY "Managers write integrations" ON public.store_integrations
  FOR ALL TO authenticated
  USING (public.user_can_manage_client(auth.uid(), client_id))
  WITH CHECK (public.user_can_manage_client(auth.uid(), client_id));

-- import_logs: read scoped
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT polname FROM pg_policy WHERE polrelid = 'public.import_logs'::regclass LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.import_logs', p.polname);
  END LOOP;
END $$;

CREATE POLICY "Read import logs" ON public.import_logs
  FOR SELECT TO authenticated
  USING (public.user_can_access_client(auth.uid(), client_id));

CREATE POLICY "Managers write import logs" ON public.import_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.user_can_manage_client(auth.uid(), client_id));
