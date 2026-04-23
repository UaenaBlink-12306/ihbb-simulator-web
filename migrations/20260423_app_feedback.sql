-- App feedback inbox for teacher and student dashboard issue reports.

CREATE TABLE IF NOT EXISTS public.app_feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_response TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  CONSTRAINT app_feedback_category_check
    CHECK (category IN ('App Bug', 'Club Suggestion', 'General Complaint')),
  CONSTRAINT app_feedback_message_check
    CHECK (char_length(btrim(message)) BETWEEN 1 AND 4000),
  CONSTRAINT app_feedback_status_check
    CHECK (status IN ('pending', 'in_review', 'resolved')),
  CONSTRAINT app_feedback_admin_response_check
    CHECK (admin_response IS NULL OR char_length(btrim(admin_response)) <= 4000)
);

CREATE INDEX IF NOT EXISTS idx_app_feedback_user_created
  ON public.app_feedback(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_feedback_status_created
  ON public.app_feedback(status, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_app_feedback_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_feedback_set_updated_at ON public.app_feedback;
CREATE TRIGGER app_feedback_set_updated_at
  BEFORE UPDATE ON public.app_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.set_app_feedback_updated_at();

ALTER TABLE public.app_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own app feedback" ON public.app_feedback;
CREATE POLICY "Users read own app feedback" ON public.app_feedback
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own app feedback" ON public.app_feedback;
CREATE POLICY "Users insert own app feedback" ON public.app_feedback
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT ON public.app_feedback TO authenticated;
