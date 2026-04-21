-- Emergency reset for contaminated study-state data.
-- This removes only analytics, wrong-bank, and AI notebook rows.
-- It does NOT touch auth.users, profiles, classes, assignments, or submissions.

DELETE FROM public.user_wrong_questions;
DELETE FROM public.user_drill_sessions;
DELETE FROM public.user_coach_attempts;
