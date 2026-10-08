begin;
do $test$
declare
  teacher uuid; student uuid; outsider uuid := gen_random_uuid();
  cls uuid := gen_random_uuid(); assignment uuid := gen_random_uuid();
  saved public.assignment_submissions%rowtype; original_time timestamptz := now() - interval '1 day';
  denied boolean := false;
begin
  select id into teacher from public.profiles where role='teacher' order by created_at limit 1;
  select id into student from public.profiles where role='student' order by created_at limit 1;
  if teacher is null or student is null then raise exception 'existing users needed'; end if;
  insert into public.classes(id, teacher_id, name, code) values(cls,teacher,'Codex rollback-only grading QA',substr(md5(cls::text),1,6));
  insert into public.assignments(id,class_id,teacher_id,title) values(assignment,cls,teacher,'Codex rollback-only grading QA');
  insert into public.class_students(class_id,student_id) values(cls,student);
  insert into public.assignment_questions(assignment_id,question_id,question_text,answer_text,aliases) values
    (assignment,'q1','Empire?','Roman Empire','["Rome"]'), (assignment,'q2','Dynasty?','Han','[]');
  insert into public.assignment_submissions(assignment_id,student_id,total,correct,verified,attempts,submitted_at) values
    (assignment,student,2,1,true,'[{"question_id":"q1","answer":"Rome"},{"question_id":"q2","answer":"Han Dynasty"}]',original_time);
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', student::text, true);
  begin
    perform public.override_assignment_grade(assignment,student,'q2',true);
  exception when others then
    if sqlerrm <> 'only the assignment teacher can override grades' then raise; end if;
    denied := true;
  end;
  if not denied then raise exception 'student self-grading allowed'; end if;
  denied := false;
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  begin
    perform public.override_assignment_grade(assignment,student,'q2',true);
  exception when others then
    if sqlerrm <> 'only the assignment teacher can override grades' then raise; end if;
    denied := true;
  end;
  if not denied then raise exception 'unrelated user grading allowed'; end if;
  perform set_config('request.jwt.claim.sub', teacher::text, true);
  saved := public.override_assignment_grade(assignment,student,'q2',true);
  if saved.correct<>2 or saved.total<>2 or saved.submitted_at<>original_time or saved.attempts->1->>'answer'<>'Han Dynasty' then raise exception 'correction failed'; end if;
  if saved.grading_overrides->'q2'->>'teacher_id'<>teacher::text then raise exception 'reviewer missing'; end if;
  saved := public.override_assignment_grade(assignment,student,'q2',true);
  if saved.correct<>2 or jsonb_array_length(saved.grading_overrides->'q2'->'history')<>1 then raise exception 'repeat correction not idempotent'; end if;
  perform set_config('request.jwt.claim.sub', student::text, true);
  saved := public.submit_assignment_attempts(assignment,'[{"question_id":"q1","answer":"Rome"},{"question_id":"q2","answer":"Wrong"}]');
  if saved.correct<>2 or saved.attempts->1->>'answer'<>'Han Dynasty' then raise exception 'student resubmission erased correction'; end if;
  perform set_config('request.jwt.claim.sub', teacher::text, true);
  saved := public.override_assignment_grade(assignment,student,'q2',false);
  if saved.correct<>1 or (saved.grading_overrides->'q2'->>'active')::boolean then raise exception 'undo failed'; end if;
  saved := public.override_assignment_grade(assignment,student,'q2',false);
  if saved.correct<>1 or jsonb_array_length(saved.grading_overrides->'q2'->'history')<>2 then raise exception 'repeat undo not idempotent'; end if;
  denied := false;
  begin
    perform public.override_assignment_grade(assignment,student,'missing',true);
  exception when others then
    if sqlerrm <> 'saved answer unavailable' then raise; end if; denied:=true;
  end;
  if not denied then raise exception 'missing question accepted'; end if;
  denied := false;
  begin
    perform public.override_assignment_grade(assignment,student,'q1',true);
  exception when others then
    if sqlerrm <> 'answer is already correct' then raise; end if; denied:=true;
  end;
  if not denied then raise exception 'already-correct answer accepted'; end if;
  if has_table_privilege('authenticated','public.assignment_submissions','UPDATE') then raise exception 'direct score updates allowed'; end if;
  if has_function_privilege('anon','public.override_assignment_grade(uuid,uuid,text,boolean)','EXECUTE') then raise exception 'anonymous grading allowed'; end if;
end $test$;
rollback;
select 'PASS: correction, undo, duplicate actions, ownership, original response/time, student resubmission, invalid questions, and grants; all fixtures rolled back' as result;
