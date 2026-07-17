GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.user_can_access_client(uuid, uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.user_can_manage_client(uuid, uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.user_belongs_to_client(uuid, uuid) TO authenticated, anon, service_role;