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

ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_students ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_current_user_class_teacher(p_class_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    EXISTS (
      SELECT 1
        FROM public.classes c
       WHERE c.id = p_class_id
         AND c.teacher_id = auth.uid()
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.is_current_user_class_student(p_class_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    EXISTS (
      SELECT 1
        FROM public.class_students cs
       WHERE cs.class_id = p_class_id
         AND cs.student_id = auth.uid()
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.is_current_user_student_teacher(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    EXISTS (
      SELECT 1
        FROM public.class_students cs
        JOIN public.classes c ON c.id = cs.class_id
       WHERE cs.student_id = p_student_id
         AND c.teacher_id = auth.uid()
    ),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_current_user_class_teacher(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_current_user_class_student(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_current_user_student_teacher(UUID) TO authenticated;

DROP POLICY IF EXISTS "Teachers can read student profiles" ON public.profiles;
CREATE POLICY "Teachers can read student profiles"
ON public.profiles
FOR SELECT
USING (
  auth.uid() = id
  OR public.is_current_user_student_teacher(id)
);

DROP POLICY IF EXISTS "Anyone can read classes" ON public.classes;
DROP POLICY IF EXISTS "Teachers and enrolled students can read classes" ON public.classes;
DROP POLICY IF EXISTS "Teachers insert own classes" ON public.classes;
DROP POLICY IF EXISTS "Teachers delete own classes" ON public.classes;

CREATE POLICY "Teachers and enrolled students can read classes"
ON public.classes
FOR SELECT
USING (
  auth.uid() = teacher_id
  OR public.is_current_user_class_student(id)
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
  OR public.is_current_user_class_teacher(class_id)
);

CREATE POLICY "Students can leave"
ON public.class_students
FOR DELETE
USING (auth.uid() = student_id);

DO $$
BEGIN
  IF to_regclass('public.assignments') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Class members read assignments" ON public.assignments';
    EXECUTE 'CREATE POLICY "Class members read assignments" ON public.assignments FOR SELECT USING (auth.uid() = teacher_id OR public.is_current_user_class_student(class_id))';
  END IF;
END;
$$;

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
  SELECT target_class.id, target_class.name::TEXT, target_class.code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_class_by_code(TEXT) TO authenticated;
