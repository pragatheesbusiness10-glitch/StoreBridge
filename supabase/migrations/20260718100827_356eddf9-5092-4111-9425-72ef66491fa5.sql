
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- Move helper functions out of the API-exposed public schema
ALTER FUNCTION public.has_role(uuid, public.app_role) SET SCHEMA private;
ALTER FUNCTION public.is_admin(uuid) SET SCHEMA private;
ALTER FUNCTION public.user_belongs_to_client(uuid, uuid) SET SCHEMA private;
ALTER FUNCTION public.user_can_access_client(uuid, uuid) SET SCHEMA private;
ALTER FUNCTION public.user_can_manage_client(uuid, uuid) SET SCHEMA private;
ALTER FUNCTION public.delete_product_category(uuid, uuid) SET SCHEMA private;

-- Make sure authenticated retains EXECUTE (required for RLS policy evaluation)
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.user_belongs_to_client(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.user_can_access_client(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.user_can_manage_client(uuid, uuid) TO authenticated;
-- delete_product_category is admin-only, invoked from server code with service_role
GRANT EXECUTE ON FUNCTION private.delete_product_category(uuid, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION private.delete_product_category(uuid, uuid) FROM PUBLIC, anon, authenticated;
