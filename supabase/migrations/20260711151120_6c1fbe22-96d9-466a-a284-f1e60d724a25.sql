
CREATE TABLE public.audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id UUID,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_client_id ON public.audit_logs (client_id);
CREATE INDEX idx_audit_logs_actor_id ON public.audit_logs (actor_id);

GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Super admins can view all audit logs
CREATE POLICY "Super admins can view all audit logs"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

-- Agency admins can view audit logs for clients they own OR their own actions
CREATE POLICY "Agency admins can view audit logs for their clients"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (
    actor_id = auth.uid()
    OR (
      client_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.clients
        WHERE id = audit_logs.client_id
          AND agency_id = auth.uid()
          AND public.has_role(auth.uid(), 'agency_admin')
      )
    )
  );
