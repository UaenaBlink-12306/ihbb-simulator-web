-- Restore authorized teacher analytics without exposing student study data outside owned classes.
-- The helper already verifies that auth.uid() owns a class containing p_student_id.

REVOKE ALL ON FUNCTION public.is_current_user_student_teacher(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_current_user_student_teacher(uuid) TO authenticated;

DROP POLICY IF EXISTS "Teachers read enrolled student drill sessions" ON public.user_drill_sessions;
CREATE POLICY "Teachers read enrolled student drill sessions"
ON public.user_drill_sessions
FOR SELECT
TO authenticated
USING ((SELECT public.is_current_user_student_teacher(user_id)));

DROP POLICY IF EXISTS "Teachers read enrolled student mistakes" ON public.user_wrong_questions;
CREATE POLICY "Teachers read enrolled student mistakes"
ON public.user_wrong_questions
FOR SELECT
TO authenticated
USING ((SELECT public.is_current_user_student_teacher(user_id)));

DROP POLICY IF EXISTS "Teachers read enrolled student coach attempts" ON public.user_coach_attempts;
CREATE POLICY "Teachers read enrolled student coach attempts"
ON public.user_coach_attempts
FOR SELECT
TO authenticated
USING ((SELECT public.is_current_user_student_teacher(user_id)));
