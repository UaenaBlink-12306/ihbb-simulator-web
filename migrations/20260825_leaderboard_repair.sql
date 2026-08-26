-- Leaderboard repair: guarantees the Global Top 100 and Class ranking RPCs
-- exist with the hardened, server-verified definitions and are callable by
-- signed-in students. Run once in the Supabase SQL Editor.
--
-- Background: after the security remediation (20260810023453), students saw
-- "Failed to load leaderboard rankings." because the deployed functions and
-- their EXECUTE privileges had drifted from the repository definitions.
-- This file normalizes both functions and their grants in one transaction,
-- so re-running it is always safe.

begin;

-- Prerequisite from the security remediation; re-asserted here so the
-- functions below can rely on server-verified submission flags.
alter table public.assignment_submissions add column if not exists verified boolean not null default false;

create or replace function public.get_leaderboard_global()
returns table(student_id uuid,display_name varchar,avatar_id varchar,total_correct bigint,total_answered bigint,rank bigint)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  return query with totals as (
    select s.student_id,sum(s.correct)::bigint tc,sum(s.total)::bigint ta from public.assignment_submissions s where s.verified group by s.student_id
  ) select t.student_id,p.display_name,p.avatar_id,t.tc,t.ta,dense_rank() over(order by t.tc desc,t.ta asc)
    from totals t join public.profiles p on p.id=t.student_id order by t.tc desc,t.ta asc;
end $$;
create or replace function public.get_leaderboard_class(p_class_id uuid)
returns table(student_id uuid,display_name varchar,avatar_id varchar,total_correct bigint,total_answered bigint,rank bigint)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.classes c where c.id=p_class_id and (c.teacher_id=auth.uid() or exists(
      select 1 from public.class_students me where me.class_id=p_class_id and me.student_id=auth.uid()))) then raise exception 'class membership required'; end if;
  return query with totals as (
    select s.student_id,sum(s.correct)::bigint tc,sum(s.total)::bigint ta
    from public.assignment_submissions s join public.assignments a on a.id=s.assignment_id
    where s.verified and a.class_id=p_class_id group by s.student_id
  ) select t.student_id,p.display_name,p.avatar_id,t.tc,t.ta,dense_rank() over(order by t.tc desc,t.ta asc)
    from totals t join public.profiles p on p.id=t.student_id order by t.tc desc,t.ta asc;
end $$;
revoke all on function public.get_leaderboard_global() from public, anon;
revoke all on function public.get_leaderboard_class(uuid) from public, anon;
grant execute on function public.get_leaderboard_global() to authenticated;
grant execute on function public.get_leaderboard_class(uuid) to authenticated;

commit;
