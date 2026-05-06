-- Add school_name to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS school_name VARCHAR(255);

-- Add visibility, creator_school, and creator_role to question_sets
ALTER TABLE question_sets ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) DEFAULT 'private' CHECK (visibility IN ('private', 'public', 'school'));
ALTER TABLE question_sets ADD COLUMN IF NOT EXISTS creator_school VARCHAR(255);
ALTER TABLE question_sets ADD COLUMN IF NOT EXISTS creator_role VARCHAR(20);

-- Update RLS for question_sets to allow reading shared sets
DROP POLICY IF EXISTS "Users read question sets" ON question_sets;

CREATE POLICY "Users read question sets" ON question_sets
  FOR SELECT USING (
    auth.uid() = creator_id 
    OR visibility = 'public'
    OR (visibility = 'school' AND creator_school = (SELECT school_name FROM profiles WHERE id = auth.uid()))
  );
