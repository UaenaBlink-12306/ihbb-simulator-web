-- Live Bee Game Reviews: persist post-game review data for dashboard history
CREATE TABLE IF NOT EXISTS public.livebee_game_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES public.bee_rooms(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  room_code TEXT NOT NULL,
  host_name TEXT DEFAULT '',
  player_count INTEGER DEFAULT 0,
  my_rank INTEGER,
  my_score INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  standings JSONB NOT NULL DEFAULT '[]',
  review JSONB NOT NULL DEFAULT '[]',
  summary JSONB NOT NULL DEFAULT '{}'
);

ALTER TABLE public.livebee_game_reviews ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_livebee_game_reviews_user
  ON public.livebee_game_reviews(user_id, created_at DESC);

-- Users can read their own reviews
CREATE POLICY "Users can view own game reviews"
  ON public.livebee_game_reviews
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Users can insert their own reviews
CREATE POLICY "Users can insert own game reviews"
  ON public.livebee_game_reviews
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Teachers can view reviews for students in their classes
CREATE POLICY "Teachers can view class game reviews"
  ON public.livebee_game_reviews
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'teacher'
    )
    AND EXISTS (
      SELECT 1 FROM public.class_students cs
      JOIN public.classes c ON c.id = cs.class_id
      WHERE cs.student_id = livebee_game_reviews.user_id
        AND c.teacher_id = auth.uid()
    )
  );
