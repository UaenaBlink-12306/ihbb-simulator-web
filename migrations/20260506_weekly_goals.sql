-- Weekly Student Goals: target questions, accuracy, weak-area tracking
CREATE TABLE IF NOT EXISTS public.weekly_student_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  target_questions INTEGER NOT NULL DEFAULT 50,
  target_accuracy REAL NOT NULL DEFAULT 70.0,
  weak_area_targets JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, week_start)
);

ALTER TABLE public.weekly_student_goals ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_weekly_goals_user_week
  ON public.weekly_student_goals(user_id, week_start DESC);

-- Users can manage their own goals
CREATE POLICY "Users can manage own goals"
  ON public.weekly_student_goals
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Streak calculation RPC: consecutive days with at least one drill session
CREATE OR REPLACE FUNCTION public.get_user_practice_streak(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  streak INTEGER := 0;
  check_date DATE;
  has_session BOOLEAN;
BEGIN
  check_date := CURRENT_DATE;
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.user_drill_sessions
      WHERE user_id = p_user_id
        AND created_at::DATE = check_date
    ) INTO has_session;
    EXIT WHEN NOT has_session;
    streak := streak + 1;
    check_date := check_date - INTERVAL '1 day';
  END LOOP;
  RETURN streak;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_practice_streak(UUID) TO authenticated;
