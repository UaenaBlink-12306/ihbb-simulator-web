-- Allow dashboard "Complain to me" feedback to include compressed photo attachments.

ALTER TABLE public.app_feedback
  ADD COLUMN IF NOT EXISTS photo_attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.app_feedback
SET photo_attachments = '[]'::jsonb
WHERE photo_attachments IS NULL;

ALTER TABLE public.app_feedback
  ALTER COLUMN photo_attachments SET DEFAULT '[]'::jsonb,
  ALTER COLUMN photo_attachments SET NOT NULL;

ALTER TABLE public.app_feedback
  DROP CONSTRAINT IF EXISTS app_feedback_photo_attachments_check;

ALTER TABLE public.app_feedback
  ADD CONSTRAINT app_feedback_photo_attachments_check
  CHECK (
    jsonb_typeof(photo_attachments) = 'array'
    AND jsonb_array_length(photo_attachments) <= 3
  );
