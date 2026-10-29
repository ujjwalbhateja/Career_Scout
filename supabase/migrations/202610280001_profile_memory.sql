-- Run as project administrator in Supabase SQL Editor, or with the Management API.
-- Identity is supplied by the existing trusted Sites backend. No second login.
begin;
create table if not exists public.career_profile_states (
  owner_id text primary key,
  revision bigint not null default 0,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.career_profile_usage (
  owner_id text not null,
  usage_date date not null default current_date,
  requests integer not null default 0,
  primary key(owner_id,usage_date)
);
alter table public.career_profile_states enable row level security;
alter table public.career_profile_usage enable row level security;
revoke all on public.career_profile_states,public.career_profile_usage from public,anon,authenticated,service_role;

create or replace function public.career_profile_guard(p_owner text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise insufficient_privilege; end if;
  if p_owner is null or length(p_owner)<3 or length(p_owner)>200 then raise exception 'invalid owner'; end if;
end;
$$;
create or replace function public.career_profile_load(p_owner text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.career_profile_guard(p_owner);
  select jsonb_build_object('revision',revision,'state',payload,'updatedAt',updated_at)
    into result from public.career_profile_states where owner_id=p_owner;
  return result;
end;
$$;
create or replace function public.career_profile_health()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform public.career_profile_guard('schema-health');
  return jsonb_build_object('schemaVersion',1,'migrationRevision','2026-10-29.2');
end;
$$;
create or replace function public.career_profile_save(p_owner text,p_revision bigint,p_state jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actual bigint;
begin
  perform public.career_profile_guard(p_owner);
  if jsonb_typeof(p_state)<>'object' or (p_state->>'schemaVersion') is distinct from '1'
    or octet_length(p_state::text)>12000000 then raise exception 'invalid profile state'; end if;
  insert into public.career_profile_states(owner_id,payload) values(p_owner,p_state) on conflict do nothing;
  select revision into actual from public.career_profile_states where owner_id=p_owner for update;
  if p_revision is null or actual<>p_revision then raise exception 'profile_revision_conflict' using errcode='PT409'; end if;
  update public.career_profile_states set payload=p_state,revision=actual+1,updated_at=now() where owner_id=p_owner;
  return jsonb_build_object('revision',actual+1,'state',p_state);
end;
$$;
create or replace function public.career_profile_reserve(p_owner text,p_limit integer default 80)
returns integer language plpgsql security definer set search_path='' as $$
declare total integer;
begin
  perform public.career_profile_guard(p_owner);
  if p_limit<1 or p_limit>200 then raise exception 'invalid budget'; end if;
  insert into public.career_profile_usage(owner_id,requests) values(p_owner,1)
    on conflict(owner_id,usage_date) do update set requests=public.career_profile_usage.requests+1
    returning requests into total;
  if total>p_limit then raise exception 'profile_daily_limit'; end if;
  return total;
end;
$$;
create or replace function public.career_profile_purge(p_owner text,p_revision bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare actual bigint; data jsonb;
begin
  perform public.career_profile_guard(p_owner);
  select revision,payload into actual,data from public.career_profile_states where owner_id=p_owner for update;
  if actual is null then return true; end if;
  if actual<>p_revision then raise exception 'profile_revision_conflict' using errcode='PT409'; end if;
  if data->'deletion'->>'status' is distinct from 'pending' then raise exception 'deletion not requested'; end if;
  -- Retain a content-free revision guard against stale in-flight saves.
  update public.career_profile_states set revision=actual+1,updated_at=now(),
    payload=jsonb_build_object('schemaVersion',1,'documents','[]'::jsonb,
      'facts','[]'::jsonb,'requirements','[]'::jsonb,'roleProfiles','[]'::jsonb,
      'questions','[]'::jsonb,'answers','[]'::jsonb,'approvals','[]'::jsonb,
      'snapshots','[]'::jsonb,'outbox','[]'::jsonb,'runs','[]'::jsonb,
      'preferences','{}'::jsonb,'deletion',null)
    where owner_id=p_owner;
  -- Usage is an account budget, separate from erased profile content.
  delete from public.career_profile_usage where owner_id=p_owner and usage_date<current_date;
  return true;
end;
$$;
revoke all on function public.career_profile_guard(text),public.career_profile_load(text),
  public.career_profile_health(),
  public.career_profile_save(text,bigint,jsonb),public.career_profile_reserve(text,integer),
  public.career_profile_purge(text,bigint) from public,anon,authenticated;
grant execute on function public.career_profile_load(text),public.career_profile_save(text,bigint,jsonb),
  public.career_profile_reserve(text,integer),public.career_profile_purge(text,bigint),
  public.career_profile_health() to service_role;
-- Storage is addressed only by server-generated owner/document paths.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('career-profile-private','career-profile-private',false,2000000,array[
  'application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'
]) on conflict(id) do nothing;
do $$ begin
  if exists(select 1 from storage.buckets where id='career-profile-private' and public) then
    raise exception 'career-profile-private must not be public';
  end if;
end $$;
-- Restrictive policies prevent broad existing browser policies exposing this bucket.
drop policy if exists career_profile_private_browser_deny on storage.objects;
create policy career_profile_private_browser_deny on storage.objects as restrictive
  for all to anon,authenticated
  using(bucket_id<>'career-profile-private') with check(bucket_id<>'career-profile-private');
commit;
