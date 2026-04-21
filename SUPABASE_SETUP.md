# Supabase Database Setup Guide

Run **all** of the following SQL in your **Supabase SQL Editor** (Dashboard → SQL Editor → New Query).

## 1. Core Tables

```sql
-- Profiles: stores user role, display name, and curated avatar selection
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users NOT NULL PRIMARY KEY,
  role VARCHAR(50) CHECK (role IN ('student', 'teacher')),
  display_name VARCHAR(100) DEFAULT NULL,
  class_code VARCHAR(20) DEFAULT NULL,
  avatar_id VARCHAR(32) NOT NULL DEFAULT 'penguin' CHECK (
    avatar_id IN ('cat', 'dog', 'fox', 'panda', 'rabbit', 'bear', 'tiger', 'lion', 'frog', 'penguin', 'owl', 'koala')
  ),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can read own profile"   ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Teachers can read student profiles" ON profiles FOR SELECT
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM class_students cs
      JOIN classes c ON c.id = cs.class_id
      WHERE cs.student_id = profiles.id AND c.teacher_id = auth.uid()
    )
  );

-- Classes: teacher-created classrooms
CREATE TABLE IF NOT EXISTS classes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id UUID REFERENCES auth.users NOT NULL,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(20) UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers and enrolled students can read classes" ON classes FOR SELECT USING (
  auth.uid() = teacher_id
  OR EXISTS (SELECT 1 FROM class_students cs WHERE cs.class_id = classes.id AND cs.student_id = auth.uid())
);
CREATE POLICY "Teachers insert own classes" ON classes FOR INSERT WITH CHECK (auth.uid() = teacher_id);
CREATE POLICY "Teachers delete own classes" ON classes FOR DELETE USING (auth.uid() = teacher_id);

-- Class Students: join table
CREATE TABLE IF NOT EXISTS class_students (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id UUID REFERENCES classes(id) ON DELETE CASCADE NOT NULL,
  student_id UUID REFERENCES auth.users NOT NULL,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(class_id, student_id)
);

ALTER TABLE class_students ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Students can join" ON class_students FOR INSERT WITH CHECK (auth.uid() = student_id);
CREATE POLICY "Members can read" ON class_students FOR SELECT USING (
  auth.uid() = student_id
  OR EXISTS (SELECT 1 FROM classes WHERE classes.id = class_students.class_id AND classes.teacher_id = auth.uid())
);
CREATE POLICY "Students can leave" ON class_students FOR DELETE USING (auth.uid() = student_id);

CREATE OR REPLACE FUNCTION join_class_by_code(p_code TEXT)
RETURNS TABLE(id UUID, name TEXT, code VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_class public.classes%ROWTYPE;
BEGIN
  SELECT *
    INTO target_class
    FROM public.classes
   WHERE UPPER(TRIM(code)) = UPPER(TRIM(p_code))
   LIMIT 1;

  IF target_class.id IS NULL THEN
    RAISE EXCEPTION 'Class not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.class_students (class_id, student_id)
  VALUES (target_class.id, auth.uid())
  ON CONFLICT (class_id, student_id) DO NOTHING;

  RETURN QUERY
  SELECT target_class.id, target_class.name, target_class.code;
END;
$$;

GRANT EXECUTE ON FUNCTION join_class_by_code(TEXT) TO authenticated;
```

### 1A. Existing Databases: Avatar Catalog Migration

If your `profiles` table already exists, run [`migrations/20260407_profiles_avatar_catalog.sql`](./migrations/20260407_profiles_avatar_catalog.sql) once in the Supabase SQL Editor before deploying the avatar UI.

If you already deployed class or Live Bee tables with public read policies, also run [`migrations/20260409_private_collab_policies.sql`](./migrations/20260409_private_collab_policies.sql) to tighten privacy and enable code-based joins without exposing all classes or rooms.

If analytics, wrong-bank, or AI notebook data was already contaminated across accounts, run [`migrations/20260410_purge_study_data.sql`](./migrations/20260410_purge_study_data.sql) once to clear only those three study-data tables without deleting user accounts, profiles, classes, or assignments.

## 2. Assignment Tables

```sql
-- Assignments
CREATE TABLE IF NOT EXISTS assignments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id UUID REFERENCES classes(id) ON DELETE CASCADE NOT NULL,
  teacher_id UUID REFERENCES auth.users NOT NULL,
  title VARCHAR(255) NOT NULL,
  instructions TEXT DEFAULT '',
  due_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers create assignments" ON assignments FOR INSERT WITH CHECK (auth.uid() = teacher_id);
CREATE POLICY "Teachers delete assignments" ON assignments FOR DELETE USING (auth.uid() = teacher_id);
CREATE POLICY "Class members read assignments" ON assignments FOR SELECT USING (
  auth.uid() = teacher_id
  OR EXISTS (SELECT 1 FROM class_students WHERE class_students.class_id = assignments.class_id AND class_students.student_id = auth.uid())
);

-- Assignment Questions (stores question IDs from the JSON bank)
CREATE TABLE IF NOT EXISTS assignment_questions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id UUID REFERENCES assignments(id) ON DELETE CASCADE NOT NULL,
  question_id TEXT NOT NULL,
  question_text TEXT NOT NULL,
  answer_text TEXT NOT NULL,
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  category TEXT DEFAULT '',
  era TEXT DEFAULT '',
  source TEXT DEFAULT ''
);

ALTER TABLE assignment_questions
  ADD COLUMN IF NOT EXISTS aliases JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE assignment_questions
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT '';

ALTER TABLE assignment_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teachers insert questions" ON assignment_questions FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM assignments WHERE assignments.id = assignment_questions.assignment_id AND assignments.teacher_id = auth.uid())
);
CREATE POLICY "Members read questions" ON assignment_questions FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM assignments a
    WHERE a.id = assignment_questions.assignment_id
    AND (a.teacher_id = auth.uid() OR EXISTS (SELECT 1 FROM class_students cs WHERE cs.class_id = a.class_id AND cs.student_id = auth.uid()))
  )
);

-- Generated Questions (private reusable drills + teacher drafts)
CREATE TABLE IF NOT EXISTS generated_questions (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users NOT NULL,
  question_text TEXT NOT NULL,
  answer_text TEXT NOT NULL,
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  category TEXT DEFAULT '',
  era TEXT DEFAULT '',
  source TEXT NOT NULL DEFAULT 'generated',
  topic TEXT DEFAULT '',
  created_by_role TEXT DEFAULT '',
  created_from TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_generated_questions_user_created
  ON generated_questions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generated_questions_user_region_era
  ON generated_questions(user_id, category, era, created_at DESC);

ALTER TABLE generated_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own generated questions" ON generated_questions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own generated questions" ON generated_questions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own generated questions" ON generated_questions
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own generated questions" ON generated_questions
  FOR DELETE USING (auth.uid() = user_id);

-- Submissions
CREATE TABLE IF NOT EXISTS assignment_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id UUID REFERENCES assignments(id) ON DELETE CASCADE NOT NULL,
  student_id UUID REFERENCES auth.users NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(assignment_id, student_id)
);

ALTER TABLE assignment_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Students submit" ON assignment_submissions FOR INSERT WITH CHECK (auth.uid() = student_id);
CREATE POLICY "Students update own" ON assignment_submissions FOR UPDATE USING (auth.uid() = student_id);
CREATE POLICY "Read own or teacher reads" ON assignment_submissions FOR SELECT USING (
  auth.uid() = student_id
  OR EXISTS (SELECT 1 FROM assignments a WHERE a.id = assignment_submissions.assignment_id AND a.teacher_id = auth.uid())
);
```

## 2.5 Wrong-Bank Sync Table (Cross-Device)

```sql
-- Stores each user's wrong-question IDs so wrong bank follows the account across devices
CREATE TABLE IF NOT EXISTS user_wrong_questions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users NOT NULL,
  question_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(user_id, question_id)
);

ALTER TABLE user_wrong_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own wrong questions" ON user_wrong_questions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own wrong questions" ON user_wrong_questions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own wrong questions" ON user_wrong_questions
  FOR DELETE USING (auth.uid() = user_id);
```

## 2.6 Drill Session Sync Table (Cross-Device Analytics)

```sql
-- Stores per-user drill sessions used by Student Dashboard analytics
CREATE TABLE IF NOT EXISTS user_drill_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users NOT NULL,
  client_session_id TEXT NOT NULL,
  ts BIGINT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  dur INTEGER NOT NULL DEFAULT 0,
  buzz JSONB NOT NULL DEFAULT '[]'::jsonb,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  results JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(user_id, client_session_id)
);

ALTER TABLE user_drill_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own drill sessions" ON user_drill_sessions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own drill sessions" ON user_drill_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own drill sessions" ON user_drill_sessions
  FOR UPDATE USING (auth.uid() = user_id);
```

## 2.7 DeepSeek Coach Attempts (Cross-Device Coach Notebook)

```sql
CREATE TABLE IF NOT EXISTS user_coach_attempts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users NOT NULL,
  client_attempt_id TEXT NOT NULL,
  client_session_id TEXT,
  question_id TEXT,
  question_text TEXT NOT NULL,
  expected_answer TEXT NOT NULL,
  user_answer TEXT NOT NULL,
  correct BOOLEAN NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  coach JSONB NOT NULL DEFAULT '{}'::jsonb,
  category TEXT NOT NULL DEFAULT '',
  era TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  focus_topic TEXT NOT NULL DEFAULT '',
  mastered BOOLEAN NOT NULL DEFAULT false,
  mastered_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(user_id, client_attempt_id)
);

CREATE INDEX IF NOT EXISTS idx_user_coach_attempts_user_created
  ON user_coach_attempts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_coach_attempts_user_mastered_created
  ON user_coach_attempts(user_id, mastered, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_coach_attempts_user_category_era
  ON user_coach_attempts(user_id, category, era, created_at DESC);

ALTER TABLE user_coach_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own coach attempts" ON user_coach_attempts
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own coach attempts" ON user_coach_attempts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own coach attempts" ON user_coach_attempts
  FOR UPDATE USING (auth.uid() = user_id);
```

## 2.8 Emergency Study-Data Reset

```sql
-- Use only if analytics, wrong-bank, and AI notebook rows were already shared across accounts.
-- This preserves auth.users, profiles, classes, assignments, and submissions.
DELETE FROM public.user_wrong_questions;
DELETE FROM public.user_drill_sessions;
DELETE FROM public.user_coach_attempts;
```

## 3. Account Deletion RPC

```sql
CREATE OR REPLACE FUNCTION delete_user()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  DELETE FROM public.user_wrong_questions WHERE user_id = auth.uid();
  DELETE FROM public.user_drill_sessions WHERE user_id = auth.uid();
  DELETE FROM public.user_coach_attempts WHERE user_id = auth.uid();
  DELETE FROM public.generated_questions WHERE user_id = auth.uid();
  DELETE FROM public.assignment_submissions WHERE student_id = auth.uid();
  DELETE FROM public.assignment_questions WHERE assignment_id IN (SELECT id FROM public.assignments WHERE teacher_id = auth.uid());
  DELETE FROM public.assignments WHERE teacher_id = auth.uid();
  DELETE FROM public.class_students WHERE student_id = auth.uid();
  DELETE FROM public.classes WHERE teacher_id = auth.uid();
  DELETE FROM public.profiles WHERE id = auth.uid();
  DELETE FROM auth.users WHERE id = auth.uid();
$$;
```

## 4. Live Bee Rooms

```sql
-- Bee Rooms: real-time multiplayer buzzer rooms
CREATE TABLE IF NOT EXISTS bee_rooms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(6) UNIQUE NOT NULL,
  host_id UUID REFERENCES auth.users NOT NULL,
  status VARCHAR(20) DEFAULT 'waiting',  -- waiting | active | finished
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE bee_rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Hosts and room members can read rooms" ON bee_rooms FOR SELECT USING (
  auth.uid() = host_id
  OR EXISTS (SELECT 1 FROM bee_participants bp WHERE bp.room_id = bee_rooms.id AND bp.user_id = auth.uid())
);
CREATE POLICY "Host creates rooms" ON bee_rooms FOR INSERT WITH CHECK (auth.uid() = host_id);
CREATE POLICY "Host updates rooms" ON bee_rooms FOR UPDATE USING (auth.uid() = host_id);
CREATE POLICY "Host deletes rooms" ON bee_rooms FOR DELETE USING (auth.uid() = host_id);

-- Bee Participants: players in a room
CREATE TABLE IF NOT EXISTS bee_participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID REFERENCES bee_rooms(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users NOT NULL,
  display_name VARCHAR(100),
  score INTEGER DEFAULT 0,
  UNIQUE(room_id, user_id)
);

ALTER TABLE bee_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Hosts and room members can read participants" ON bee_participants FOR SELECT USING (
  auth.uid() = user_id
  OR EXISTS (SELECT 1 FROM bee_rooms br WHERE br.id = bee_participants.room_id AND br.host_id = auth.uid())
  OR EXISTS (SELECT 1 FROM bee_participants me WHERE me.room_id = bee_participants.room_id AND me.user_id = auth.uid())
);
CREATE POLICY "Users join rooms" ON bee_participants FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users leave rooms" ON bee_participants FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Host updates scores" ON bee_participants FOR UPDATE USING (
  auth.uid() = user_id
  OR EXISTS (SELECT 1 FROM bee_rooms WHERE bee_rooms.id = bee_participants.room_id AND bee_rooms.host_id = auth.uid())
);

CREATE OR REPLACE FUNCTION join_bee_room_by_code(p_code TEXT, p_display_name TEXT DEFAULT NULL)
RETURNS TABLE(id UUID, code VARCHAR, host_id UUID, status VARCHAR, participant_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_room public.bee_rooms%ROWTYPE;
  already_joined BOOLEAN;
  current_count INTEGER;
BEGIN
  SELECT *
    INTO target_room
    FROM public.bee_rooms
   WHERE UPPER(TRIM(code)) = UPPER(TRIM(p_code))
   LIMIT 1;

  IF target_room.id IS NULL THEN
    RAISE EXCEPTION 'Room not found' USING ERRCODE = 'P0002';
  END IF;

  IF target_room.status = 'finished' THEN
    RAISE EXCEPTION 'This room has already ended.' USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.bee_participants bp
     WHERE bp.room_id = target_room.id
       AND bp.user_id = auth.uid()
  ) INTO already_joined;

  SELECT COUNT(*)
    INTO current_count
    FROM public.bee_participants bp
   WHERE bp.room_id = target_room.id;

  IF NOT already_joined AND current_count >= 8 THEN
    RAISE EXCEPTION 'Room is full (max 8 players).' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.bee_participants (room_id, user_id, display_name, score)
  VALUES (target_room.id, auth.uid(), NULLIF(TRIM(COALESCE(p_display_name, '')), ''), 0)
  ON CONFLICT (room_id, user_id)
  DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, public.bee_participants.display_name);

  SELECT COUNT(*)
    INTO current_count
    FROM public.bee_participants bp
   WHERE bp.room_id = target_room.id;

  RETURN QUERY
  SELECT target_room.id, target_room.code, target_room.host_id, target_room.status, current_count;
END;
$$;

GRANT EXECUTE ON FUNCTION join_bee_room_by_code(TEXT, TEXT) TO authenticated;
```

## 5. Leaderboards

```sql
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
  ),
  ranked AS (
    SELECT p.id as student_id,
           p.display_name,
           p.avatar_id,
           COALESCE(a.total_correct, 0) as total_correct,
           COALESCE(a.total_answered, 0) as total_answered,
           RANK() OVER (ORDER BY COALESCE(a.total_correct, 0) DESC, COALESCE(a.total_answered, 0) ASC) as rank
    FROM public.profiles p
    LEFT JOIN agg a ON a.user_id = p.id
    WHERE p.role = 'student' AND p.display_name IS NOT NULL AND p.display_name != ''
  )
  SELECT * FROM ranked
  WHERE rank <= 100 OR student_id = auth.uid()
  ORDER BY rank;
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
```

## 6. Next Steps
1. Run all SQL above in Supabase SQL Editor.
2. Ensure `config.js` has your correct URL and Anon Key.
3. Deploy to Vercel via GitHub push.
