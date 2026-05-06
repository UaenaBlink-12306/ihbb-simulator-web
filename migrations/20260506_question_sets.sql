-- Question Sets
CREATE TABLE IF NOT EXISTS question_sets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id UUID REFERENCES auth.users NOT NULL,
  title VARCHAR(255) NOT NULL,
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE question_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers create question sets" ON question_sets
  FOR INSERT WITH CHECK (auth.uid() = teacher_id);

CREATE POLICY "Teachers read question sets" ON question_sets
  FOR SELECT USING (auth.uid() = teacher_id);

CREATE POLICY "Teachers update question sets" ON question_sets
  FOR UPDATE USING (auth.uid() = teacher_id);

CREATE POLICY "Teachers delete question sets" ON question_sets
  FOR DELETE USING (auth.uid() = teacher_id);
