-- Replace the authenticated-user RPC with a service-role-only entry point.
-- The caller must be the trusted server, which derives p_user_id from the
-- authenticated request and calculates the score from the sealed quiz token.
drop function if exists public.record_quiz_attempt_and_reward(uuid, integer, integer, uuid);

create function public.record_quiz_attempt_and_reward(
  p_user_id uuid,
  p_quiz_id uuid,
  p_score integer,
  p_total_questions integer,
  p_focus_session_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_passed boolean;
  v_reward_minutes integer;
  v_attempt_id uuid;
  v_earned_minutes integer;
  v_spent_minutes integer;
  v_available_minutes integer;
begin
  if p_user_id is null or not exists (
    select 1 from auth.users where id = p_user_id
  ) then
    raise exception 'Invalid quiz user.';
  end if;

  if p_quiz_id is null then
    raise exception 'Invalid quiz attempt ID.';
  end if;

  if p_total_questions is null or p_total_questions <= 0 then
    raise exception 'Invalid total_questions: must be greater than zero.';
  end if;

  if p_score is null or p_score < 0 or p_score > p_total_questions then
    raise exception 'Invalid score: must be between 0 and total_questions.';
  end if;

  if exists (select 1 from public.quiz_attempts where id = p_quiz_id) then
    raise exception 'Quiz attempt has already been submitted and recorded.';
  end if;

  v_passed := (p_score::numeric / p_total_questions::numeric) >= 0.8;
  v_reward_minutes := case when v_passed then 10 else 0 end;

  insert into public.quiz_attempts (
    id,
    user_id,
    focus_session_id,
    score,
    total_questions,
    passed
  )
  values (
    p_quiz_id,
    p_user_id,
    p_focus_session_id,
    p_score,
    p_total_questions,
    v_passed
  )
  returning id into v_attempt_id;

  if v_reward_minutes > 0 then
    if exists (
      select 1
      from public.reward_transactions
      where reference_id = p_quiz_id
        and transaction_type = 'earned'
    ) then
      raise exception 'Quiz reward reference has already been used.';
    end if;

    insert into public.reward_transactions (
      user_id,
      transaction_type,
      minutes,
      reference_id
    )
    values (
      p_user_id,
      'earned',
      v_reward_minutes,
      p_quiz_id
    );
  end if;

  select coalesce(sum(minutes), 0) into v_earned_minutes
  from public.reward_transactions
  where user_id = p_user_id and transaction_type = 'earned';

  select coalesce(sum(minutes), 0) into v_spent_minutes
  from public.reward_transactions
  where user_id = p_user_id and transaction_type = 'spent';

  v_available_minutes := greatest(0, v_earned_minutes - v_spent_minutes);

  return jsonb_build_object(
    'attempt_id', v_attempt_id,
    'passed', v_passed,
    'score', p_score,
    'total_questions', p_total_questions,
    'reward_minutes', v_reward_minutes,
    'available_minutes', v_available_minutes
  );
end;
$$;

alter function public.record_quiz_attempt_and_reward(uuid, uuid, integer, integer, uuid)
  owner to postgres;
revoke all on function public.record_quiz_attempt_and_reward(uuid, uuid, integer, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.record_quiz_attempt_and_reward(uuid, uuid, integer, integer, uuid)
  to service_role;
