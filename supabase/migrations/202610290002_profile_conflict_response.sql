-- Small correction for projects that already ran the first Profile migration.
-- Changes conflict responses to HTTP 409; preserves tables, records and grants.
begin;
do $$
declare signature text; definition text;
begin
  foreach signature in array array[
    'public.career_profile_save(text,bigint,jsonb)',
    'public.career_profile_purge(text,bigint)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    definition := replace(definition, '''40001''', '''PT409''');
    if position('''PT409''' in definition)=0 then
      raise exception 'Expected conflict guard missing in %', signature;
    end if;
    execute definition;
  end loop;
end $$;
create or replace function public.career_profile_health()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform public.career_profile_guard('schema-health');
  return jsonb_build_object('schemaVersion',1,'migrationRevision','2026-10-29.2');
end;
$$;
revoke all on function public.career_profile_health() from public,anon,authenticated;
grant execute on function public.career_profile_health() to service_role;
commit;
