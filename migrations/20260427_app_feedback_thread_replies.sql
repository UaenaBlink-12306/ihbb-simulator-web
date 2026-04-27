-- Add a needs-more-info feedback status and a lightweight complaint thread.

ALTER TABLE public.app_feedback
  ADD COLUMN IF NOT EXISTS thread_messages JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.app_feedback
SET thread_messages = '[]'::jsonb
WHERE thread_messages IS NULL;

ALTER TABLE public.app_feedback
  ALTER COLUMN thread_messages SET DEFAULT '[]'::jsonb,
  ALTER COLUMN thread_messages SET NOT NULL;

ALTER TABLE public.app_feedback
  DROP CONSTRAINT IF EXISTS app_feedback_status_check;

ALTER TABLE public.app_feedback
  ADD CONSTRAINT app_feedback_status_check
  CHECK (status IN ('pending', 'in_review', 'needs_more_info', 'resolved'));

ALTER TABLE public.app_feedback
  DROP CONSTRAINT IF EXISTS app_feedback_thread_messages_check;

ALTER TABLE public.app_feedback
  ADD CONSTRAINT app_feedback_thread_messages_check
  CHECK (jsonb_typeof(thread_messages) = 'array');
