-- Phase 5b (pgTAP): les Heures de visite (SPEC §7 bis). Every test_* function runs in its own
-- rolled-back transaction (runtests), so nothing persists.

----------------------------------------------------------------------------------------------
-- Helpers (same members as phase4_relations)
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

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
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

----------------------------------------------------------------------------------------------
-- Structure and rights
----------------------------------------------------------------------------------------------
create function pg_temp.test_hours_structure() returns setof text language plpgsql as $$
declare f text;
begin
  return next is((select count(*)::integer from pg_class where oid in ('public.visit_slots'::regclass,
    'public.visits'::regclass) and relrowsecurity), 2, 'RLS is on for visit_slots and visits');
  return next ok(not has_table_privilege('authenticated', 'public.visit_slots', 'select,insert,update,delete')
    and not has_table_privilege('authenticated', 'public.visits', 'select,insert,update,delete')
    and not has_table_privilege('anon', 'public.visits', 'select'),
    'members read slots and visits through functions only');
  foreach f in array array['accept_visit_request(uuid, timestamptz[])', 'propose_slots(uuid, timestamptz[])',
    'choose_slot(uuid)', 'decline_slots(uuid)', 'cancel_visit(uuid)', 'get_request_schedule(uuid)', 'get_my_visits()'] loop
    return next ok(has_function_privilege('authenticated', 'public.' || f, 'execute')
      and not has_function_privilege('anon', 'public.' || f, 'execute'), 'members (not anon) call ' || f);
  end loop;
  foreach f in array array['checked_slots(uuid, timestamptz[])', 'insert_slots(uuid, smallint, timestamptz[])',
    'run_visit_schedule()'] loop
    return next ok(not has_function_privilege('authenticated', 'public.' || f, 'execute'), 'internal: ' || f);
  end loop;
  return next is((select schedule from cron.job where jobname = 'visit-schedule'), '* * * * *',
    'deadlines and reminders run every minute');
  return next is((select count(*)::integer from pg_constraint where conrelid = 'public.visits'::regclass and contype = 'x'), 2,
    'two exclusion constraints: no overlap for a Bad, none for a Visitor');
end $$;

----------------------------------------------------------------------------------------------
-- The Bad accepts by proposing 2 or 3 valid slots
----------------------------------------------------------------------------------------------
create function pg_temp.test_hours_accept_rules() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; b2 uuid; v uuid; req uuid;
begin
  perform pg_temp.open();
  b := pg_temp.bad('b@test.local', ville);
  b2 := pg_temp.bad('b2@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  req := pg_temp.request(v, b);
  perform pg_temp.as_user(b);
  return next matches(pg_temp.err(format('select public.decide_visit_request(%L, true)', req)), 'slots_required',
    'accepting without slots is refused (accept = propose the Heures de visite)');
  return next matches(pg_temp.err(pg_temp.slots_sql(req, 3)), 'slots_count', 'one slot is not enough');
  return next matches(pg_temp.err(pg_temp.slots_sql(req, 3, 4, 5, 6)), 'slots_count', 'four is too many');
  return next matches(pg_temp.err(pg_temp.slots_sql(req, 1, 4)), 'slot_too_soon', 'at least 2 h ahead');
  return next matches(pg_temp.err(pg_temp.slots_sql(req, 3, 24 * 7 + 2)), 'slot_too_far', 'within 7 days');
  return next matches(pg_temp.err(pg_temp.slots_sql(req, 3, 3)), 'slot_duplicate', 'all different');
  return next matches(pg_temp.err(format('select public.accept_visit_request(%L, %L::timestamptz[])', req,
    array[pg_temp.h(3) + interval '10 minutes', pg_temp.h(5)])), 'slot_invalid', 'on the hour or the half hour');
  perform pg_temp.as_user(v);
  return next matches(pg_temp.err(pg_temp.slots_sql(req, 3, 5)), 'not_found', 'the Visitor cannot accept');
  perform pg_temp.as_user(b2);
  return next matches(pg_temp.err(pg_temp.slots_sql(req, 3, 5)), 'not_found', 'nor another Bad');
  perform pg_temp.as_user(b);
  return next is(pg_temp.try(format('select public.accept_visit_request(%L, %L::timestamptz[])', req,
    array[pg_temp.h(5), pg_temp.h(3) + interval '30 minutes'])), null, '2 valid slots: accepted');
  return next matches(pg_temp.err(pg_temp.slots_sql(req, 6, 7)), 'not_pending', 'a decision is made once');
  perform pg_temp.as_owner();
  return next is((select status::text || '/' || slots_round from public.visit_requests where id = req), 'accepted/1',
    'the request is accepted, first round of slots');
  return next ok((select choose_deadline between now() + interval '47 hours 59 minutes' and now() + interval '48 hours'
    from public.visit_requests where id = req), 'the Visitor has 48 h to choose');
  return next is((select count(*)::integer from public.visit_slots where request_id = req and status = 'offered'), 2, '2 slots offered');
  return next is(pg_temp.notified(v, 'request_accepted'), 1, 'the Visitor is told');
end $$;

----------------------------------------------------------------------------------------------
-- The Visitor chooses
----------------------------------------------------------------------------------------------
create function pg_temp.test_hours_choose() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; v uuid; v2 uuid; req uuid; sched jsonb; visit uuid;
begin
  perform pg_temp.open();
  b := pg_temp.bad('b@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  v2 := pg_temp.visitor('v2@test.local', ville);
  req := pg_temp.request(v, b);
  perform pg_temp.accept(b, req, 3, 26);
  perform pg_temp.as_user(v);
  sched := public.get_request_schedule(req);
  return next is(jsonb_array_length(sched -> 'slots'), 2, 'the Visitor sees the 2 slots');
  return next ok((select bool_and((s ->> 'available')::boolean) from jsonb_array_elements(sched -> 'slots') s),
    'both available');
  return next is(sched ->> 'can_propose', 'false', 'only the Bad may propose');
  perform pg_temp.as_user(b);
  return next matches(pg_temp.err(format('select public.choose_slot(%L)', pg_temp.slot_at(req, 3))), 'not_found',
    'the Bad cannot choose');
  perform pg_temp.as_user(v2);
  return next matches(pg_temp.err(format('select public.choose_slot(%L)', pg_temp.slot_at(req, 3))), 'not_found',
    'nor another Visitor');
  return next matches(pg_temp.err(format('select public.get_request_schedule(%L)', req)), 'not_found',
    'who cannot read the schedule either');
  perform pg_temp.as_owner();
  visit := pg_temp.choose(v, pg_temp.slot_at(req, 26));
  return next is((select status::text from public.visits where id = visit), 'scheduled', 'the visit is scheduled');
  return next is((select string_agg(status::text, ',' order by starts_at) from public.visit_slots where request_id = req),
    'expired,chosen', 'the chosen slot, the other expired');
  return next is(pg_temp.notified(b, 'slot_chosen'), 1, 'the Bad is told');
  perform pg_temp.as_user(v);
  return next matches(pg_temp.err(format('select public.choose_slot(%L)', pg_temp.slot_at(req, 3))), 'not_open',
    'one choice only');
  return next is((public.get_request_schedule(req) -> 'visit' ->> 'id')::uuid, visit, 'the schedule shows the visit');
  return next is((select count(*)::integer from public.get_my_visits() where visit_id = visit and not i_am_bad), 1,
    'Tableau des visites (Visitor)');
  perform pg_temp.as_user(b);
  return next is((select count(*)::integer from public.get_my_visits() where visit_id = visit and i_am_bad), 1,
    'Tableau des visites (Bad)');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
-- No overlap: a Bad, a Visitor; « plus disponible » 15 min before
----------------------------------------------------------------------------------------------
create function pg_temp.test_hours_no_overlap() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; b2 uuid; v1 uuid; v2 uuid; r1 uuid; r2 uuid; late uuid;
begin
  perform pg_temp.open();
  b := pg_temp.bad('b@test.local', ville);
  b2 := pg_temp.bad('b2@test.local', ville);
  v1 := pg_temp.visitor('v1@test.local', ville);
  v2 := pg_temp.visitor('v2@test.local', ville);
  r1 := pg_temp.request(v1, b);
  r2 := pg_temp.request(v2, b);
  perform pg_temp.accept(b, r1, 4, 6);
  perform pg_temp.accept(b, r2, 4, 8);
  perform pg_temp.choose(v1, pg_temp.slot_at(r1, 4));
  -- The Bad is now busy at h(4): the same hour offered to another Visitor is no longer available.
  perform pg_temp.as_user(v2);
  return next is((select (s ->> 'available')::boolean from jsonb_array_elements(public.get_request_schedule(r2) -> 'slots') s
    where (s ->> 'starts_at')::timestamptz = pg_temp.h(4)), false, 'shown « plus disponible »');
  return next matches(pg_temp.err(format('select public.choose_slot(%L)', pg_temp.slot_at(r2, 4))), 'slot_unavailable',
    'and cannot be chosen');
  perform pg_temp.as_owner();
  return next matches(pg_temp.err(format(
    'insert into public.visits (request_id, slot_id, bad_id, visitor_id, starts_at, ends_at) values (%L, %L, %L, %L, %L, %L)',
    r2, pg_temp.slot_at(r2, 4), b, v2, pg_temp.h(4), pg_temp.h(4) + interval '30 minutes')), '^23P01',
    'the database itself refuses two visits of a Bad at the same time');
  -- A slot starting in less than 15 min.
  late := (select id from public.visit_slots where request_id = r2 and starts_at = pg_temp.h(8));
  update public.visit_slots set starts_at = now() + interval '10 minutes', ends_at = now() + interval '40 minutes' where id = late;
  perform pg_temp.as_user(v2);
  return next matches(pg_temp.err(format('select public.choose_slot(%L)', late)), 'slot_unavailable',
    'less than 15 min before: no longer available');
  perform pg_temp.as_owner();
end $$;

create function pg_temp.test_hours_visitor_busy() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b1 uuid; b2 uuid; v uuid; r1 uuid; r2 uuid; v3 uuid; r4 uuid;
begin
  perform pg_temp.open();
  b1 := pg_temp.bad('b1@test.local', ville);
  b2 := pg_temp.bad('b2@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  r1 := pg_temp.request(v, b1);
  r2 := pg_temp.request(v, b2);
  perform pg_temp.accept(b1, r1, 6, 10);
  perform pg_temp.accept(b2, r2, 6, 11);
  perform pg_temp.choose(v, pg_temp.slot_at(r1, 6));
  perform pg_temp.as_user(v);
  return next matches(pg_temp.err(format('select public.choose_slot(%L)', pg_temp.slot_at(r2, 6))), 'visitor_busy',
    'a Visitor never has two visits at the same time');
  return next is(pg_temp.try(format('select public.choose_slot(%L)', pg_temp.slot_at(r2, 11))), null,
    'another hour is fine');
  perform pg_temp.as_owner();
  -- The Bad cannot propose an hour already taken by one of their visits.
  v3 := pg_temp.visitor('v3@test.local', ville);
  r4 := pg_temp.request(v3, b1);
  perform pg_temp.as_user(b1);
  return next matches(pg_temp.err(pg_temp.slots_sql(r4, 6, 12)), 'slot_busy', 'no slot over a scheduled visit');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
-- « Aucun ne me va », then new slots within 48 h
----------------------------------------------------------------------------------------------
create function pg_temp.test_hours_decline_and_repropose() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; v uuid; req uuid; old_slot uuid;
begin
  perform pg_temp.open();
  b := pg_temp.bad('b@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  req := pg_temp.request(v, b);
  perform pg_temp.accept(b, req, 4, 5);
  old_slot := pg_temp.slot_at(req, 4);
  perform pg_temp.as_user(b);
  return next matches(pg_temp.err(format('select public.propose_slots(%L, %L::timestamptz[])', req,
    array[pg_temp.h(7), pg_temp.h(8)])), 'not_expected', 'no new slots while the Visitor can still choose');
  return next matches(pg_temp.err(format('select public.decline_slots(%L)', req)), 'not_found', 'only the Visitor declines');
  perform pg_temp.as_user(v);
  return next is(pg_temp.try(format('select public.decline_slots(%L)', req)), null, '« Aucun ne me va »');
  perform pg_temp.as_owner();
  return next is(pg_temp.notified(b, 'slots_declined'), 1, 'the Bad is told');
  return next ok((select repropose_deadline between now() + interval '47 hours 59 minutes' and now() + interval '48 hours'
    from public.visit_requests where id = req), 'the Bad has 48 h to propose new slots');
  perform pg_temp.as_user(b);
  return next is(public.get_request_schedule(req) ->> 'can_propose', 'true', 'the Courrier offers to propose again');
  return next is(pg_temp.try(format('select public.propose_slots(%L, %L::timestamptz[])', req,
    array[pg_temp.h(7), pg_temp.h(8), pg_temp.h(9)])), null, '3 new slots');
  return next matches(pg_temp.err(format('select public.propose_slots(%L, %L::timestamptz[])', req,
    array[pg_temp.h(10), pg_temp.h(11)])), 'not_expected', 'once');
  perform pg_temp.as_owner();
  return next is(pg_temp.notified(v, 'slots_reproposed'), 1, 'the Visitor is told');
  return next is((select slots_round::integer from public.visit_requests where id = req), 2, 'second round');
  perform pg_temp.as_user(v);
  return next matches(pg_temp.err(format('select public.decline_slots(%L)', req)), 'already_declined',
    '« Aucun ne me va » once per request');
  return next matches(pg_temp.err(format('select public.choose_slot(%L)', old_slot)), 'not_open',
    'a slot of the first round can no longer be chosen');
  return next is(pg_temp.try(format('select public.choose_slot(%L)', pg_temp.slot_at(req, 8))), null,
    'a slot of the new round can');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
-- Deadlines (every minute)
----------------------------------------------------------------------------------------------
create function pg_temp.test_hours_deadlines() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; v1 uuid; v2 uuid; v3 uuid; r1 uuid; r2 uuid; r3 uuid; result jsonb;
begin
  perform pg_temp.open();
  b := pg_temp.bad('b@test.local', ville);
  v1 := pg_temp.visitor('v1@test.local', ville);
  v2 := pg_temp.visitor('v2@test.local', ville);
  v3 := pg_temp.visitor('v3@test.local', ville);
  r1 := pg_temp.request(v1, b);
  r2 := pg_temp.request(v2, b);
  r3 := pg_temp.request(v3, b);
  perform pg_temp.accept(b, r1, 4, 5);
  perform pg_temp.accept(b, r2, 6, 7);
  perform pg_temp.accept(b, r3, 8, 9);
  perform pg_temp.as_user(v2);
  perform public.decline_slots(r2);
  perform pg_temp.as_owner();
  perform pg_temp.choose(v3, pg_temp.slot_at(r3, 8));
  update public.visit_requests set choose_deadline = now() - interval '1 minute' where id = r1;
  update public.visit_requests set repropose_deadline = now() - interval '1 minute' where id = r2;
  result := public.run_visit_schedule();
  return next is(result ->> 'no_slot_chosen', '1', 'one request without a choice in 48 h');
  return next is(result ->> 'no_new_slots', '1', 'one request without new slots in 48 h');
  return next is((select status::text || '/' || close_reason::text from public.visit_requests where id = r1),
    'auto_dismissed/no_slot_chosen', 'classed automatically: no slot chosen');
  return next is((select status::text || '/' || close_reason::text from public.visit_requests where id = r2),
    'auto_dismissed/no_new_slots', 'classed automatically: no new slots');
  return next is((select status::text from public.visit_requests where id = r3), 'accepted',
    'a request with a scheduled visit stays');
  return next is((select count(*)::integer from public.visit_slots where request_id = r1 and status = 'offered'), 0,
    'its slots are no longer offered');
  return next is(pg_temp.notified(v1, 'request_dismissed') + pg_temp.notified(v2, 'request_dismissed'), 2,
    'both Visitors get the neutral message');
  perform pg_temp.as_user(v1);
  return next matches(pg_temp.err(format('select public.send_visit_request(%L, 1::smallint)', b)), 'cooldown',
    '30 days before writing to the same Bad again');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
-- Reminders: 1 h before, at the start; once each, to both
----------------------------------------------------------------------------------------------
create function pg_temp.test_hours_reminders() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; v uuid; req uuid; visit uuid;
begin
  perform pg_temp.open();
  b := pg_temp.bad('b@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  req := pg_temp.request(v, b);
  perform pg_temp.accept(b, req, 4, 5);
  visit := pg_temp.choose(v, pg_temp.slot_at(req, 4));
  return next is(public.run_visit_schedule() ->> 'reminders', '0', 'no reminder 4 h before');
  update public.visits set starts_at = now() + interval '50 minutes', ends_at = now() + interval '80 minutes' where id = visit;
  return next is(public.run_visit_schedule() ->> 'reminders', '2', 'the reminder 1 h before, to both');
  return next is(public.run_visit_schedule() ->> 'reminders', '0', 'once');
  return next is(pg_temp.notified(b, 'visit_reminder_1h') + pg_temp.notified(v, 'visit_reminder_1h'), 2, 'in-app, both');
  update public.visits set starts_at = now() - interval '1 minute', ends_at = now() + interval '29 minutes' where id = visit;
  return next is(public.run_visit_schedule() ->> 'starting', '2', '« la visite commence », to both');
  return next is(public.run_visit_schedule() ->> 'starting', '0', 'once');
end $$;

----------------------------------------------------------------------------------------------
-- Cancelling a scheduled visit
----------------------------------------------------------------------------------------------
create function pg_temp.test_hours_cancel() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; v uuid; other uuid; req uuid; visit uuid;
begin
  perform pg_temp.open();
  b := pg_temp.bad('b@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  other := pg_temp.visitor('o@test.local', ville);
  req := pg_temp.request(v, b);
  perform pg_temp.accept(b, req, 6, 7);
  visit := pg_temp.choose(v, pg_temp.slot_at(req, 6));
  perform pg_temp.as_user(other);
  return next matches(pg_temp.err(format('select public.cancel_visit(%L)', visit)), 'not_found', 'only the two of them');
  perform pg_temp.as_user(v);
  return next is(pg_temp.try(format('select public.cancel_visit(%L)', visit)), null, 'the Visitor cancels');
  perform pg_temp.as_owner();
  return next is((select status::text || '/' || cancelled_late from public.visits where id = visit), 'cancelled/false',
    'cancelled, not late (more than 2 h before)');
  return next is(pg_temp.notified(b, 'visit_cancelled'), 1, 'the Bad is told');
  perform pg_temp.as_user(b);
  return next is(public.get_request_schedule(req) ->> 'can_propose', 'true', 'the Bad may propose new slots (48 h)');
  perform public.propose_slots(req, array[pg_temp.h(9), pg_temp.h(10)]);
  perform pg_temp.as_owner();
  visit := pg_temp.choose(v, pg_temp.slot_at(req, 9));
  update public.visits set starts_at = now() + interval '90 minutes', ends_at = now() + interval '120 minutes' where id = visit;
  perform pg_temp.as_user(b);
  return next is(pg_temp.try(format('select public.cancel_visit(%L)', visit)), null, 'the Bad cancels');
  perform pg_temp.as_owner();
  return next is((select cancelled_late from public.visits where id = visit), true,
    'less than 2 h before: late (counts as an absence)');
  return next is(pg_temp.notified(v, 'visit_cancelled'), 1, 'the Visitor is told');
  -- Only one new proposal after a cancellation: the second one classes the case (owner, 2026-10-18).
  return next is((select status::text || '/' || close_reason::text from public.visit_requests where id = req),
    'closed/second_cancellation', 'second cancellation: the case is classed');
  return next is(pg_temp.notified(v, 'request_dismissed'), 1, 'the Visitor gets the neutral message');
  perform pg_temp.as_user(b);
  return next matches(pg_temp.err(format('select public.propose_slots(%L, %L::timestamptz[])', req,
    array[pg_temp.h(12), pg_temp.h(13)])), 'not_accepted', 'no third round of slots');
  perform pg_temp.as_owner();
end $$;

-- « Visites honorées »: a late cancellation by the Visitor is a visit due and not honored.
create function pg_temp.test_hours_late_cancel_reputation() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; v uuid; req uuid; visit uuid; rep record;
begin
  perform pg_temp.open();
  b := pg_temp.bad('b@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  req := pg_temp.request(v, b);
  perform pg_temp.accept(b, req, 6, 7);
  visit := pg_temp.choose(v, pg_temp.slot_at(req, 6));
  update public.visits set starts_at = now() + interval '60 minutes', ends_at = now() + interval '90 minutes' where id = visit;
  perform pg_temp.as_user(v);
  perform public.cancel_visit(visit);
  perform pg_temp.as_owner();
  select * into rep from public.visitor_reputation(v);
  return next is(rep.honored || '/' || rep.due, '0/1', 'late cancellation by the Visitor: 0 honored out of 1');
  select * into rep from public.visitor_reputation(b);
  return next is(rep.honored || '/' || rep.due, '0/0', 'a cancellation by the other side does not count');
  return next is((select status::text from public.visit_requests where id = req), 'accepted',
    'a first cancellation leaves the case open (48 h for new slots)');
end $$;

create function pg_temp.test_hours_block_cancels() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; v uuid; req uuid; visit uuid;
begin
  perform pg_temp.open();
  b := pg_temp.bad('b@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  req := pg_temp.request(v, b);
  perform pg_temp.accept(b, req, 6, 7);
  visit := pg_temp.choose(v, pg_temp.slot_at(req, 6));
  perform pg_temp.as_user(b);
  perform public.block_user(v);
  perform pg_temp.as_owner();
  return next is((select status::text from public.visits where id = visit), 'cancelled', 'a block cancels the visit');
  return next is((select count(*)::integer from public.visit_slots where request_id = req and status = 'offered'), 0,
    'and no slot stays offered');
  perform pg_temp.as_user(v);
  return next is((select count(*)::integer from public.get_my_visits()), 0, 'gone from the Tableau des visites');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
-- Rule 14 and Web Push
----------------------------------------------------------------------------------------------
create function pg_temp.test_hours_rule14_and_push() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; v uuid; req uuid; visit uuid; seen text;
begin
  perform pg_temp.open();
  b := pg_temp.bad('b@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  req := pg_temp.request(v, b);
  perform pg_temp.accept(b, req, 6, 7);
  visit := pg_temp.choose(v, pg_temp.slot_at(req, 6));
  perform pg_temp.as_user(v);
  seen := public.get_request_schedule(req)::text || (select coalesce(string_agg(to_jsonb(x)::text, ''), '') from public.get_my_visits() x);
  perform pg_temp.as_user(b);
  seen := seen || public.get_request_schedule(req)::text || (select coalesce(string_agg(to_jsonb(x)::text, ''), '') from public.get_my_visits() x);
  perform pg_temp.as_owner();
  return next ok(seen !~* 'guess|true_index|casier|Chef (UN|DEUX|TROIS)', 'nothing about the bet (rule 14)');
  return next is(public.push_path('slot_chosen'), '/visites', 'push « créneau choisi » opens the visits');
  return next is(public.push_path('visit_reminder_1h'), '/visites', 'push reminder 1 h');
  return next is(public.push_path('visit_starting'), '/visites', 'push « la visite commence »');
  return next is(public.push_path('slots_declined'), null, '« Aucun ne me va »: in-app only (SPEC §16)');
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
