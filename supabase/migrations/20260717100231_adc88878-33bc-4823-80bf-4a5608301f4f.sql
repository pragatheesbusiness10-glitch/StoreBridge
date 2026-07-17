CREATE OR REPLACE FUNCTION public.delete_product_category(_category_id uuid, _actor_id uuid)
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

  IF NOT (public.is_admin(_actor_id) OR category_row.created_by = _actor_id) THEN
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

DROP FUNCTION IF EXISTS public.delete_product_category(uuid);
REVOKE ALL ON FUNCTION public.delete_product_category(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_product_category(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.delete_product_category(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_product_category(uuid, uuid) TO service_role;