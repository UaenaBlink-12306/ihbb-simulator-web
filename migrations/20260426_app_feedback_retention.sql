-- Automatically clear resolved app feedback after 30 days.

CREATE INDEX IF NOT EXISTS idx_app_feedback_status_updated
  ON public.app_feedback(status, updated_at);

CREATE OR REPLACE FUNCTION public.purge_resolved_app_feedback()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.app_feedback
  WHERE status = 'resolved'
    AND updated_at < TIMEZONE('utc', NOW()) - INTERVAL '30 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_resolved_app_feedback() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_resolved_app_feedback() TO authenticated;
