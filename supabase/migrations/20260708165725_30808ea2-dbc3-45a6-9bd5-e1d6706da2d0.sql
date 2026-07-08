
-- 1) Fix mutable search_path on tg_set_updated_at
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- 2) Revoke EXECUTE on SECURITY DEFINER helper functions from anon/authenticated.
-- These are called from RLS policies and other SECURITY DEFINER functions, which
-- run as the definer, so revoking direct EXECUTE from public API roles is safe.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.user_belongs_to_client(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.user_can_access_client(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.user_can_manage_client(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 3) Tighten clients INSERT: non-super_admins must set agency_id = their own uid
DROP POLICY IF EXISTS "Admins insert clients" ON public.clients;
CREATE POLICY "Admins insert clients"
ON public.clients
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'super_admin')
  OR (
    public.has_role(auth.uid(), 'agency_admin')
    AND agency_id = auth.uid()
  )
);

-- 4) Tighten storage upload: path must resolve to a client the user can access.
-- Path convention: clients/{clientId}/products/{productId}/{file}
DROP POLICY IF EXISTS "Authenticated insert product images" ON storage.objects;
CREATE POLICY "Authenticated insert product images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND owner = auth.uid()
  AND (storage.foldername(name))[1] = 'clients'
  AND public.user_can_access_client(
    auth.uid(),
    ((storage.foldername(name))[2])::uuid
  )
);

-- Also scope UPDATE with_check the same way so files can't be moved into
-- another client's folder.
DROP POLICY IF EXISTS "Authenticated update own product images" ON storage.objects;
CREATE POLICY "Authenticated update own product images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'product-images'
  AND (owner = auth.uid() OR public.is_admin(auth.uid()))
)
WITH CHECK (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = 'clients'
  AND public.user_can_access_client(
    auth.uid(),
    ((storage.foldername(name))[2])::uuid
  )
);
