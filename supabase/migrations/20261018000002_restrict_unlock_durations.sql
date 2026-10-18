-- Restrict trusted session creation to the popup's supported unlock choices.
-- The reward ledger remains the balance source, and the profile row lock keeps
-- concurrent requests for one user serialized with their session and spend rows.
create or replace function public.spend_reward_minutes(
  p_minutes integer,
  p_session_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_session_id uuid;
  v_earned_minutes integer;
  v_spent_minutes integer;
  v_available_minutes integer;
  v_started_at timestamptz;
  v_expires_at timestamptz;
  v_existing_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Unauthorized: Must be logged in to spend reward minutes.';
  end if;

  if p_minutes is null or p_minutes not in (5, 10, 15, 30, 60) then
    raise exception 'Invalid minutes: must be one of 5, 10, 15, 30, or 60.';
  end if;

  perform 1 from public.profiles where id = v_user_id for update;
  if not found then
    raise exception 'Profile not found for authenticated user.';
  end if;

  update public.entertainment_sessions
  set status = 'expired'
  where user_id = v_user_id
    and status = 'active'
    and expires_at <= pg_catalog.now();

  select id into v_existing_id
  from public.entertainment_sessions
  where user_id = v_user_id
    and status = 'active'
    and expires_at > pg_catalog.now()
  limit 1;

  if v_existing_id is not null then
    raise exception 'An active entertainment session is already in progress.';
  end if;

  select coalesce(sum(minutes), 0) into v_earned_minutes
  from public.reward_transactions
  where user_id = v_user_id and transaction_type = 'earned';

  select coalesce(sum(minutes), 0) into v_spent_minutes
  from public.reward_transactions
  where user_id = v_user_id and transaction_type = 'spent';

  v_available_minutes := greatest(0, v_earned_minutes - v_spent_minutes);
  if v_available_minutes < p_minutes then
    raise exception 'Insufficient reward balance: % minutes available, % minutes requested.',
      v_available_minutes, p_minutes;
  end if;

  if p_session_id is not null then
    v_session_id := p_session_id;
    if exists (select 1 from public.entertainment_sessions where id = v_session_id) then
      raise exception 'Entertainment session ID has already been used.';
    end if;
  else
    v_session_id := pg_catalog.gen_random_uuid();
  end if;

  v_started_at := pg_catalog.now();
  v_expires_at := v_started_at + (p_minutes || ' minutes')::interval;

  insert into public.entertainment_sessions (
    id, user_id, minutes, started_at, expires_at, status
  ) values (
    v_session_id, v_user_id, p_minutes, v_started_at, v_expires_at, 'active'
  );

  insert into public.reward_transactions (
    user_id, transaction_type, minutes, reference_id
  ) values (
    v_user_id, 'spent', p_minutes, v_session_id
  );

  v_available_minutes := v_available_minutes - p_minutes;
  return jsonb_build_object(
    'session_id', v_session_id,
    'minutes', p_minutes,
    'started_at', v_started_at,
    'expires_at', v_expires_at,
    'status', 'active',
    'available_minutes', v_available_minutes
  );
end;
$$;

alter function public.spend_reward_minutes(integer, uuid) owner to postgres;
grant execute on function public.spend_reward_minutes(integer, uuid) to authenticated;
revoke all on function public.spend_reward_minutes(integer, uuid) from public, anon;
