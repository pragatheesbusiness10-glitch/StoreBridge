CREATE TABLE IF NOT EXISTS public.platform_category_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES public.store_integrations(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.product_categories(id) ON DELETE CASCADE,
  platform_category_id text NOT NULL,
  platform_handle text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_id, category_id)
);

GRANT SELECT ON public.platform_category_map TO authenticated;
GRANT ALL ON public.platform_category_map TO service_role;

ALTER TABLE public.platform_category_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers read platform category map"
  ON public.platform_category_map FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.store_integrations si
      WHERE si.id = platform_category_map.integration_id
        AND private.user_can_manage_client(auth.uid(), si.client_id)
    )
  );

CREATE TRIGGER trg_platform_category_map_updated
  BEFORE UPDATE ON public.platform_category_map
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_platform_category_map_integration
  ON public.platform_category_map(integration_id);