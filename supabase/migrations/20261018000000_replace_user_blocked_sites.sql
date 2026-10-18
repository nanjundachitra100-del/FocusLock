-- FocusLock Migration: 20261018000000_replace_user_blocked_sites.sql
-- Atomically replace the authenticated user's blocked-site list.
-- Ownership is always derived from auth.uid(); callers cannot supply a user_id.

create or replace function public.replace_user_blocked_sites(
  p_sites jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_count integer;
  v_item jsonb;
  v_raw text;
  v_domain text;
  v_enabled boolean;
  v_label text;
  v_domains text[] := '{}';
  v_enableds boolean[] := '{}';
  v_result jsonb;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Unauthorized: Must be logged in to update blocked sites.';
  end if;

  if p_sites is null or pg_catalog.jsonb_typeof(p_sites) <> 'array' then
    raise exception 'Blocked sites payload must be a JSON array.';
  end if;

  v_count := pg_catalog.jsonb_array_length(p_sites);
  if v_count is null or v_count < 1 or v_count > 50 then
    raise exception 'Blocked sites must contain between 1 and 50 entries.';
  end if;

  -- Serialize concurrent replacements for this user only.
  perform 1 from public.profiles where id = v_user_id for update;
  if not found then
    raise exception 'Profile not found for authenticated user.';
  end if;

  for v_item in
    select value
    from pg_catalog.jsonb_array_elements(p_sites) as t(value)
  loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object' then
      raise exception 'One or more blocked site entries are invalid.';
    end if;

    if pg_catalog.jsonb_typeof(v_item -> 'domain') <> 'string' then
      raise exception 'One or more blocked site entries are invalid.';
    end if;

    if v_item ? 'enabled' and pg_catalog.jsonb_typeof(v_item -> 'enabled') <> 'boolean' then
      raise exception 'One or more blocked site entries are invalid.';
    end if;

    v_raw := lower(btrim(v_item ->> 'domain'));
    v_raw := pg_catalog.regexp_replace(v_raw, '^https?://', '', 'i');
    v_raw := pg_catalog.regexp_replace(v_raw, '^www\.', '', 'i');
    v_raw := btrim(
      pg_catalog.split_part(
        pg_catalog.split_part(
          pg_catalog.split_part(v_raw, '/', 1),
          '?',
          1
        ),
        '#',
        1
      )
    );

    if char_length(v_raw) > 253 then
      raise exception 'One or more website domains are invalid.';
    end if;

    foreach v_label in array pg_catalog.string_to_array(v_raw, '.')
    loop
      if char_length(v_label) > 63 then
        raise exception 'One or more website domains are invalid.';
      end if;
    end loop;

    if v_raw is null
      or v_raw = ''
      or v_raw !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
    then
      raise exception 'One or more website domains are invalid.';
    end if;

    v_domain := v_raw;
    v_enabled := coalesce((v_item ->> 'enabled')::boolean, true);

    if v_domain = any (v_domains) then
      continue;
    end if;

    v_domains := array_append(v_domains, v_domain);
    v_enableds := array_append(v_enableds, v_enabled);
  end loop;

  if pg_catalog.cardinality(v_domains) < 1 then
    raise exception 'Blocked sites must contain between 1 and 50 entries.';
  end if;

  delete from public.user_blocked_sites
  where user_id = v_user_id
    and not (domain = any (v_domains));

  insert into public.user_blocked_sites (
    user_id,
    domain,
    enabled,
    updated_at
  )
  select
    v_user_id,
    site.domain,
    site.enabled,
    pg_catalog.now()
  from pg_catalog.unnest(v_domains, v_enableds) as site(domain, enabled)
  on conflict (user_id, domain) do update
    set enabled = excluded.enabled,
        updated_at = excluded.updated_at;

  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'domain', site.domain,
      'enabled', site.enabled
    )
    order by site.domain
  )
  into v_result
  from public.user_blocked_sites as site
  where site.user_id = v_user_id;

  return pg_catalog.jsonb_build_object('sites', coalesce(v_result, '[]'::jsonb));
end;
$$;

alter function public.replace_user_blocked_sites(jsonb) owner to postgres;
grant execute on function public.replace_user_blocked_sites(jsonb) to authenticated;
revoke all on function public.replace_user_blocked_sites(jsonb) from public, anon;
