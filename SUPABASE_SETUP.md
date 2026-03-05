# Supabase Database Setup Guide

Run **all** of the following SQL in your **Supabase SQL Editor** (Dashboard → SQL Editor → New Query).

## 1. Core Tables

```sql
-- Profiles: stores user role and display name
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users NOT NULL PRIMARY KEY,
  role VARCHAR(50) CHECK (role IN ('student', 'teacher')),
  display_name VARCHAR(100) DEFAULT NULL,
  class_code VARCHAR(20) DEFAULT NULL,
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
CREATE POLICY "Anyone can read classes" ON classes FOR SELECT USING (true);
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
```

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
  category TEXT DEFAULT '',
  era TEXT DEFAULT ''
);

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

## 3. Account Deletion RPC

```sql
CREATE OR REPLACE FUNCTION delete_user()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  DELETE FROM public.user_wrong_questions WHERE user_id = auth.uid();
  DELETE FROM public.user_drill_sessions WHERE user_id = auth.uid();
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
CREATE POLICY "Anyone can read rooms" ON bee_rooms FOR SELECT USING (true);
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
CREATE POLICY "Anyone can read participants" ON bee_participants FOR SELECT USING (true);
CREATE POLICY "Users join rooms" ON bee_participants FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users leave rooms" ON bee_participants FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Host updates scores" ON bee_participants FOR UPDATE USING (
  auth.uid() = user_id
  OR EXISTS (SELECT 1 FROM bee_rooms WHERE bee_rooms.id = bee_participants.room_id AND bee_rooms.host_id = auth.uid())
);
```

## 5. Next Steps
1. Run all SQL above in Supabase SQL Editor.
2. Ensure `config.js` has your correct URL and Anon Key.
3. Deploy to Vercel via GitHub push.
