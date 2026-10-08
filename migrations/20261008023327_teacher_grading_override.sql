-- Keep grade writes behind a narrow, ownership-checked RPC. Students still
-- cannot update submissions or supply trusted teacher override metadata.
alter table public.assignment_submissions
  add column if not exists grading_overrides jsonb not null default '{}'::jsonb;

create schema if not exists ihbb_private;
revoke all on schema ihbb_private from public, anon;
grant usage on schema ihbb_private to authenticated;

create or replace function ihbb_private.override_assignment_grade(
  p_assignment_id uuid, p_student_id uuid, p_question_id text, p_mark_correct boolean
)
returns public.assignment_submissions
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  v_row public.assignment_submissions%rowtype;
  v_previous jsonb;
  v_active boolean;
  v_matched boolean;
  v_total integer;
  v_correct integer;
begin
  if caller is null then raise exception 'authentication required'; end if;
  if p_mark_correct is null or p_question_id is null then raise exception 'invalid grade action'; end if;
  if not exists (
    select 1 from public.assignments a join public.classes c on c.id=a.class_id
    where a.id=p_assignment_id and a.teacher_id=caller and c.teacher_id=caller
  ) then raise exception 'only the assignment teacher can override grades'; end if;

  select * into v_row from public.assignment_submissions
    where assignment_id=p_assignment_id and student_id=p_student_id and verified
    for update;
  if not found then raise exception 'verified submission unavailable'; end if;
  if not exists (
    select 1 from jsonb_array_elements(v_row.attempts) x
    join public.assignment_questions q on q.assignment_id=p_assignment_id and q.question_id=x->>'question_id'
    where q.question_id=p_question_id and x ? 'answer'
  ) then raise exception 'saved answer unavailable'; end if;

  -- Match the existing homework grader, including its legacy whitespace rule.
  select count(*), count(*) filter (where
    coalesce((v_row.grading_overrides->q.question_id->>'active')::boolean, false)
    or lower(regexp_replace(trim(x->>'answer'),'\\s+',' ','g')) = lower(regexp_replace(trim(q.answer_text),'\\s+',' ','g'))
    or exists(select 1 from jsonb_array_elements_text(coalesce(q.aliases,'[]'::jsonb)) a(value)
      where lower(regexp_replace(trim(a.value),'\\s+',' ','g'))=lower(regexp_replace(trim(x->>'answer'),'\\s+',' ','g')))
  ) into v_total, v_correct
  from jsonb_array_elements(v_row.attempts) x join public.assignment_questions q
    on q.assignment_id=p_assignment_id and q.question_id=x->>'question_id';
  if v_total <> v_row.total or v_correct <> v_row.correct then
    raise exception 'saved answers or answer key differ from the official grade; reload and review before overriding';
  end if;

  v_previous := v_row.grading_overrides->p_question_id;
  v_active := coalesce((v_previous->>'active')::boolean, false);
  if v_active = p_mark_correct then return v_row; end if;
  if p_mark_correct then
    select (
      lower(regexp_replace(trim(x->>'answer'),'\\s+',' ','g')) = lower(regexp_replace(trim(q.answer_text),'\\s+',' ','g'))
      or exists(select 1 from jsonb_array_elements_text(coalesce(q.aliases,'[]'::jsonb)) a(value)
        where lower(regexp_replace(trim(a.value),'\\s+',' ','g'))=lower(regexp_replace(trim(x->>'answer'),'\\s+',' ','g')))
    ) into v_matched
    from jsonb_array_elements(v_row.attempts) x join public.assignment_questions q
      on q.assignment_id=p_assignment_id and q.question_id=x->>'question_id'
    where q.question_id=p_question_id;
    if coalesce(v_matched, false) then raise exception 'answer is already correct'; end if;
  end if;

  update public.assignment_submissions set
    correct=correct + case when p_mark_correct then 1 else -1 end,
    grading_overrides=jsonb_set(grading_overrides, array[p_question_id], jsonb_build_object(
      'active', p_mark_correct, 'correct', true, 'original_correct', false,
      'teacher_id', caller, 'reviewed_at', now(),
      'history', coalesce(v_previous->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'action', case when p_mark_correct then 'mark_correct' else 'reset' end,
        'teacher_id', caller, 'reviewed_at', now()
      ))
    )), submitted_at=v_row.submitted_at
    where id=v_row.id returning * into v_row;
  return v_row;
end $$;
revoke all on function ihbb_private.override_assignment_grade(uuid,uuid,text,boolean) from public, anon;
grant execute on function ihbb_private.override_assignment_grade(uuid,uuid,text,boolean) to authenticated;

create or replace function public.override_assignment_grade(
  p_assignment_id uuid, p_student_id uuid, p_question_id text, p_mark_correct boolean
)
returns public.assignment_submissions
language sql security invoker set search_path = '' as $$
  select ihbb_private.override_assignment_grade(p_assignment_id,p_student_id,p_question_id,p_mark_correct);
$$;
revoke all on function public.override_assignment_grade(uuid,uuid,text,boolean) from public, anon;
grant execute on function public.override_assignment_grade(uuid,uuid,text,boolean) to authenticated;
