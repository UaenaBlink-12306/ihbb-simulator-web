-- Leaderboard RPCs: Global and Class rankings
-- Points are computed by combining all `correct` answers from drill sessions.

CREATE OR REPLACE FUNCTION get_leaderboard_global()
RETURNS TABLE (
  student_id UUID,
  display_name VARCHAR,
  avatar_id VARCHAR,
  total_correct BIGINT,
  total_answered BIGINT,
  rank BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH agg AS (
    SELECT user_id, 
           SUM(correct) as total_correct, 
           SUM(total) as total_answered
    FROM public.user_drill_sessions
    GROUP BY user_id
  )
  SELECT p.id as student_id,
         p.display_name,
         p.avatar_id,
         COALESCE(a.total_correct, 0) as total_correct,
         COALESCE(a.total_answered, 0) as total_answered,
         RANK() OVER (ORDER BY COALESCE(a.total_correct, 0) DESC, COALESCE(a.total_answered, 0) ASC) as rank
  FROM public.profiles p
  LEFT JOIN agg a ON a.user_id = p.id
  WHERE p.role = 'student' AND p.display_name IS NOT NULL AND p.display_name != ''
  ORDER BY rank
  LIMIT 100;
$$;

CREATE OR REPLACE FUNCTION get_leaderboard_class(p_class_id UUID)
RETURNS TABLE (
  student_id UUID,
  display_name VARCHAR,
  avatar_id VARCHAR,
  total_correct BIGINT,
  total_answered BIGINT,
  rank BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH class_users AS (
    SELECT student_id FROM public.class_students WHERE class_id = p_class_id
  ),
  agg AS (
    SELECT user_id, 
           SUM(correct) as total_correct, 
           SUM(total) as total_answered
    FROM public.user_drill_sessions
    WHERE user_id IN (SELECT student_id FROM class_users)
    GROUP BY user_id
  )
  SELECT p.id as student_id,
         p.display_name,
         p.avatar_id,
         COALESCE(a.total_correct, 0) as total_correct,
         COALESCE(a.total_answered, 0) as total_answered,
         RANK() OVER (ORDER BY COALESCE(a.total_correct, 0) DESC, COALESCE(a.total_answered, 0) ASC) as rank
  FROM public.profiles p
  INNER JOIN class_users cu ON cu.student_id = p.id
  LEFT JOIN agg a ON a.user_id = p.id
  WHERE p.role = 'student' AND p.display_name IS NOT NULL AND p.display_name != ''
  ORDER BY rank;
$$;

GRANT EXECUTE ON FUNCTION get_leaderboard_global() TO authenticated;
GRANT EXECUTE ON FUNCTION get_leaderboard_class(UUID) TO authenticated;
