-- Repair new-account profile writes and private class-code joins.
-- Safe to rerun after the core Supabase setup has created profiles/classes/class_students.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS account_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Teachers can read student profiles" ON public.profiles;

CREATE POLICY "Users can insert own profile"
ON public.profiles
FOR INSERT
WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
ON public.profiles
FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can read own profile"
ON public.profiles
FOR SELECT
USING (auth.uid() = id);

CREATE POLICY "Teachers can read student profiles"
ON public.profiles
FOR SELECT
USING (
  auth.uid() = id
  OR EXISTS (
    SELECT 1
      FROM public.class_students cs
      JOIN public.classes c ON c.id = cs.class_id
     WHERE cs.student_id = profiles.id
       AND c.teacher_id = auth.uid()
  )
);

ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_students ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read classes" ON public.classes;
DROP POLICY IF EXISTS "Teachers and enrolled students can read classes" ON public.classes;
DROP POLICY IF EXISTS "Teachers insert own classes" ON public.classes;
DROP POLICY IF EXISTS "Teachers delete own classes" ON public.classes;

CREATE POLICY "Teachers and enrolled students can read classes"
ON public.classes
FOR SELECT
USING (
  auth.uid() = teacher_id
  OR EXISTS (
    SELECT 1
      FROM public.class_students cs
     WHERE cs.class_id = classes.id
       AND cs.student_id = auth.uid()
  )
);

CREATE POLICY "Teachers insert own classes"
ON public.classes
FOR INSERT
WITH CHECK (auth.uid() = teacher_id);

CREATE POLICY "Teachers delete own classes"
ON public.classes
FOR DELETE
USING (auth.uid() = teacher_id);

DROP POLICY IF EXISTS "Students can join" ON public.class_students;
DROP POLICY IF EXISTS "Members can read" ON public.class_students;
DROP POLICY IF EXISTS "Students can leave" ON public.class_students;

CREATE POLICY "Students can join"
ON public.class_students
FOR INSERT
WITH CHECK (auth.uid() = student_id);

CREATE POLICY "Members can read"
ON public.class_students
FOR SELECT
USING (
  auth.uid() = student_id
  OR EXISTS (
    SELECT 1
      FROM public.classes c
     WHERE c.id = class_students.class_id
       AND c.teacher_id = auth.uid()
  )
);

CREATE POLICY "Students can leave"
ON public.class_students
FOR DELETE
USING (auth.uid() = student_id);

CREATE OR REPLACE FUNCTION public.join_class_by_code(p_code TEXT)
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
    RAISE EXCEPTION 'You must be signed in to join a class.' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO target_class
    FROM public.classes
   WHERE UPPER(TRIM(code)) = UPPER(TRIM(p_code))
   LIMIT 1;

  IF target_class.id IS NULL THEN
    RAISE EXCEPTION 'Class not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.class_students (class_id, student_id)
  VALUES (target_class.id, current_user_id)
  ON CONFLICT (class_id, student_id) DO NOTHING;

  RETURN QUERY
  SELECT target_class.id, target_class.name, target_class.code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_class_by_code(TEXT) TO authenticated;
