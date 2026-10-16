-- FocusLock Migration: 20261016000001_record_quiz_and_reward.sql
-- Function to atomically record a quiz attempt and grant entertainment rewards if passed.
-- Runs with SECURITY DEFINER to allow authenticated users to safely record attempts and rewards
-- while keeping the underlying tables SELECT-only from client APIs.

create or replace function public.record_quiz_attempt_and_reward(
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
  v_user_id uuid;
  v_passed boolean;
  v_reward_minutes integer;
  v_attempt_id uuid;
  v_earned_minutes integer;
  v_spent_minutes integer;
  v_available_minutes integer;
begin
  -- 1. Ensure user is authenticated
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Unauthorized: Must be logged in to record quiz attempts.';
  end if;

  -- 2. Validate input bounds
  if p_total_questions is null or p_total_questions <= 0 then
    raise exception 'Invalid total_questions: must be greater than zero.';
  end if;

  if p_score is null or p_score < 0 or p_score > p_total_questions then
    raise exception 'Invalid score: must be between 0 and total_questions.';
  end if;

  -- 3. Check for replay attack: has this quiz_id already been recorded?
  if exists (select 1 from public.quiz_attempts where id = p_quiz_id) then
    raise exception 'Quiz attempt has already been submitted and recorded.';
  end if;

  -- 4. Calculate pass status strictly (80% threshold)
  v_passed := (p_score::numeric / p_total_questions::numeric) >= 0.8;

  -- 5. Calculate reward (10 minutes if passed, 0 if failed)
  if v_passed then
    v_reward_minutes := 10;
  else
    v_reward_minutes := 0;
  end if;

  -- 6. Insert quiz attempt
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
    v_user_id,
    p_focus_session_id,
    p_score,
    p_total_questions,
    v_passed
  )
  returning id into v_attempt_id;

  -- 7. If passed and reward minutes > 0, insert reward transaction idempotently
  if v_reward_minutes > 0 then
    if not exists (select 1 from public.reward_transactions where reference_id = p_quiz_id) then
      insert into public.reward_transactions (
        user_id,
        transaction_type,
        minutes,
        reference_id
      )
      values (
        v_user_id,
        'earned',
        v_reward_minutes,
        p_quiz_id
      );
    end if;
  end if;

  -- 8. Compute updated wallet ledger
  select coalesce(sum(minutes), 0) into v_earned_minutes
  from public.reward_transactions
  where user_id = v_user_id and transaction_type = 'earned';

  select coalesce(sum(minutes), 0) into v_spent_minutes
  from public.reward_transactions
  where user_id = v_user_id and transaction_type = 'spent';

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

-- Grant execution permission to authenticated users
grant execute on function public.record_quiz_attempt_and_reward(uuid, integer, integer, uuid) to authenticated;
revoke all on function public.record_quiz_attempt_and_reward(uuid, integer, integer, uuid) from public, anon;
