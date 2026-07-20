
CREATE TABLE public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  size text NOT NULL,
  sku text,
  price numeric,
  inventory_quantity integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, size)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_variants TO authenticated;
GRANT ALL ON public.product_variants TO service_role;

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read variants" ON public.product_variants FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND private.user_can_access_client(auth.uid(), p.client_id)));
CREATE POLICY "Insert variants" ON public.product_variants FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND private.user_can_access_client(auth.uid(), p.client_id)));
CREATE POLICY "Update variants" ON public.product_variants FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND private.user_can_access_client(auth.uid(), p.client_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND private.user_can_access_client(auth.uid(), p.client_id)));
CREATE POLICY "Delete variants" ON public.product_variants FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND private.user_can_access_client(auth.uid(), p.client_id)));

CREATE TRIGGER trg_product_variants_updated_at
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX idx_product_variants_product_id ON public.product_variants(product_id);
