-- Let users manually remove their own resolved feedback history items.

DROP POLICY IF EXISTS "Users delete resolved own app feedback" ON public.app_feedback;
CREATE POLICY "Users delete resolved own app feedback" ON public.app_feedback
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND status = 'resolved');

GRANT DELETE ON public.app_feedback TO authenticated;
