-- Phase 7e (pgTAP): les e-mails (SPEC §16). Every test_* function runs in its own rolled-back
-- transaction (runtests), so nothing persists. Helpers as in phase7c_jobs.

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

create function pg_temp.new_place() returns bigint language sql as $$
  insert into public.places (official_code, name, lat, lng)
  values ('T' || substr(md5(random()::text), 1, 8), 'Ville test', 47.5, 3.5) returning id
$$;

create function pg_temp.new_member(p_email text, p_gender public.gender, p_place bigint,
  p_role public.member_role) returns uuid language plpgsql as $$
declare uid uuid := pg_temp.new_user(p_email);
begin
  insert into public.profiles (id, pseudo, birthdate, gender, seeking_genders, place_id, role, visit_motive)
  values (uid, 'm' || translate(substr(replace(uid::text, '-', ''), 1, 12), '0123456789', 'ghijklmnop'),
    date '1990-01-01', p_gender, '{man,woman}', p_place, p_role,
    case when p_role = 'visitor' then 'Motif de test' end);
  update public.profiles set onboarding_completed_at = now(), last_seen_at = now(),
    created_at = now() - interval '10 days' where id = uid;
  return uid;
end $$;

create function pg_temp.approve_photo(p_owner uuid, p_position integer) returns void language sql as $$
  insert into public.photos (owner_id, position, pending_path)
  values (p_owner, p_position, p_owner || '/' || gen_random_uuid() || '.webp');
  update public.photos set status = 'approved', pending_path = null,
    public_path_large = gen_random_uuid() || '.webp', public_path_small = gen_random_uuid() || '-s.webp'
  where owner_id = p_owner and position = p_position;
$$;

create function pg_temp.bad(p_email text, p_place bigint) returns uuid language plpgsql as $$
declare b uuid := pg_temp.new_member(p_email, 'woman', p_place, 'bad');
begin
  perform pg_temp.approve_photo(b, 0);
  perform pg_temp.approve_photo(b, 1);
  perform pg_temp.approve_photo(b, 2);
  insert into public.casier_charges (profile_id, charge_1, charge_2, charge_3, true_index)
  values (b, 'Chef UN a traversé la Manche en kayak', 'Chef DEUX a dormi dans un phare breton',
    'Chef TROIS a volé une cloche de vache', 2);
  return b;
end $$;

create function pg_temp.visitor(p_email text, p_place bigint) returns uuid language plpgsql as $$
declare v uuid := pg_temp.new_member(p_email, 'man', p_place, 'visitor');
begin
  perform pg_temp.approve_photo(v, 0);
  return v;
end $$;

create function pg_temp.as_user(p_uid uuid, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, true);
  execute 'set local role authenticated';
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

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  return coalesce(pg_temp.try(p_sql), 'ok');
end $$;

create function pg_temp.request(p_visitor uuid, p_bad uuid) returns uuid language plpgsql as $$
declare r uuid;
begin
  perform pg_temp.as_user(p_visitor);
  r := public.send_visit_request(p_bad, 1::smallint, null);
  perform pg_temp.as_owner();
  return r;
end $$;

-- A slot start n hours from now, on the hour.
create function pg_temp.h(p_hours integer) returns timestamptz language sql stable as $$
  select date_trunc('hour', now()) + p_hours * interval '1 hour'
$$;

create function pg_temp.slots_sql(p_request uuid, variadic p_hours integer[]) returns text language sql stable as $$
  select format('select public.accept_visit_request(%L, %L::timestamptz[])', p_request,
    (select array_agg(pg_temp.h(x)) from unnest(p_hours) x))
$$;

create function pg_temp.accept(p_bad uuid, p_request uuid, variadic p_hours integer[]) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(p_bad);
  perform public.accept_visit_request(p_request, (select array_agg(pg_temp.h(x)) from unnest(p_hours) x));
  perform pg_temp.as_owner();
end $$;

-- Test helper read as the owner (members have no right on visit_slots, by design).
create function pg_temp.slot_at(p_request uuid, p_hours integer) returns uuid language sql stable security definer as $$
  select id from public.visit_slots where request_id = p_request and starts_at = pg_temp.h(p_hours)
  order by round desc limit 1
$$;

create function pg_temp.choose(p_visitor uuid, p_slot uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp.as_user(p_visitor);
  v := public.choose_slot(p_slot);
  perform pg_temp.as_owner();
  return v;
end $$;

create function pg_temp.notified(p_user uuid, p_type text) returns integer language sql stable as $$
  select count(*)::integer from public.notifications where user_id = p_user and type::text = p_type
$$;

create function pg_temp.open() returns void language sql as $$
  update public.app_settings set launch_mode = 'open' where id
$$;


-- A request with a note, accepted, a slot chosen, then moved to « now » and started by the job.
create function pg_temp.live_visit(p_bad uuid, p_visitor uuid) returns uuid language plpgsql as $$
declare req uuid; visit uuid;
begin
  perform pg_temp.as_user(p_visitor);
  req := public.send_visit_request(p_bad, 1::smallint, 'Couche-tard aussi.');
  perform pg_temp.as_owner();
  perform pg_temp.accept(p_bad, req, 6, 7);
  visit := pg_temp.choose(p_visitor, pg_temp.slot_at(req, 6));
  update public.visits set starts_at = now() - interval '1 minute', ends_at = now() + interval '29 minutes' where id = visit;
  perform public.run_parloir_ticks();
  return visit;
end $$;

create function pg_temp.join(p_user uuid, p_visit uuid) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  perform pg_temp.as_user(p_user);
  j := public.join_visit(p_visit);
  perform pg_temp.as_owner();
  return j;
end $$;

create function pg_temp.say(p_user uuid, p_conversation uuid, p_body text) returns text language plpgsql as $$
declare e text;
begin
  perform pg_temp.as_user(p_user);
  e := pg_temp.err(format('select public.send_message(%L, %L)', p_conversation, p_body));
  perform pg_temp.as_owner();
  return e;
end $$;

create function pg_temp.conv(p_visit uuid) returns uuid language sql stable security definer as $$
  select conversation_id from public.visits where id = p_visit
$$;

-- The visit is over (both were there): ends_at moved to the past, then the job.
create function pg_temp.finish(p_visit uuid) returns void language plpgsql as $$
begin
  update public.visits set starts_at = now() - interval '31 minutes', ends_at = now() - interval '1 minute' where id = p_visit;
  perform public.run_parloir_ticks();
end $$;

create function pg_temp.choose_end(p_user uuid, p_visit uuid, p_prolong boolean) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  perform pg_temp.as_user(p_user);
  j := public.choose_visit_end(p_visit, p_prolong);
  perform pg_temp.as_owner();
  return j;
end $$;

-- A couple with the Permis permanent: the visit held, both prolong; returns the conversation.
create function pg_temp.released(p_bad uuid, p_visitor uuid) returns uuid language plpgsql as $$
declare visit uuid;
begin
  visit := pg_temp.live_visit(p_bad, p_visitor);
  perform pg_temp.join(p_visitor, visit);
  perform pg_temp.join(p_bad, visit);
  perform pg_temp.finish(visit);
  perform pg_temp.choose_end(p_visitor, visit, true);
  perform pg_temp.choose_end(p_bad, visit, true);
  return pg_temp.conv(visit);
end $$;


create function pg_temp.last_message(p_conversation uuid) returns bigint language sql stable security definer as $$
  select coalesce(max(id), 0) from public.messages where conversation_id = p_conversation
$$;

create function pg_temp.new_admin(p_email text) returns uuid language plpgsql as $$
declare uid uuid := pg_temp.new_user(p_email);
begin
  insert into public.admin_users (user_id, note) values (uid, 'test');
  return uid;
end $$;

-- Granted by the database owner in person (Phase 5a-ter).
create function pg_temp.new_super_admin() returns uuid language plpgsql as $$
declare uid uuid := pg_temp.new_user('super@test.local');
begin
  perform set_config('application_name', 'pgtap', true);
  insert into public.super_admins (user_id, note) values (uid, 'test');
  return uid;
end $$;

-- A statement run by a signed-in account with the second factor: 'ok' or the error.
create function pg_temp.as_admin(p_admin uuid, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
declare e text;
begin
  perform pg_temp.as_user(p_admin, p_aal);
  e := pg_temp.err(p_sql);
  perform pg_temp.as_owner();
  return e;
end $$;

create function pg_temp.zone_sql(p_place bigint, p_slug text default 'test-zone', p_women integer default 40,
  p_men integer default 20, p_tz text default 'Europe/Paris') returns text language sql stable as $$
  select format('select public.admin_save_zone(%L, ''Quartier test'', %s, 15::smallint, %L, 2, %s::smallint, %s::smallint, false)',
    p_slug, p_place, p_tz, p_women, p_men)
$$;

create function pg_temp.new_zone(p_admin uuid, p_place bigint) returns smallint language plpgsql as $$
declare z smallint;
begin
  perform pg_temp.as_user(p_admin, 'aal2');
  execute pg_temp.zone_sql(p_place) into z;
  perform pg_temp.as_owner();
  return z;
end $$;

----------------------------------------------------------------------------------------------
-- Queue: one digest a day, preferences respected
----------------------------------------------------------------------------------------------
create function pg_temp.outbox(p_user uuid, p_kind text) returns integer language sql stable as $$
  select count(*)::integer from public.email_outbox where user_id = p_user and kind::text = p_kind
$$;

create function pg_temp.test_queue() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); b uuid; v uuid;
begin
  b := pg_temp.bad('bad@test.local', pl);
  v := pg_temp.visitor('visitor@test.local', pl);
  perform public.notify(b, 'request_received', '{}');
  perform public.notify(b, 'request_received', '{}');
  perform public.notify(b, 'request_accepted', '{}');
  return next is(pg_temp.outbox(b, 'request_digest'), 1, 'one digest a day at most');
  update public.notification_preferences set email_request_digest = false where user_id = v;
  perform public.notify(v, 'request_accepted', '{}');
  return next is(pg_temp.outbox(v, 'request_digest'), 0, 'not when switched off');
  perform public.notify(v, 'visit_reminder_1h', '{}');
  return next is(pg_temp.outbox(v, 'visit_reminder'), 0, 'the visit reminder is off by default');
  update public.notification_preferences set email_visit_reminder = true where user_id = v;
  perform public.notify(v, 'visit_reminder_1h', '{}');
  return next is(pg_temp.outbox(v, 'visit_reminder'), 1, 'and on when switched on');
  perform public.notify(v, 'permit_granted', '{}');
  perform public.notify(v, 'date_accepted', '{}');
  return next is(pg_temp.outbox(v, 'permit_granted') + pg_temp.outbox(v, 'date_accepted'), 2, 'Permis délivré, Cavale acceptée');
  perform public.notify(v, 'message_received', '{}');
  return next is((select count(*)::integer from public.email_outbox where user_id = v), 3, 'never a message');
end $$;

----------------------------------------------------------------------------------------------
-- Claim: quota with the Auth reserve, priorities, late reminders dropped, banned members
----------------------------------------------------------------------------------------------
create function pg_temp.test_claim() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); a uuid; b uuid; c uuid; first record; n integer;
begin
  a := pg_temp.visitor('a@test.local', pl);
  b := pg_temp.visitor('b@test.local', pl);
  c := pg_temp.visitor('c@test.local', pl);
  update public.app_settings set email_daily_quota = 102, email_auth_reserve = 100 where id;
  insert into public.email_outbox (user_id, kind, priority, payload) values
    (a, 'onboarding_reminder', 90, '{}'),
    (b, 'permit_granted', 30, '{}'),
    (c, 'visit_reminder', 10, jsonb_build_object('starts_at', now() - interval '1 minute'));
  select * into first from public.email_claim(10) limit 1;
  select count(*) into n from public.email_outbox where status = 'queued' and claimed_until is not null;
  return next is(first.recipient, 'b@test.local', 'by priority, the late reminder dropped');
  return next is(n, 2, 'two claimed: the room left after the reserve of the Auth e-mails');
  return next ok((select status = 'skipped' from public.email_outbox where user_id = c), 'a reminder after the visit start is dropped');
  return next is((select count(*)::integer from public.email_claim(10)), 0, 'nothing more today');
  perform public.email_report(first.email_id, false);
  return next is((select sent from public.email_quota_days where day = (now() at time zone 'Europe/Paris')::date), 1,
    'a failure gives its place back');
  perform public.email_report((select id from public.email_outbox where user_id = a), true);
  return next ok((select status = 'sent' and sent_at is not null from public.email_outbox where user_id = a), 'sent');

  update public.app_settings set email_daily_quota = 300 where id;
  update public.profiles set banned_at = now() where id = a;
  insert into public.email_outbox (user_id, kind, priority) values (a, 'zone_opened', 40), (a, 'moderation_decision', 10);
  perform public.email_claim(10);
  return next ok((select status = 'skipped' from public.email_outbox where user_id = a and kind = 'zone_opened'), 'a banned member gets nothing');
  return next ok((select claimed_until is not null from public.email_outbox where user_id = a and kind = 'moderation_decision'),
    'except the exposé des motifs');
end $$;

----------------------------------------------------------------------------------------------
-- Unsubscribe, onboarding reminder, rights
----------------------------------------------------------------------------------------------
create function pg_temp.test_unsubscribe_and_reminder() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); v uuid; token uuid; late uuid;
begin
  v := pg_temp.visitor('visitor@test.local', pl);
  select unsubscribe_token into token from public.notification_preferences where user_id = v;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
  return next ok(public.unsubscribe_email(token, 'zone_opened'), 'one click, no session (server, secret key)');
  return next ok(not public.unsubscribe_email(token, 'moderation_decision'), 'never the decisions of the Greffe');
  return next ok(not public.unsubscribe_email(gen_random_uuid(), 'zone_opened'), 'an unknown token changes nothing');
  perform pg_temp.as_owner();
  return next ok((select not email_zone_opened and email_date_accepted from public.notification_preferences where user_id = v),
    'only that type');

  late := pg_temp.new_user('late@test.local');
  insert into public.profiles (id, pseudo, birthdate, gender, seeking_genders, place_id)
  values (late, 'tardif_test', date '1990-01-01', 'man', '{woman}', pl);
  update public.profiles set created_at = now() - interval '7 days 2 hours' where id = late;
  return next is(public.enqueue_onboarding_reminders(), 1, 'one reminder at D+7');
  return next is(public.enqueue_onboarding_reminders(), 0, 'once');

  return next ok(not has_function_privilege('authenticated', 'public.email_claim(integer)', 'execute')
    and has_function_privilege('service_role', 'public.email_claim(integer)', 'execute')
    and not has_function_privilege('anon', 'public.email_dispatch()', 'execute')
    and not has_function_privilege('anon', 'public.unsubscribe_email(uuid, text)', 'execute'), 'sending is for the secret key only');
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
