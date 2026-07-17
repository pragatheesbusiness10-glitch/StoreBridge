WITH target_users AS (
  SELECT id
  FROM public.profiles
  WHERE lower(email) = lower('pragatheesbusiness10@gmail.com')
), inserted_super_admin AS (
  INSERT INTO public.user_roles (user_id, role)
  SELECT id, 'super_admin'::public.app_role
  FROM target_users
  ON CONFLICT (user_id, role) DO NOTHING
  RETURNING user_id
), removed_non_admin_roles AS (
  DELETE FROM public.user_roles
  WHERE user_id IN (SELECT id FROM target_users)
    AND role <> 'super_admin'::public.app_role
  RETURNING user_id, role
), removed_client_memberships AS (
  DELETE FROM public.client_members
  WHERE user_id IN (SELECT id FROM target_users)
  RETURNING user_id, client_id
)
INSERT INTO public.audit_logs (actor_id, actor_email, action, target_type, target_id, client_id, metadata)
SELECT
  tu.id,
  'system',
  'role.force_super_admin',
  'user',
  tu.id,
  NULL,
  jsonb_build_object(
    'email', 'pragatheesbusiness10@gmail.com',
    'insertedSuperAdmin', EXISTS (SELECT 1 FROM inserted_super_admin isa WHERE isa.user_id = tu.id),
    'removedRoles', COALESCE((SELECT jsonb_agg(role::text) FROM removed_non_admin_roles rr WHERE rr.user_id = tu.id), '[]'::jsonb),
    'removedClientIds', COALESCE((SELECT jsonb_agg(client_id::text) FROM removed_client_memberships rm WHERE rm.user_id = tu.id), '[]'::jsonb)
  )
FROM target_users tu;