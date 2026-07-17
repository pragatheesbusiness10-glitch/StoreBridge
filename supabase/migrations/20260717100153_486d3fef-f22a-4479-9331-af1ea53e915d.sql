CREATE OR REPLACE FUNCTION public.delete_product_category(_category_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  category_row public.product_categories%ROWTYPE;
  product_count integer;
BEGIN
  SELECT * INTO category_row
  FROM public.product_categories
  WHERE id = _category_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (public.is_admin(auth.uid()) OR category_row.created_by = auth.uid()) THEN
    RAISE EXCEPTION 'You do not have permission to delete this category' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO product_count
  FROM public.products
  WHERE lower(category) = lower(category_row.name);

  IF product_count > 0 THEN
    RAISE EXCEPTION 'This category is used by one or more products. Reassign those products before deleting.' USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.product_categories
  WHERE id = _category_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_product_category(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_product_category(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_product_category(uuid) TO service_role;