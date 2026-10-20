-- Phase 8b (pgTAP): real Core Web Vitals, aggregated without identifier (SPEC §18). Every test_*
-- function runs in its own rolled-back transaction (runtests).

----------------------------------------------------------------------------------------------
-- Helpers
----------------------------------------------------------------------------------------------
create function pg_temp.new_user(p_email text) returns uuid language plpgsql as $$
declare uid uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', p_email, '',
    now(), '{}', '{}', now(), now());
  return uid;
end $$;

create function pg_temp.as_user(p_uid uuid, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
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

----------------------------------------------------------------------------------------------
-- Recording
----------------------------------------------------------------------------------------------
create function pg_temp.test_record() returns setof text language plpgsql as $$
declare i integer;
begin
  -- Measures already counted (e2e runs on the same base) stay out of the test (rolled back).
  delete from public.web_vitals_daily;
  perform pg_temp.as_service();
  return next ok(public.record_web_vital('promenade', 'LCP', 1800), 'a measure is counted');
  return next ok(not public.record_web_vital('fiche/42', 'LCP', 1800), 'an unknown page is ignored');
  return next ok(not public.record_web_vital('landing', 'FID', 10), 'an unknown metric is ignored');
  return next ok(not public.record_web_vital('landing', 'LCP', 600000), 'an implausible value is ignored');
  return next ok(not public.record_web_vital('landing', 'CLS', -1), 'a negative value is ignored');
  return next ok(not public.record_web_vital('landing', 'INP', 'NaN'), 'NaN is ignored');
  for i in 1..3 loop perform public.record_web_vital('promenade', 'LCP', 1810); end loop;
  perform pg_temp.as_owner();
  return next is((select array_agg(samples order by bucket) from public.web_vitals_daily where page = 'promenade'),
    array[4], 'one row per day, page, metric and bucket: no row per measure');
  return next is((select count(*)::int from information_schema.columns
                  where table_schema = 'public' and table_name = 'web_vitals_daily'), 5,
    'day, page, metric, bucket, samples: nothing that identifies anyone');

  update public.app_settings set web_vitals_daily_cap = 4 where id;
  perform pg_temp.as_service();
  return next ok(not public.record_web_vital('landing', 'LCP', 900), 'past the daily cap nothing more is counted');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
-- Reading: 75th percentile, Greffe only
----------------------------------------------------------------------------------------------
create function pg_temp.test_percentile() returns setof text language plpgsql as $$
declare adm uuid := pg_temp.new_user('adm@test.local'); m uuid := pg_temp.new_user('m@test.local'); i integer;
  r record;
begin
  delete from public.web_vitals_daily;
  insert into public.admin_users (user_id, note) values (adm, 'test');
  perform pg_temp.as_service();
  -- LCP: 70 measures at 1 s, 30 at 4 s → p75 ≈ 4 s. CLS: 80 at 0.02, 20 at 0.3 → p75 ≈ 0.02.
  for i in 1..70 loop perform public.record_web_vital('fiche', 'LCP', 1000); end loop;
  for i in 1..30 loop perform public.record_web_vital('fiche', 'LCP', 4000); end loop;
  for i in 1..80 loop perform public.record_web_vital('fiche', 'CLS', 0.02); end loop;
  for i in 1..20 loop perform public.record_web_vital('fiche', 'CLS', 0.3); end loop;
  perform pg_temp.as_owner();

  perform pg_temp.as_user(adm, 'aal2');
  select * into r from public.admin_web_vitals(28) w where w.page = 'fiche' and w.metric = 'LCP';
  return next is(r.samples, 100::bigint, 'all the measures of the page');
  return next ok(r.p75 between 4000 * 0.95 and 4000 * 1.05, 'p75 of LCP within 5 % (' || r.p75 || ')');
  select * into r from public.admin_web_vitals(28) w where w.page = 'fiche' and w.metric = 'CLS';
  return next ok(r.p75 between 0.02 * 0.95 and 0.02 * 1.05, 'p75 of CLS within 5 % (' || r.p75 || ')');
  perform pg_temp.as_owner();

  perform pg_temp.as_user(adm, 'aal1');
  return next is(pg_temp.try('select * from public.admin_web_vitals(28)'), '42501', 'an admin without the second factor is refused');
  perform pg_temp.as_owner();
  perform pg_temp.as_user(m, 'aal2');
  return next is(pg_temp.try('select * from public.admin_web_vitals(28)'), '42501', 'a member is refused');
  return next is(pg_temp.try('select public.record_web_vital(''landing'', ''LCP'', 1)'), '42501', 'a member cannot record');
  return next is(pg_temp.try('select 1 from public.web_vitals_daily'), '42501', 'nor read the table');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
-- Retention: 90 days
----------------------------------------------------------------------------------------------
create function pg_temp.test_retention() returns setof text language plpgsql as $$
declare today date := (now() at time zone 'Europe/Paris')::date;
begin
  delete from public.web_vitals_daily;
  insert into public.web_vitals_daily (day, page, metric, bucket, samples) values
    (today - 89, 'landing', 'LCP', 70, 1), (today - 90, 'landing', 'LCP', 70, 1);
  perform public.cleanup_rows();
  return next is((select array_agg(day) from public.web_vitals_daily where page = 'landing'), array[today - 89],
    'kept 90 days, then erased');
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
