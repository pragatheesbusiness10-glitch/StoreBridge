
CREATE OR REPLACE FUNCTION private.user_can_access_client(_user_id uuid, _client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    private.has_role(_user_id, 'super_admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.clients
       WHERE id = _client_id
         AND agency_id = _user_id
         AND private.has_role(_user_id, 'agency_admin'::public.app_role)
    )
    OR EXISTS (
      SELECT 1 FROM public.client_members
       WHERE client_id = _client_id
         AND user_id = _user_id
    )
$$;

CREATE OR REPLACE FUNCTION private.user_can_manage_client(_user_id uuid, _client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    private.has_role(_user_id, 'super_admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.clients
       WHERE id = _client_id
         AND agency_id = _user_id
         AND private.has_role(_user_id, 'agency_admin'::public.app_role)
    )
$$;
