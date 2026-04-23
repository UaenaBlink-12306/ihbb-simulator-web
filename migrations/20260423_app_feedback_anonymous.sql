-- Allow users to hide their identity in the app-facing feedback inbox.
-- The user_id remains stored for RLS ownership and account cleanup, but admin UI should redact it when is_anonymous is true.

ALTER TABLE public.app_feedback
  ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT false;
