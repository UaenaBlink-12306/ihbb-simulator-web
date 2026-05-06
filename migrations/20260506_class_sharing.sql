-- Remove school-related columns
ALTER TABLE profiles DROP COLUMN IF EXISTS school_name;
ALTER TABLE question_sets DROP COLUMN IF EXISTS creator_school;

-- Add class_id to question_sets
ALTER TABLE question_sets ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES classes(id) ON DELETE SET NULL;

-- Update visibility constraint
ALTER TABLE question_sets DROP CONSTRAINT IF EXISTS question_sets_visibility_check;
ALTER TABLE question_sets ADD CONSTRAINT question_sets_visibility_check CHECK (visibility IN ('private', 'public', 'class'));

-- Update RLS for question_sets
DROP POLICY IF EXISTS "Users read question sets" ON question_sets;

CREATE POLICY "Users read question sets" ON question_sets
  FOR SELECT USING (
    auth.uid() = creator_id 
    OR visibility = 'public'
    OR (visibility = 'class' AND class_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM classes WHERE id = class_id AND teacher_id = auth.uid())
      OR EXISTS (SELECT 1 FROM class_students WHERE class_id = question_sets.class_id AND student_id = auth.uid())
    ))
  );
