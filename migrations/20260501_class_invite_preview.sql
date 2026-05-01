CREATE OR REPLACE FUNCTION public.preview_class_by_code(p_code TEXT)
RETURNS TABLE(id UUID, name TEXT, code VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_class public.classes%ROWTYPE;
  current_user_id UUID := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to preview a class invite.' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO target_class
    FROM public.classes AS c
   WHERE UPPER(TRIM(c.code)) = UPPER(TRIM(p_code))
   LIMIT 1;

  IF target_class.id IS NULL THEN
    RAISE EXCEPTION 'Class not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT target_class.id, target_class.name::TEXT, target_class.code;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_class_by_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_class_by_code(TEXT) TO authenticated;
