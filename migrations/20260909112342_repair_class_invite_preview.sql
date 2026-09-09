CREATE OR REPLACE FUNCTION public.preview_class_by_code(p_code TEXT)
RETURNS TABLE(id UUID, name VARCHAR, code VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target public.classes%ROWTYPE;
  caller UUID := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO target
    FROM public.classes AS c
   WHERE UPPER(c.code) = UPPER(TRIM(p_code))
   LIMIT 1;

  IF target.id IS NULL THEN
    RAISE EXCEPTION 'class not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT target.id, target.name, target.code;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_class_by_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_class_by_code(TEXT) TO authenticated;
