-- Allow teachers to rename their own classes at any time.
-- Only the owning teacher may update a class row, and the check clause keeps
-- teacher_id immutable, so a teacher can never take over another teacher's class.

DROP POLICY IF EXISTS "Teachers update own classes" ON public.classes;

CREATE POLICY "Teachers update own classes"
ON public.classes
FOR UPDATE
TO authenticated
USING (auth.uid() = teacher_id)
WITH CHECK (auth.uid() = teacher_id);
