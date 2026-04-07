ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS avatar_id TEXT;

UPDATE profiles
SET avatar_id = 'penguin'
WHERE avatar_id IS NULL
   OR btrim(avatar_id) = ''
   OR avatar_id NOT IN ('cat', 'dog', 'fox', 'panda', 'rabbit', 'bear', 'tiger', 'lion', 'frog', 'penguin', 'owl', 'koala');

ALTER TABLE profiles
  ALTER COLUMN avatar_id SET DEFAULT 'penguin';

ALTER TABLE profiles
  ALTER COLUMN avatar_id SET NOT NULL;

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_avatar_id_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_avatar_id_check
  CHECK (avatar_id IN ('cat', 'dog', 'fox', 'panda', 'rabbit', 'bear', 'tiger', 'lion', 'frog', 'penguin', 'owl', 'koala'));
