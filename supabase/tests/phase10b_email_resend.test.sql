-- Phase 10b (pgTAP): the e-mails of the app go through Resend (free plan: 100 a day for the whole
-- account, Auth e-mails included, per UTC calendar day). The daily quota is 100 with 50 kept for
-- the Auth e-mails, counted per UTC day. Every test_* function runs in its own rolled-back
-- transaction (runtests).

create function pg_temp.test_resend_quota() returns setof text language plpgsql as $$
declare utc_today date := (now() at time zone 'UTC')::date; n integer;
begin
  return next is((select email_daily_quota::integer from public.app_settings where id), 100,
    'the quota of Resend''s free plan: 100 a day');
  return next is((select email_auth_reserve::integer from public.app_settings where id), 50,
    '50 kept for the Auth e-mails (sign-up confirmation, password)');
  return next is(private.email_quota_day(), utc_today, 'the quota day is Resend''s: a UTC day');

  delete from public.email_quota_days;
  -- Yesterday's sending (UTC) does not count today.
  insert into public.email_quota_days (day, sent) values (utc_today - 1, 100);
  return next is(private.email_room_today(), 50, 'room for 50 e-mails of the app today');

  insert into public.email_outbox (kind, priority, payload)
  select 'admin_zone_ready', 50, jsonb_build_object('zone_id', g) from generate_series(1, 60) g;
  select count(*) into n from public.email_claim(100);
  return next is(n, 50, 'never more than 50 claimed in a UTC day');
  return next is((select sent from public.email_quota_days where day = utc_today), 50,
    'counted on today''s UTC day');
  return next is((select count(*)::integer from public.email_claim(100)), 0, 'nothing more today');
  return next is(public.email_dispatch(), false, 'and the route is not called any more');
end $$;

create function pg_temp.test_rights() returns setof text language plpgsql as $$
begin
  return next ok(not has_function_privilege('authenticated', 'private.email_quota_day()', 'execute')
    and not has_function_privilege('anon', 'private.email_quota_day()', 'execute'),
    'the quota day is internal');
  return next ok(has_function_privilege('service_role', 'public.email_claim(integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.email_claim(integer)', 'execute'),
    'email_claim still for the secret key only');
end $$;

select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
