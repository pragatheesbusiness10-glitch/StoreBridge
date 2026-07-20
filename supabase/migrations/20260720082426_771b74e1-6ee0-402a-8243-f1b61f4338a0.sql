DROP POLICY IF EXISTS "Admins can insert categories" ON public.product_categories;
CREATE POLICY "Signed-in users can create categories"
  ON public.product_categories
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE OR REPLACE FUNCTION public.set_category_created_by()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_category_created_by_trg ON public.product_categories;
CREATE TRIGGER set_category_created_by_trg
BEFORE INSERT ON public.product_categories
FOR EACH ROW EXECUTE FUNCTION public.set_category_created_by();