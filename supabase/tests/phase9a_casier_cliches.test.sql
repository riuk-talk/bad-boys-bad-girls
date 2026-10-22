-- Phase 9a (pgTAP): les clichés déconseillés du Casier (SPEC §6 [P1]). Every test_* function runs
-- in its own rolled-back transaction (runtests).

create function pg_temp.new_user(p_email text) returns uuid language plpgsql as $$
declare uid uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', p_email, '',
    now(), '{}', '{}', now(), now());
  return uid;
end $$;

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end $$;

create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end $$;

create function pg_temp.test_starting_list() returns setof text language plpgsql as $$
begin
  return next is((select count(*)::int from public.casier_cliches where lang = 'fr' and is_active), 10,
    'the starting list of the SPEC, in French');
  return next is((select count(*)::int from public.casier_cliches where lang = 'en' and is_active), 10,
    'and its English counterpart');
  return next is((select array_agg(phrase order by phrase) from public.casier_cliches where needs_detail),
    array['disturbing the peace', 'tapage nocturne'], 'only « tapage nocturne » needs a detail');
end $$;

create function pg_temp.test_read_by_members_only() returns setof text language plpgsql as $$
declare m uuid := pg_temp.new_user('m@test.local');
begin
  update public.casier_cliches set is_active = false where phrase = 'trop beau';
  perform pg_temp.as_user(m);
  return next is((select count(*)::int from public.get_casier_cliches()), 19, 'a member reads the active list');
  return next ok(not exists (select 1 from public.get_casier_cliches() where phrase = 'trop beau'),
    'an inactive formula is not sent');
  return next is(pg_temp.try('select 1 from public.casier_cliches'), '42501', 'the table itself stays closed');
  return next is(pg_temp.try('insert into public.casier_cliches (lang, phrase) values (''fr'', ''beau gosse'')'),
    '42501', 'members write nothing');
  perform pg_temp.as_owner();
  perform pg_temp.as_anon();
  return next is(pg_temp.try('select * from public.get_casier_cliches()'), '42501', 'anon reads nothing');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
