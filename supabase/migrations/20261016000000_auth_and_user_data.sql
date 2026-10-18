create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'abandoned')),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  check (duration_seconds is null or duration_seconds >= 0),
  check (ended_at is null or ended_at >= started_at),
  check (
    (status = 'in_progress' and ended_at is null)
    or (status in ('completed', 'abandoned') and ended_at is not null)
  )
);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  focus_session_id uuid,
  score integer not null,
  total_questions integer not null,
  passed boolean not null,
  created_at timestamptz not null default now(),
  check (total_questions > 0),
  check (score between 0 and total_questions),
  foreign key (focus_session_id, user_id)
    references public.focus_sessions (id, user_id) on delete cascade
);

create table public.reward_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  transaction_type text not null check (transaction_type in ('earned', 'spent')),
  minutes integer not null check (minutes > 0),
  reference_id uuid,
  created_at timestamptz not null default now()
);

create index focus_sessions_user_started_at_idx
  on public.focus_sessions (user_id, started_at desc);
create index quiz_attempts_user_created_at_idx
  on public.quiz_attempts (user_id, created_at desc);
create index reward_transactions_user_created_at_idx
  on public.reward_transactions (user_id, created_at desc);

create function public.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_profile_updated_at();

create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_name text;
begin
  requested_name := pg_catalog.left(
    pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')),
    80
  );

  if requested_name = '' then
    requested_name := pg_catalog.left(
      coalesce(
        nullif(pg_catalog.split_part(coalesce(new.email, ''), '@', 1), ''),
        'Learner'
      ),
      80
    );
  end if;

  insert into public.profiles (id, display_name)
  values (new.id, requested_name)
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

revoke all on function public.set_profile_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.focus_sessions enable row level security;
alter table public.focus_sessions force row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_attempts force row level security;
alter table public.reward_transactions enable row level security;
alter table public.reward_transactions force row level security;

create policy "Users can read their own profile"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

create policy "Users can update their own profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "Users can read their own focus sessions"
on public.focus_sessions for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can start their own focus sessions"
on public.focus_sessions for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and status = 'in_progress'
  and ended_at is null
  and duration_seconds is null
);

create policy "Users can update their own focus sessions"
on public.focus_sessions for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can read their own quiz attempts"
on public.quiz_attempts for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can read their own reward transactions"
on public.reward_transactions for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.focus_sessions from anon, authenticated;
revoke all on table public.quiz_attempts from anon, authenticated;
revoke all on table public.reward_transactions from anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;
grant select, insert on table public.focus_sessions to authenticated;
grant update (ended_at, duration_seconds, status) on table public.focus_sessions to authenticated;
grant select on table public.quiz_attempts to authenticated;
grant select on table public.reward_transactions to authenticated;