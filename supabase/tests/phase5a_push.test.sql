-- Phase 5a security tests (pgTAP): Web Push subscriptions, the outbox and its route functions.
-- Every test_* function runs in its own rolled-back transaction (runtests), so nothing persists.
-- Run: `supabase test db`, or paste this file into the SQL editor / Supabase connector.

----------------------------------------------------------------------------------------------
-- Helpers
----------------------------------------------------------------------------------------------
create function pg_temp.new_member(p_email text) returns uuid language plpgsql as $$
declare uid uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', p_email, '',
    now(), '{}', '{}', now(), now());
  insert into public.profiles (id, pseudo, birthdate, gender, seeking_genders, role)
  values (uid, 'p' || translate(substr(replace(uid::text, '-', ''), 1, 12), '0123456789', 'ghijklmnop'),
    date '1990-01-01', 'woman', '{man,woman}', 'bad');
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
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function pg_temp.val(p_sql text) returns text language plpgsql as $$
declare result text;
begin
  execute p_sql into result;
  return result;
end $$;

-- A browser subscription saved by p_user (keys of realistic length, endpoint unique per call).
create function pg_temp.subscribe(p_user uuid, p_endpoint text default null) returns text language plpgsql as $$
declare e text := coalesce(p_endpoint, 'https://push.example.test/' || gen_random_uuid());
begin
  perform pg_temp.as_user(p_user);
  perform public.save_push_subscription(e, repeat('B', 87), repeat('a', 22), 'fr');
  perform pg_temp.as_owner();
  return e;
end $$;

create function pg_temp.active(p_user uuid) returns integer language sql as $$
  select count(*)::integer from public.push_subscriptions where user_id = p_user and revoked_at is null
$$;

----------------------------------------------------------------------------------------------
-- Structure and rights
----------------------------------------------------------------------------------------------
create function pg_temp.test_push_tables_closed() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_member('a@test.local');
begin
  return next is((select count(*)::integer from pg_class where oid in ('public.push_subscriptions'::regclass,
    'public.push_outbox'::regclass) and relrowsecurity), 2, 'RLS is on for both tables');
  return next ok(not has_table_privilege('authenticated', 'public.push_subscriptions', 'select,insert,update,delete')
    and not has_table_privilege('authenticated', 'public.push_outbox', 'select,insert,update,delete')
    and not has_table_privilege('anon', 'public.push_subscriptions', 'select,insert,update,delete')
    and not has_table_privilege('anon', 'public.push_outbox', 'select,insert,update,delete'),
    'members and anon have no right on the tables (functions only)');
  perform pg_temp.subscribe(a);
  perform pg_temp.as_user(a);
  return next matches(coalesce(pg_temp.try('select * from public.push_subscriptions'), 'ok'), '^42501',
    'a member cannot read even their own subscriptions');
  perform pg_temp.as_owner();
end $$;

create function pg_temp.test_push_function_rights() returns setof text language plpgsql as $$
declare f text;
begin
  foreach f in array array['push_claim(integer)', 'push_report(jsonb)', 'set_push_secret(text, text)',
    'push_dispatch()', 'revoke_push_row(uuid)', 'notifications_to_push()'] loop
    return next ok(not has_function_privilege('authenticated', 'public.' || f, 'execute')
      and not has_function_privilege('anon', 'public.' || f, 'execute'), 'members cannot call ' || f);
  end loop;
  foreach f in array array['push_claim(integer)', 'push_report(jsonb)', 'set_push_secret(text, text)'] loop
    return next ok(has_function_privilege('service_role', 'public.' || f, 'execute'), 'the route (secret key) calls ' || f);
  end loop;
  return next ok(has_function_privilege('authenticated', 'public.save_push_subscription(text, text, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.save_push_subscription(text, text, text, text)', 'execute'),
    'members subscribe, anon does not');
  return next is((select schedule from cron.job where jobname = 'push-dispatch'), '* * * * *',
    'push_dispatch runs every minute');
end $$;

----------------------------------------------------------------------------------------------
-- Subscriptions
----------------------------------------------------------------------------------------------
create function pg_temp.test_push_subscribe() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_member('a@test.local'); b uuid := pg_temp.new_member('b@test.local');
  e text; i integer;
begin
  perform pg_temp.as_user(a);
  return next matches(coalesce(pg_temp.try(
    format('select public.save_push_subscription(%L, %L, %L)', 'http://push.example.test/x', repeat('B', 87), repeat('a', 22))), 'ok'),
    'invalid_subscription', 'an endpoint that is not HTTPS is refused');
  return next matches(coalesce(pg_temp.try(
    format('select public.save_push_subscription(%L, %L, %L)', 'https://push.example.test/x', 'short', repeat('a', 22))), 'ok'),
    'invalid_subscription', 'keys of the wrong size are refused');
  perform pg_temp.as_anon();
  return next matches(coalesce(pg_temp.try(
    format('select public.save_push_subscription(%L, %L, %L)', 'https://push.example.test/x', repeat('B', 87), repeat('a', 22))), 'ok'),
    '^42501', 'anon cannot subscribe');
  perform pg_temp.as_owner();
  e := pg_temp.subscribe(a);
  return next is(pg_temp.active(a), 1, 'a member subscribes a browser');
  perform pg_temp.as_user(a);
  return next is(pg_temp.val('select public.push_device_count()'), '1', 'and sees one device');
  perform pg_temp.as_owner();
  perform pg_temp.subscribe(a, e);
  return next is(pg_temp.active(a), 1, 'subscribing the same browser again keeps one subscription');
  perform pg_temp.subscribe(b, e);
  return next is(pg_temp.active(a) || '/' || pg_temp.active(b), '0/1',
    'the same browser signed in as someone else moves to them');
  for i in 1..6 loop perform pg_temp.subscribe(a); end loop;
  return next is(pg_temp.active(a), 5, '5 browsers at most: the oldest is revoked');
  return next is((select count(*)::integer from public.push_subscriptions
    where user_id = a and revoked_at is not null and (endpoint is not null or p256dh is not null or auth is not null)), 0,
    'a revoked subscription keeps neither its address nor its keys');
end $$;

create function pg_temp.test_push_revoke_own_only() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_member('a@test.local'); b uuid := pg_temp.new_member('b@test.local'); e text;
begin
  e := pg_temp.subscribe(a);
  perform pg_temp.as_user(b);
  perform public.revoke_push_subscription(e);
  perform pg_temp.as_owner();
  return next is(pg_temp.active(a), 1, 'another member cannot revoke my subscription');
  perform pg_temp.as_user(a);
  perform public.revoke_push_subscription(e);
  perform pg_temp.as_owner();
  return next is(pg_temp.active(a), 0, 'I can revoke mine (switching notifications off on this browser)');
end $$;

----------------------------------------------------------------------------------------------
-- From a notification to the outbox
----------------------------------------------------------------------------------------------
create function pg_temp.test_push_outbox_from_notifications() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_member('a@test.local'); b uuid := pg_temp.new_member('b@test.local');
begin
  perform public.notify(a, 'request_received');
  return next is((select count(*)::integer from public.push_outbox where user_id = a), 0,
    'no subscription: nothing is queued');
  perform pg_temp.subscribe(a);
  perform public.notify(a, 'request_received', jsonb_build_object('request_id', gen_random_uuid(), 'pseudo', 'Nox'));
  return next is((select payload::text from public.push_outbox where user_id = a), '{"path": "/courrier"}',
    'queued with an internal path only (never a pseudo or anything from the notification)');
  perform public.notify(a, 'zone_opened');
  return next is((select count(*)::integer from public.push_outbox where user_id = a and type = 'zone_opened'), 0,
    'a type without a push (yet) is not queued');
  perform public.notify(a, 'moderation_decision');
  perform public.notify(a, 'moderation_decision');
  perform public.notify(a, 'moderation_decision');
  return next is((select count(*)::integer from public.push_outbox where user_id = a and type = 'moderation_decision'), 1,
    'the Greffe deciding 3 poses gives one notification a day');
  update public.notification_preferences set push_requests = false where user_id = a;
  perform public.notify(a, 'request_accepted');
  return next is((select count(*)::integer from public.push_outbox where user_id = a and type = 'request_accepted'), 0,
    'a kind turned off in the preferences is not queued');
  perform public.notify(a, 'promenade_open');
  return next is((select payload ->> 'path' from public.push_outbox where user_id = a and type = 'promenade_open'), '/promenade',
    'the other kinds still are');
  perform pg_temp.subscribe(b);
  perform public.notify(b, 'request_dismissed');
  return next is((select payload ->> 'path' from public.push_outbox where user_id = b), '/demandes',
    'a refusal opens Mes demandes');
end $$;

----------------------------------------------------------------------------------------------
-- The route: claim, then report
----------------------------------------------------------------------------------------------
create function pg_temp.test_push_claim_and_report() returns setof text language plpgsql as $$
declare
  a uuid := pg_temp.new_member('a@test.local'); b uuid := pg_temp.new_member('b@test.local');
  job record; sub_a uuid; sub_b uuid; out_a bigint; out_b bigint;
begin
  perform pg_temp.subscribe(a);
  perform pg_temp.subscribe(b);
  sub_a := (select id from public.push_subscriptions where user_id = a);
  sub_b := (select id from public.push_subscriptions where user_id = b);
  perform public.notify(a, 'request_received');
  perform public.notify(b, 'request_received');
  out_a := (select id from public.push_outbox where user_id = a);
  out_b := (select id from public.push_outbox where user_id = b);
  select * into job from public.push_claim(10) c where c.id = out_a;
  return next is(jsonb_array_length(job.subscriptions), 1, 'a claimed message comes with the member''s browsers');
  return next is(job.subscriptions -> 0 ->> 'locale', 'fr', 'and the language of each browser');
  return next is((select count(*)::integer from public.push_claim(10)), 0,
    'a claimed message is not handed out twice (5-minute lease)');
  perform public.push_report(jsonb_build_object('sent', jsonb_build_array(out_a), 'delivered', jsonb_build_array(sub_a),
    'retry', jsonb_build_array(out_b), 'gone', jsonb_build_array(sub_b)));
  return next is((select status from public.push_outbox where id = out_a), 'sent', 'delivered: sent');
  return next isnt((select last_success_at from public.push_subscriptions where id = sub_a), null, 'the browser is marked alive');
  return next is((select status from public.push_outbox where id = out_b), 'queued', 'failed once: retried later');
  return next isnt((select revoked_at from public.push_subscriptions where id = sub_b), null,
    'a browser the push service says is gone (404/410) is revoked');
  update public.push_outbox set attempts = 3 where id = out_b;
  perform public.push_report(jsonb_build_object('retry', jsonb_build_array(out_b)));
  return next is((select status from public.push_outbox where id = out_b), 'failed', 'after 3 attempts the message is given up');
  perform pg_temp.subscribe(b);
  sub_b := (select id from public.push_subscriptions where user_id = b and revoked_at is null);
  update public.push_subscriptions set failure_count = 4 where id = sub_b;
  perform public.push_report(jsonb_build_object('failed', jsonb_build_array(sub_b)));
  return next isnt((select revoked_at from public.push_subscriptions where id = sub_b), null,
    '5 failures in a row: the browser is revoked');
end $$;

create function pg_temp.test_push_dispatch_quiet() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_member('a@test.local');
begin
  update public.push_outbox set status = 'skipped' where status = 'queued';
  return next is(public.push_dispatch(), false, 'nothing due: no HTTP call');
  perform pg_temp.as_user(a);
  return next matches(coalesce(pg_temp.try('select public.set_push_secret(''push_cron_secret'', repeat(''x'', 40))'), 'ok'),
    '^42501', 'a member cannot write a push secret');
  perform pg_temp.as_owner();
  return next matches(coalesce(pg_temp.try('select public.set_push_secret(''service_role_key'', repeat(''x'', 40))'), 'ok'),
    'unknown_secret', 'only the three push secrets can be written');
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
