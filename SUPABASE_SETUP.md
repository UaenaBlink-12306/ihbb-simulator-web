# Supabase Database Setup Guide

Welcome to the IHBB Premium Drill Authentication integration. The codebase now natively supports Supabase Auth with Google/Microsoft SSO, Magic Links, and Role-Based onboarding.

To make everything work seamlessly, you must execute the following SQL in your **Supabase SQL Editor**.

## 1. Create Tables for Onboarding

We need `profiles` to store user roles (Teacher/Student) and `classes` to store the auto-generated join codes.

```sql
-- 1. Create Profiles Table (Triggered automatically upon signup or joined via Onboarding)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users NOT NULL PRIMARY KEY,
  role VARCHAR(50) CHECK (role IN ('student', 'teacher')),
  class_code VARCHAR(20) DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Turn on RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can insert their own profile." ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update their own profile." ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can read their own profile." ON profiles FOR SELECT USING (auth.uid() = id);

-- 2. Create Classes Table (Teachers create these)
CREATE TABLE classes (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  teacher_id UUID REFERENCES auth.users NOT NULL,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(20) UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Turn on RLS
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read classes to join them." ON classes FOR SELECT USING (true);
CREATE POLICY "Only teachers can insert classes." ON classes FOR INSERT WITH CHECK (auth.uid() = teacher_id);
```

## 2. Account Management & Security

### Rate Limiting
Rate limiting is handled automatically by Supabase for authentication routes (e.g., maximum password attempts per hour). You can configure these strict limits within the **Supabase Dashboard -> Auth -> Rate Limits**.

### Self-Serve Account Deletion
Because client-side JavaScript cannot securely delete user identities from the `auth.users` system table natively, we need to create a secure Postgres Function (RPC) that users can call when they want to delete their account.

```sql
-- Create a secure function to allow users to delete their own account
CREATE OR REPLACE FUNCTION delete_user()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  -- Delete from custom tables first
  DELETE FROM public.profiles WHERE id = auth.uid();
  DELETE FROM public.classes WHERE teacher_id = auth.uid();
  
  -- Delete the user identity from Supabase Auth
  DELETE FROM auth.users WHERE id = auth.uid();
$$;
```

To call this from the frontend when you add a specific settings page later:
`await supabase.rpc('delete_user'); await supabase.auth.signOut();`

---

## 3. Next Steps
1. Navigate to **`config.js`** and input your `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
2. Visit `login.html` locally and create your first account!
