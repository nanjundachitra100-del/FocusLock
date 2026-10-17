-- FocusLock Migration: 20261016000002_entertainment_and_blocked_sites.sql
-- Entertainment sessions lease tracking, user-configurable blocked websites,
-- and atomic reward spending functions for FocusLock Guardian.

-- 1. Entertainment Sessions Table
create table if not exists public.entertainment_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  minutes integer not null check (minutes > 0),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  status text not null default 'active'
    check (status in ('active', 'completed', 'expired', 'abandoned')),
  created_at timestamptz not null default now(),
  check (expires_at >= started_at),
  check (ended_at is null or ended_at >= started_at)
);

create index if not exists entertainment_sessions_user_status_idx
  on public.entertainment_sessions (user_id, status, expires_at desc);

-- 2. User Blocked Sites Table
create table if not exists public.user_blocked_sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  domain text not null check (char_length(domain) between 3 and 255),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, domain)
);

create index if not exists user_blocked_sites_user_id_idx
  on public.user_blocked_sites (user_id);

-- 3. Row Level Security Configuration
alter table public.entertainment_sessions enable row level security;
alter table public.entertainment_sessions force row level security;
alter table public.user_blocked_sites enable row level security;
alter table public.user_blocked_sites force row level security;

-- Policies for entertainment_sessions
create policy "Users can read their own entertainment sessions"
  on public.entertainment_sessions for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.entertainment_sessions from anon, authenticated;
grant select on table public.entertainment_sessions to authenticated;

-- Policies for user_blocked_sites
create policy "Users can read their own blocked sites"
  on public.user_blocked_sites for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own blocked sites"
  on public.user_blocked_sites for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own blocked sites"
  on public.user_blocked_sites for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own blocked sites"
  on public.user_blocked_sites for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.user_blocked_sites from anon, authenticated;
grant select, insert, update, delete on table public.user_blocked_sites to authenticated;

-- 4. Atomic Reward Spending RPC
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
  -- 1. Ensure user is authenticated
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Unauthorized: Must be logged in to spend reward minutes.';
  end if;

  -- 2. Validate input bounds
  if p_minutes is null or p_minutes <= 0 then
    raise exception 'Invalid minutes: must be greater than zero.';
  end if;

  -- The lock is held through session and ledger inserts until the RPC transaction commits.
  -- 3. Lock user profile to serialize concurrent spending requests for this user
  perform 1 from public.profiles where id = v_user_id for update;
  if not found then
    raise exception 'Profile not found for authenticated user.';
  end if;

  -- 4. Auto-expire any previous active sessions whose expires_at is past
  update public.entertainment_sessions
  set status = 'expired'
  where user_id = v_user_id
    and status = 'active'
    and expires_at <= pg_catalog.now();

  -- 5. Prevent duplicate concurrent active sessions
  select id into v_existing_id
  from public.entertainment_sessions
  where user_id = v_user_id
    and status = 'active'
    and expires_at > pg_catalog.now()
  limit 1;

  if v_existing_id is not null then
    raise exception 'An active entertainment session is already in progress.';
  end if;

  -- 6. Compute available minutes from the existing reward ledger
  select coalesce(sum(minutes), 0) into v_earned_minutes
  from public.reward_transactions
  where user_id = v_user_id and transaction_type = 'earned';

  select coalesce(sum(minutes), 0) into v_spent_minutes
  from public.reward_transactions
  where user_id = v_user_id and transaction_type = 'spent';

  v_available_minutes := greatest(0, v_earned_minutes - v_spent_minutes);

  -- 7. Reject insufficient balances
  if v_available_minutes < p_minutes then
    raise exception 'Insufficient reward balance: % minutes available, % minutes requested.',
      v_available_minutes, p_minutes;
  end if;

  -- 8. Assign or validate session ID
  if p_session_id is not null then
    v_session_id := p_session_id;
    if exists (select 1 from public.entertainment_sessions where id = v_session_id) then
      raise exception 'Entertainment session ID has already been used.';
    end if;
  else
    v_session_id := pg_catalog.gen_random_uuid();
  end if;

  -- These inserts are one function statement; any failure rolls both back.
  -- 9. Insert entertainment session
  v_started_at := pg_catalog.now();
  v_expires_at := v_started_at + (p_minutes || ' minutes')::interval;

  insert into public.entertainment_sessions (
    id,
    user_id,
    minutes,
    started_at,
    expires_at,
    status
  )
  values (
    v_session_id,
    v_user_id,
    p_minutes,
    v_started_at,
    v_expires_at,
    'active'
  );

  -- 10. Record spent transaction atomically in the reward ledger
  insert into public.reward_transactions (
    user_id,
    transaction_type,
    minutes,
    reference_id
  )
  values (
    v_user_id,
    'spent',
    p_minutes,
    v_session_id
  );

  -- 11. Recalculate remaining available balance
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

-- 5. End Entertainment Session RPC
create or replace function public.end_entertainment_session(
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_session record;
begin
  -- 1. Ensure user is authenticated
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Unauthorized: Must be logged in to end entertainment sessions.';
  end if;

  if p_session_id is null then
    raise exception 'Invalid session ID.';
  end if;

  -- 2. Fetch session and verify ownership
  select * into v_session
  from public.entertainment_sessions
  where id = p_session_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Entertainment session not found.';
  end if;

  -- 3. If already ended or expired, return current status safely (idempotent)
  if v_session.status in ('completed', 'expired', 'abandoned') then
    return jsonb_build_object(
      'session_id', v_session.id,
      'status', v_session.status,
      'ended_at', coalesce(v_session.ended_at, v_session.expires_at)
    );
  end if;

  -- 4. Mark session completed
  update public.entertainment_sessions
  set status = 'completed',
      ended_at = pg_catalog.now()
  where id = p_session_id
  returning * into v_session;

  return jsonb_build_object(
    'session_id', v_session.id,
    'status', v_session.status,
    'ended_at', v_session.ended_at
  );
end;
$$;

alter function public.end_entertainment_session(uuid) owner to postgres;
grant execute on function public.end_entertainment_session(uuid) to authenticated;
revoke all on function public.end_entertainment_session(uuid) from public, anon;
