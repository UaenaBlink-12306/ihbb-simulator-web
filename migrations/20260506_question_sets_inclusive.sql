-- Rename teacher_id to creator_id for inclusivity
ALTER TABLE question_sets RENAME COLUMN teacher_id TO creator_id;

-- Update policies
DROP POLICY IF EXISTS "Teachers create question sets" ON question_sets;
DROP POLICY IF EXISTS "Teachers read question sets" ON question_sets;
DROP POLICY IF EXISTS "Teachers update question sets" ON question_sets;
DROP POLICY IF EXISTS "Teachers delete question sets" ON question_sets;

CREATE POLICY "Users create question sets" ON question_sets
  FOR INSERT WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Users read question sets" ON question_sets
  FOR SELECT USING (auth.uid() = creator_id);

CREATE POLICY "Users update question sets" ON question_sets
  FOR UPDATE USING (auth.uid() = creator_id);

CREATE POLICY "Users delete question sets" ON question_sets
  FOR DELETE USING (auth.uid() = creator_id);
