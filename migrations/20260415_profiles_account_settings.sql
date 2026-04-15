ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS account_settings JSONB;

UPDATE profiles
SET account_settings = '{}'::jsonb
WHERE account_settings IS NULL;

ALTER TABLE profiles
ALTER COLUMN account_settings SET DEFAULT '{}'::jsonb;

ALTER TABLE profiles
ALTER COLUMN account_settings SET NOT NULL;
