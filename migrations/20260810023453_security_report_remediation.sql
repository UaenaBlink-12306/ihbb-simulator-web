begin;

-- Schema additions needed by server-verified writes.
alter table public.assignment_questions add column if not exists aliases jsonb not null default '[]'::jsonb;
alter table public.assignment_questions add column if not exists source text default '';
alter table public.assignment_submissions add column if not exists verified boolean not null default false;
alter table public.assignment_submissions add column if not exists attempts jsonb not null default '[]'::jsonb;
alter table public.user_drill_sessions add column if not exists verified boolean not null default false;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='question_sets' and column_name='teacher_id')
     and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='question_sets' and column_name='creator_id') then
    alter table public.question_sets rename column teacher_id to creator_id;
  end if;
end $$;
alter table public.question_sets add column if not exists visibility varchar(20) not null default 'private';
alter table public.question_sets add column if not exists class_id uuid references public.classes(id) on delete set null;
alter table public.question_sets add column if not exists creator_role varchar(20) default '';
alter table public.question_sets drop constraint if exists question_sets_visibility_check;
alter table public.question_sets add constraint question_sets_visibility_check check (visibility in ('private','public','class'));

create table if not exists public.livebee_game_reviews (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.bee_rooms(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade not null,
  room_code text not null,
  host_name text default '',
  player_count integer default 0 check (player_count between 0 and 100),
  my_rank integer,
  my_score integer default 0 check (my_score between 0 and 100000),
  created_at timestamptz default now(),
  standings jsonb not null default '[]'::jsonb,
  review jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb
);
alter table public.livebee_game_reviews enable row level security;
create index if not exists idx_livebee_game_reviews_user on public.livebee_game_reviews(user_id, created_at desc);

-- Durable, atomic rate limits for paid AI and administrator authentication.
create table if not exists public.security_rate_limits (
  bucket text not null,
  subject text not null,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0,
  primary key (bucket, subject)
);
alter table public.security_rate_limits enable row level security;
revoke all on public.security_rate_limits from public, anon, authenticated;

create or replace function public.consume_security_rate_limit(
  p_bucket text, p_subject text, p_limit integer, p_window_seconds integer
) returns table(allowed boolean, retry_after_seconds integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.security_rate_limits%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if length(coalesce(p_bucket,'')) not between 1 and 80
     or length(coalesce(p_subject,'')) not between 1 and 200
     or p_limit not between 1 and 10000
     or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid rate-limit parameters';
  end if;
  insert into public.security_rate_limits(bucket, subject, window_started_at, request_count)
  values (p_bucket, p_subject, v_now, 1)
  on conflict (bucket, subject) do update set
    window_started_at = case when public.security_rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= v_now then v_now else public.security_rate_limits.window_started_at end,
    request_count = case when public.security_rate_limits.window_started_at + make_interval(secs => p_window_seconds) <= v_now then 1 else public.security_rate_limits.request_count + 1 end
  returning * into v_row;
  allowed := v_row.request_count <= p_limit;
  retry_after_seconds := greatest(1, ceil(extract(epoch from (v_row.window_started_at + make_interval(secs => p_window_seconds) - v_now)))::integer);
  return next;
end $$;
revoke all on function public.consume_security_rate_limit(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_security_rate_limit(text,text,integer,integer) to service_role;

-- Replace all direct class/assignment/question-set mutation policies with invariant-bound policies or RPCs.
do $$ declare p record; begin
  for p in select schemaname, tablename, policyname from pg_policies
    where schemaname='public' and tablename in ('class_students','assignments','assignment_questions','assignment_submissions','question_sets')
  loop execute format('drop policy if exists %I on %I.%I',p.policyname,p.schemaname,p.tablename); end loop;
end $$;

create policy "Members read class membership" on public.class_students for select to authenticated using (
  student_id=auth.uid() or exists(select 1 from public.classes c where c.id=class_id and c.teacher_id=auth.uid())
);
create policy "Students leave classes" on public.class_students for delete to authenticated using (student_id=auth.uid());
revoke insert, update on public.class_students from anon, authenticated;

drop function if exists public.join_class_by_code(text);
create function public.join_class_by_code(p_code text)
returns table(id uuid, name varchar, code varchar)
language plpgsql security definer set search_path = '' as $$
declare target public.classes%rowtype; caller uuid := auth.uid();
begin
  if caller is null then raise exception 'authentication required'; end if;
  select * into target from public.classes c where upper(c.code)=upper(trim(p_code)) limit 1;
  if target.id is null then raise exception 'class not found'; end if;
  insert into public.class_students(class_id,student_id) values(target.id,caller) on conflict(class_id,student_id) do nothing;
  return query select target.id,target.name,target.code;
end $$;
revoke all on function public.join_class_by_code(text) from public, anon;
grant execute on function public.join_class_by_code(text) to authenticated;

create policy "Class members read assignments" on public.assignments for select to authenticated using (
  teacher_id=auth.uid() or exists(select 1 from public.class_students cs where cs.class_id=assignments.class_id and cs.student_id=auth.uid())
);
create policy "Teachers create owned-class assignments" on public.assignments for insert to authenticated with check (
  teacher_id=auth.uid() and exists(select 1 from public.classes c where c.id=class_id and c.teacher_id=auth.uid())
);
create policy "Teachers update owned-class assignments" on public.assignments for update to authenticated
  using (teacher_id=auth.uid() and exists(select 1 from public.classes c where c.id=class_id and c.teacher_id=auth.uid()))
  with check (teacher_id=auth.uid() and exists(select 1 from public.classes c where c.id=class_id and c.teacher_id=auth.uid()));
create policy "Teachers delete owned-class assignments" on public.assignments for delete to authenticated using (
  teacher_id=auth.uid() and exists(select 1 from public.classes c where c.id=class_id and c.teacher_id=auth.uid())
);

create policy "Assignment members read questions" on public.assignment_questions for select to authenticated using (
  exists(select 1 from public.assignments a where a.id=assignment_id and (a.teacher_id=auth.uid() or exists(
    select 1 from public.class_students cs where cs.class_id=a.class_id and cs.student_id=auth.uid()
  )))
);
create policy "Owned-class teachers insert questions" on public.assignment_questions for insert to authenticated with check (
  exists(select 1 from public.assignments a join public.classes c on c.id=a.class_id
    where a.id=assignment_id and a.teacher_id=auth.uid() and c.teacher_id=auth.uid())
);
create policy "Owned-class teachers delete questions" on public.assignment_questions for delete to authenticated using (
  exists(select 1 from public.assignments a join public.classes c on c.id=a.class_id
    where a.id=assignment_id and a.teacher_id=auth.uid() and c.teacher_id=auth.uid())
);

create policy "Students and teachers read verified submissions" on public.assignment_submissions for select to authenticated using (
  student_id=auth.uid() or exists(select 1 from public.assignments a where a.id=assignment_id and a.teacher_id=auth.uid())
);
revoke insert, update on public.assignment_submissions from anon, authenticated;

create or replace function public.submit_assignment_attempts(p_assignment_id uuid, p_attempts jsonb)
returns public.assignment_submissions
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); v_total integer; v_unique integer; v_correct integer; v_row public.assignment_submissions%rowtype;
begin
  if caller is null then raise exception 'authentication required'; end if;
  if jsonb_typeof(p_attempts) <> 'array' or jsonb_array_length(p_attempts) > 200 then raise exception 'invalid attempts'; end if;
  if not exists(select 1 from public.assignments a join public.class_students cs on cs.class_id=a.class_id
      where a.id=p_assignment_id and cs.student_id=caller) then raise exception 'assignment unavailable'; end if;
  select count(*) into v_total from public.assignment_questions q where q.assignment_id=p_assignment_id;
  select count(distinct x->>'question_id') into v_unique from jsonb_array_elements(p_attempts) x;
  if v_total=0 or jsonb_array_length(p_attempts)<>v_total or v_unique<>v_total then raise exception 'attempt set does not match assignment'; end if;
  if exists(select 1 from jsonb_array_elements(p_attempts) x left join public.assignment_questions q
      on q.assignment_id=p_assignment_id and q.question_id=x->>'question_id'
      where q.id is null or jsonb_typeof(x) <> 'object' or length(coalesce(x->>'answer',''))>500) then
    raise exception 'invalid assignment attempt';
  end if;
  select count(*) into v_correct
  from jsonb_array_elements(p_attempts) x join public.assignment_questions q
    on q.assignment_id=p_assignment_id and q.question_id=x->>'question_id'
  where lower(regexp_replace(trim(x->>'answer'),'\s+',' ','g')) = lower(regexp_replace(trim(q.answer_text),'\s+',' ','g'))
     or exists(select 1 from jsonb_array_elements_text(coalesce(q.aliases,'[]'::jsonb)) a(value)
       where lower(regexp_replace(trim(a.value),'\s+',' ','g'))=lower(regexp_replace(trim(x->>'answer'),'\s+',' ','g')));
  insert into public.assignment_submissions(assignment_id,student_id,total,correct,verified,attempts,submitted_at)
  values(p_assignment_id,caller,v_total,v_correct,true,p_attempts,now())
  on conflict(assignment_id,student_id) do update set total=excluded.total,correct=excluded.correct,
    verified=true,attempts=excluded.attempts,submitted_at=excluded.submitted_at
  where not public.assignment_submissions.verified
  returning * into v_row;
  if v_row.id is null then select * into v_row from public.assignment_submissions where assignment_id=p_assignment_id and student_id=caller; end if;
  return v_row;
end $$;
revoke all on function public.submit_assignment_attempts(uuid,jsonb) from public, anon;
grant execute on function public.submit_assignment_attempts(uuid,jsonb) to authenticated;

create policy "Authorized users read question sets" on public.question_sets for select to authenticated using (
  creator_id=auth.uid() or visibility='public' or (visibility='class' and class_id is not null and (
    exists(select 1 from public.classes c where c.id=class_id and c.teacher_id=auth.uid()) or
    exists(select 1 from public.class_students cs where cs.class_id=question_sets.class_id and cs.student_id=auth.uid())
  ))
);
create policy "Creators insert valid question sets" on public.question_sets for insert to authenticated with check (
  creator_id=auth.uid() and (visibility<>'class' or (class_id is not null and (
    exists(select 1 from public.classes c where c.id=class_id and c.teacher_id=auth.uid()) or
    exists(select 1 from public.class_students cs where cs.class_id=question_sets.class_id and cs.student_id=auth.uid())
  )))
);
create policy "Creators update valid question sets" on public.question_sets for update to authenticated using (creator_id=auth.uid()) with check (
  creator_id=auth.uid() and (visibility<>'class' or (class_id is not null and (
    exists(select 1 from public.classes c where c.id=class_id and c.teacher_id=auth.uid()) or
    exists(select 1 from public.class_students cs where cs.class_id=question_sets.class_id and cs.student_id=auth.uid())
  )))
);
create policy "Creators delete question sets" on public.question_sets for delete to authenticated using (creator_id=auth.uid());

-- Leaderboards and streaks require authentication and compute only server-verified scores.
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

create or replace function public.get_user_practice_streak(p_user_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare result integer;
begin
  if auth.uid() is null or (auth.uid()<>p_user_id and not exists(select 1 from public.class_students cs join public.classes c on c.id=cs.class_id where cs.student_id=p_user_id and c.teacher_id=auth.uid())) then
    raise exception 'not authorized';
  end if;
  with recursive days as (select current_date d,0 n union all select d-1,n+1 from days where n<365), active as (
    select distinct (created_at at time zone 'utc')::date d from public.user_drill_sessions where user_id=p_user_id
  ) select count(*)::integer into result from days where n < coalesce((select min(n) from days where d not in(select d from active)),0);
  return coalesce(result,0);
end $$;
revoke all on function public.get_user_practice_streak(uuid) from public, anon;
grant execute on function public.get_user_practice_streak(uuid) to authenticated;

-- Live Bee: joining and final scoring are server-authoritative; clients cannot write scores or reviews.
create or replace function public.can_access_bee_room(p_room_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.bee_rooms br where br.id=p_room_id and (br.host_id=auth.uid() or exists(select 1 from public.bee_participants bp where bp.room_id=p_room_id and bp.user_id=auth.uid())))
$$;
create or replace function public.is_bee_room_host(p_room_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select exists(select 1 from public.bee_rooms br where br.id=p_room_id and br.host_id=auth.uid()) $$;
revoke all on function public.can_access_bee_room(uuid) from public, anon;
revoke all on function public.is_bee_room_host(uuid) from public, anon;
grant execute on function public.can_access_bee_room(uuid),public.is_bee_room_host(uuid) to authenticated;

do $$ declare p record; begin
  for p in select schemaname,tablename,policyname from pg_policies where schemaname='public' and tablename in ('bee_rooms','bee_participants','livebee_game_reviews')
  loop execute format('drop policy if exists %I on %I.%I',p.policyname,p.schemaname,p.tablename); end loop;
end $$;
create policy "Host or participant reads room" on public.bee_rooms for select to authenticated using (
  host_id=auth.uid() or exists(select 1 from public.bee_participants bp where bp.room_id=bee_rooms.id and bp.user_id=auth.uid())
);
create policy "Host creates room" on public.bee_rooms for insert to authenticated with check(host_id=auth.uid());
create policy "Host updates room" on public.bee_rooms for update to authenticated using(host_id=auth.uid()) with check(host_id=auth.uid());
create policy "Host deletes room" on public.bee_rooms for delete to authenticated using(host_id=auth.uid());
create policy "Room members read participants" on public.bee_participants for select to authenticated using (
  public.can_access_bee_room(room_id)
);
create policy "Participants leave room" on public.bee_participants for delete to authenticated using(user_id=auth.uid());
revoke insert, update on public.bee_participants from anon, authenticated;

drop function if exists public.join_bee_room_by_code(text,text);
create function public.join_bee_room_by_code(p_code text,p_display_name text default null)
returns table(id uuid,code varchar,host_id uuid,status varchar,participant_count integer)
language plpgsql security definer set search_path = '' as $$
declare r public.bee_rooms%rowtype; caller uuid:=auth.uid(); count_now integer;
begin
  if caller is null then raise exception 'authentication required'; end if;
  if length(coalesce(p_display_name,''))>100 then raise exception 'display name too long'; end if;
  select * into r from public.bee_rooms b where upper(b.code)=upper(trim(p_code)) and b.status='waiting' for update;
  if r.id is null then raise exception 'room not found or already started'; end if;
  select count(*) into count_now from public.bee_participants where room_id=r.id;
  if count_now>=8 then raise exception 'room is full'; end if;
  insert into public.bee_participants(room_id,user_id,display_name,score) values(r.id,caller,left(coalesce(p_display_name,''),100),0)
    on conflict(room_id,user_id) do update set display_name=excluded.display_name;
  return query select r.id,r.code,r.host_id,r.status,(select count(*)::integer from public.bee_participants where room_id=r.id);
end $$;
revoke all on function public.join_bee_room_by_code(text,text) from public, anon;
grant execute on function public.join_bee_room_by_code(text,text) to authenticated;

create policy "Users read own reviews" on public.livebee_game_reviews for select to authenticated using (
  user_id=auth.uid() or exists(select 1 from public.class_students cs join public.classes c on c.id=cs.class_id where cs.student_id=livebee_game_reviews.user_id and c.teacher_id=auth.uid())
);
revoke insert, update, delete on public.livebee_game_reviews from anon, authenticated;

create or replace function public.finish_bee_game(p_room_id uuid,p_scores jsonb,p_review jsonb,p_summary jsonb,p_host_name text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare r public.bee_rooms%rowtype; participant record; standing jsonb; v_rank integer; v_score integer; v_count integer;
begin
  select * into r from public.bee_rooms where id=p_room_id for update;
  if r.id is null or r.host_id<>auth.uid() then raise exception 'host authority required'; end if;
  if jsonb_typeof(p_scores)<>'object' or (select count(*) from jsonb_object_keys(p_scores))>8 or jsonb_typeof(p_review)<>'array' or jsonb_array_length(p_review)>100 or jsonb_typeof(p_summary)<>'object' then raise exception 'invalid game result'; end if;
  if exists(select 1 from jsonb_each_text(p_scores) s where s.key !~ '^[0-9a-fA-F-]{36}$' or s.value !~ '^\d{1,6}$' or case when s.value ~ '^\d{1,6}$' then s.value::integer>100000 else false end) then raise exception 'invalid score'; end if;
  if exists(select 1 from jsonb_array_elements(p_review) q where jsonb_typeof(q)<>'object' or length(coalesce(q->>'question',''))>2000 or length(coalesce(q->>'answer',''))>1000) then raise exception 'invalid review'; end if;
  update public.bee_participants bp set score=(p_scores->>bp.user_id::text)::integer
    where bp.room_id=p_room_id and p_scores ? bp.user_id::text;
  update public.bee_rooms set status='finished' where id=p_room_id;
  select count(*) into v_count from public.bee_participants where room_id=p_room_id;
  for participant in select bp.*,row_number() over(order by bp.score desc,bp.display_name)::integer pos from public.bee_participants bp where bp.room_id=p_room_id loop
    v_rank:=participant.pos; v_score:=participant.score;
    insert into public.livebee_game_reviews(room_id,user_id,room_code,host_name,player_count,my_rank,my_score,standings,review,summary)
    values(p_room_id,participant.user_id,r.code,left(coalesce(p_host_name,''),100),v_count,v_rank,v_score,
      (select coalesce(jsonb_agg(jsonb_build_object('rank',x.pos,'name',x.display_name,'score',x.score,'avatarId',coalesce(pr.avatar_id,'')) order by x.pos),'[]'::jsonb)
       from (select bp2.*,row_number() over(order by bp2.score desc,bp2.display_name)::integer pos from public.bee_participants bp2 where bp2.room_id=p_room_id) x left join public.profiles pr on pr.id=x.user_id),
      p_review,p_summary);
  end loop;
end $$;
revoke all on function public.finish_bee_game(uuid,jsonb,jsonb,jsonb,text) from public, anon;
grant execute on function public.finish_bee_game(uuid,jsonb,jsonb,jsonb,text) to authenticated;

-- Private Realtime channels: only the host may publish authority events.
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='realtime' and tablename='messages' and policyname like 'LiveBee %'
  loop execute format('drop policy if exists %I on realtime.messages',p.policyname); end loop;
end $$;
create policy "LiveBee members receive broadcasts" on realtime.messages for select to authenticated using (
  case when realtime.topic() ~ '^bee-(host|player):[0-9a-fA-F-]{36}$' then public.can_access_bee_room(split_part(realtime.topic(),':',2)::uuid) else false end
);
create policy "LiveBee host sends authority" on realtime.messages for insert to authenticated with check (
  case when realtime.topic() ~ '^bee-host:[0-9a-fA-F-]{36}$' then extension='broadcast' and public.is_bee_room_host(split_part(realtime.topic(),':',2)::uuid) else false end
);
create policy "LiveBee members send player events" on realtime.messages for insert to authenticated with check (
  case when realtime.topic() ~ '^bee-player:[0-9a-fA-F-]{36}$' then extension='broadcast' and public.can_access_bee_room(split_part(realtime.topic(),':',2)::uuid) else false end
);

commit;
