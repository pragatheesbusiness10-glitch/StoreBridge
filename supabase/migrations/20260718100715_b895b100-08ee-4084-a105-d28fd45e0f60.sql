
-- Revoke EXECUTE on SECURITY DEFINER functions that are not meant to be called by end users.
-- Trigger functions and admin RPCs run either from triggers (as owner) or from server code via service_role.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_product_category(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Revoke EXECUTE from anon on role/access helpers (only signed-in users need them via RLS).
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_belongs_to_client(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_can_access_client(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_can_manage_client(uuid, uuid) FROM PUBLIC, anon;

-- Tighten product_categories INSERT: only admins can create global categories,
-- and rows must be attributed to the actor.
DROP POLICY IF EXISTS "Authenticated users can insert categories" ON public.product_categories;
CREATE POLICY "Admins can insert categories"
  ON public.product_categories
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()) AND created_by = auth.uid());
