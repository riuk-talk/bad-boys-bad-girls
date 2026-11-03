-- Phase 6 (pgTAP): le Parloir sans horaire et la Cavale (SPEC §10, §13). Every test_* function runs
-- in its own rolled-back transaction (runtests), so nothing persists. Helpers as in phase5c_parloir.

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
  update public.photos set status = 'approved', pending_path = null, is_cutout = true,
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

create function pg_temp.unread(p_user uuid, p_conversation uuid) returns integer language plpgsql as $$
declare n integer;
begin
  perform pg_temp.as_user(p_user);
  select u.unread into n from public.get_unread_counts() u where u.conversation_id = p_conversation;
  perform pg_temp.as_owner();
  return n;
end $$;

create function pg_temp.read_state(p_user uuid, p_conversation uuid) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  perform pg_temp.as_user(p_user);
  j := public.get_read_state(p_conversation);
  perform pg_temp.as_owner();
  return j;
end $$;

create function pg_temp.mark_read(p_user uuid, p_conversation uuid, p_up_to bigint) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  perform public.mark_conversation_read(p_conversation, p_up_to);
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
-- 6a: read and unread
----------------------------------------------------------------------------------------------
create function pg_temp.test_reads() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; v uuid; stranger uuid; conv uuid; first_id bigint; j jsonb;
begin
  perform pg_temp.open();
  b := pg_temp.bad('b@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  stranger := pg_temp.visitor('s@test.local', ville);
  conv := pg_temp.released(b, v);
  return next is(pg_temp.unread(b, conv), 0, 'nothing unread at the Permis permanent (system messages do not count)');
  perform pg_temp.say(v, conv, 'Premier');
  first_id := pg_temp.last_message(conv);
  perform pg_temp.say(v, conv, 'Deuxième');
  return next is(pg_temp.unread(b, conv), 2, 'two messages of the other, unread');
  return next is(pg_temp.unread(v, conv), 0, 'my own messages never count');
  perform pg_temp.mark_read(b, conv, first_id);
  return next is(pg_temp.unread(b, conv), 1, 'read up to the first');
  perform pg_temp.mark_read(b, conv, first_id - 100);
  return next is(pg_temp.unread(b, conv), 1, 'never backwards');
  perform pg_temp.mark_read(b, conv, 9223372036854775807);
  j := pg_temp.read_state(b, conv);
  return next is((j ->> 'my_read_id')::bigint, pg_temp.last_message(conv), 'never beyond the last message');
  return next is(pg_temp.unread(b, conv), 0, 'all read');
  j := pg_temp.read_state(v, conv);
  return next is((j ->> 'other_read_id')::bigint, pg_temp.last_message(conv), '« Lu »: the Visitor sees how far the Bad read');
  perform pg_temp.as_user(stranger);
  return next matches(pg_temp.err(format('select public.mark_conversation_read(%L, 1)', conv)), 'not_found', 'a third party cannot mark it');
  return next matches(pg_temp.err(format('select public.get_read_state(%L)', conv)), 'not_found', 'nor read its state');
  return next is((select count(*)::integer from public.get_unread_counts()), 0, 'nor count it');
  perform pg_temp.as_owner();
  perform pg_temp.as_user(v);
  perform public.block_user(b);
  return next matches(pg_temp.err(format('select public.get_read_state(%L)', conv)), 'not_found', 'after a block: nothing');
  return next is((select count(*)::integer from public.get_unread_counts()), 0, 'no counter after a block');
  perform pg_temp.as_owner();
  return next ok(not has_function_privilege('anon', 'public.get_unread_counts()', 'execute')
    and has_function_privilege('authenticated', 'public.mark_conversation_read(uuid, bigint)', 'execute'),
    'members only');
end $$;

----------------------------------------------------------------------------------------------
-- 6b: la Cavale
----------------------------------------------------------------------------------------------
create function pg_temp.propose_sql(p_conversation uuid, p_name text, p_hours integer) returns text language sql stable as $$
  select format('select public.propose_date(%L, %L, %L, %L)', p_conversation, 'bar', p_name, pg_temp.h(p_hours))
$$;

create function pg_temp.propose(p_user uuid, p_conversation uuid, p_name text, p_hours integer) returns uuid language plpgsql as $$
declare d uuid;
begin
  perform pg_temp.as_user(p_user);
  d := public.propose_date(p_conversation, 'bar', p_name, pg_temp.h(p_hours));
  perform pg_temp.as_owner();
  return d;
end $$;

create function pg_temp.dates(p_user uuid, p_conversation uuid) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  perform pg_temp.as_user(p_user);
  j := public.get_dates(p_conversation);
  perform pg_temp.as_owner();
  return j;
end $$;

create function pg_temp.as_err(p_user uuid, p_sql text) returns text language plpgsql as $$
declare e text;
begin
  perform pg_temp.as_user(p_user);
  e := pg_temp.err(p_sql);
  perform pg_temp.as_owner();
  return e;
end $$;

create function pg_temp.test_cavale_rules() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; v uuid; stranger uuid; conv uuid; visit uuid; d uuid; d2 uuid; j jsonb;
begin
  perform pg_temp.open();
  b := pg_temp.bad('b@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  stranger := pg_temp.visitor('s@test.local', ville);
  -- During the visit: no Cavale yet.
  visit := pg_temp.live_visit(b, v);
  perform pg_temp.join(v, visit);
  perform pg_temp.join(b, visit);
  conv := pg_temp.conv(visit);
  return next matches(pg_temp.as_err(v, pg_temp.propose_sql(conv, 'Le Zinc', 30)), 'not_open',
    'no Cavale before the Permis permanent');
  perform pg_temp.finish(visit);
  perform pg_temp.choose_end(v, visit, true);
  perform pg_temp.choose_end(b, visit, true);
  -- Checks on the proposal.
  return next matches(pg_temp.as_err(v, pg_temp.propose_sql(conv, 'Le Zinc', 0)), 'date_too_soon', 'at least 1 h ahead');
  return next matches(pg_temp.as_err(v, pg_temp.propose_sql(conv, 'Le Zinc', 24 * 61)), 'date_too_far', 'within 60 days');
  return next matches(pg_temp.as_err(v, pg_temp.propose_sql(conv, 'Z', 30)), 'venue_invalid', 'a real place name');
  return next matches(pg_temp.as_err(stranger, pg_temp.propose_sql(conv, 'Le Zinc', 30)), 'not_found', 'a third party cannot');
  d := pg_temp.propose(v, conv, 'Le Zinc, 06 12 34 56 78', 30);
  return next is((select venue_name from public.date_proposals where id = d), 'Le Zinc, [•••]', 'contacts masked in the place');
  return next is(pg_temp.notified(b, 'date_proposed'), 1, 'the other is told');
  return next matches(pg_temp.as_err(b, pg_temp.propose_sql(conv, 'Le Phare', 31)), 'date_pending', 'one waiting proposal at a time');
  return next matches(pg_temp.as_err(v, format('select public.respond_date(%L, true)', d)), 'not_found', 'not one''s own');
  return next matches(pg_temp.as_err(stranger, format('select public.get_dates(%L)', conv)), 'not_found', 'nothing for a third party');
  j := pg_temp.dates(b, conv);
  return next ok(j -> 'pending' ->> 'mine' = 'false' and j ->> 'can_propose' = 'false', 'the Bad sees it, to answer');
  -- « Proposer autre chose », then « Accepter ».
  perform pg_temp.as_user(b);
  d2 := public.counter_date(d, 'walk', 'Le sentier du littoral', pg_temp.h(32));
  perform pg_temp.as_owner();
  return next is((select status::text from public.date_proposals where id = d), 'countered', 'the first one is answered');
  return next is(pg_temp.notified(v, 'date_countered'), 1, 'the Visitor is told');
  return next ok((pg_temp.dates(v, conv) -> 'pending' ->> 'countered')::boolean, 'the new one is a counter-proposal');
  perform pg_temp.as_user(v);
  perform public.respond_date(d2, true);
  perform pg_temp.as_owner();
  return next ok((select cavale_accepted_at is not null from public.conversations where id = conv), 'accepted: noted on the conversation');
  return next is(pg_temp.notified(b, 'date_accepted'), 1, 'the proposer is told');
  j := pg_temp.dates(b, conv);
  return next ok(j -> 'accepted' ->> 'id' = d2::text and j ->> 'can_propose' = 'false', 'the pinned card, no other proposal');
  return next matches(pg_temp.as_err(v, pg_temp.propose_sql(conv, 'Le Zinc', 40)), 'date_accepted_exists',
    'moving it = cancel, then propose again');
  -- Cancelled by either one, in one gesture.
  perform pg_temp.as_user(v);
  perform public.cancel_date(d2);
  perform pg_temp.as_owner();
  return next is((select status::text from public.date_proposals where id = d2), 'cancelled', 'cancelled');
  return next is(pg_temp.notified(b, 'date_cancelled'), 1, 'the other is told');
  return next is(public.push_path('date_cancelled'), '/visites', 'pushed, to the Visites tab');
  return next ok((pg_temp.dates(b, conv) ->> 'can_propose')::boolean, 'a new Cavale is possible');
  -- The card goes the day after the date.
  d := pg_temp.propose(b, conv, 'Le Phare', 30);
  perform pg_temp.as_user(v);
  perform public.respond_date(d, true);
  perform pg_temp.as_owner();
  update public.date_proposals set starts_at = (date_trunc('day', now() at time zone 'Europe/Paris') - interval '20 hours') at time zone 'Europe/Paris'
  where id = d;
  j := pg_temp.dates(v, conv);
  return next ok(j -> 'accepted' = 'null'::jsonb and (j ->> 'can_propose')::boolean, 'yesterday''s Cavale: no more card');
  return next matches(pg_temp.as_err(v, format('select public.cancel_date(%L)', d)), 'not_cancellable', 'nor cancellation');
end $$;

create function pg_temp.test_cavale_not_yet_and_warning() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; v uuid; conv uuid; d uuid; j jsonb;
begin
  perform pg_temp.open();
  b := pg_temp.bad('b@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  conv := pg_temp.released(b, v);
  d := pg_temp.propose(v, conv, 'chez moi, 12 rue des Lilas', 30);
  return next ok((select private_place_warning from public.date_proposals where id = d), 'a private place: warned');
  return next ok((pg_temp.dates(b, conv) -> 'pending' ->> 'private_place_warning')::boolean, 'shown to the other too');
  perform pg_temp.as_user(b);
  perform public.respond_date(d, false);
  perform pg_temp.as_owner();
  return next is((select status::text from public.date_proposals where id = d), 'not_yet', '« Pas encore »');
  return next is(pg_temp.notified(v, 'date_accepted') + pg_temp.notified(v, 'date_countered'), 0, 'no notification for « Pas encore »');
  return next matches(pg_temp.as_err(v, pg_temp.propose_sql(conv, 'Le Zinc', 30)), 'not_yet_wait', 'the proposer waits 24 h');
  j := pg_temp.dates(v, conv);
  return next ok(j ->> 'wait_until' is not null and not (j ->> 'can_propose')::boolean, 'and sees until when');
  d := pg_temp.propose(b, conv, 'Café de la Plage', 30);
  return next ok(d is not null, 'the other may propose at once');
  return next ok(not (select private_place_warning from public.date_proposals where id = d), 'a café: no warning');
  update public.date_proposals set responded_at = now() - interval '25 hours' where conversation_id = conv and status = 'not_yet';
  perform pg_temp.as_user(b);
  perform public.cancel_date(d);
  perform pg_temp.as_owner();
  return next ok(pg_temp.propose(v, conv, 'Le Zinc', 30) is not null, 'after 24 h, the proposer may again');
  return next ok(public.looks_private_place('à la maison') and public.looks_private_place('My place')
    and public.looks_private_place('3bis avenue Foch') and not public.looks_private_place('Bar le 12')
    and not public.looks_private_place('Chez Léon, bistrot'), 'private places, and not');
end $$;

create function pg_temp.test_cavale_closed_or_blocked() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; v uuid; conv uuid; d uuid;
begin
  perform pg_temp.open();
  b := pg_temp.bad('b@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  conv := pg_temp.released(b, v);
  d := pg_temp.propose(v, conv, 'Le Zinc', 30);
  perform pg_temp.as_user(b);
  perform public.block_user(v);
  perform pg_temp.as_owner();
  return next is((select status::text from public.date_proposals where id = d), 'cancelled', 'a block ends the Cavale');
  return next matches(pg_temp.as_err(v, format('select public.respond_date(%L, true)', d)), 'not_found', 'nothing passes after a block');
  return next matches(pg_temp.as_err(v, pg_temp.propose_sql(conv, 'Le Phare', 30)), 'not_found', 'no new proposal either');
  return next ok(not has_table_privilege('authenticated', 'public.date_proposals', 'select,insert,update,delete')
    and not has_function_privilege('authenticated', 'public.insert_date_proposal(uuid, uuid, public.venue_type, text, timestamptz, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.get_dates(uuid)', 'execute'),
    'the table through functions only');
end $$;

----------------------------------------------------------------------------------------------
-- 6c: the masking is lifted after an accepted Cavale (SPEC §10, v7.6)
----------------------------------------------------------------------------------------------
create function pg_temp.body_of_last(p_conversation uuid) returns text language sql stable security definer as $$
  select body from public.messages where conversation_id = p_conversation and kind = 'text' order by id desc limit 1
$$;

create function pg_temp.accepted_cavale(p_bad uuid, p_visitor uuid, p_conversation uuid) returns uuid language plpgsql as $$
declare d uuid;
begin
  d := pg_temp.propose(p_visitor, p_conversation, 'Le Zinc', 30);
  perform pg_temp.as_user(p_bad);
  perform public.respond_date(d, true);
  perform pg_temp.as_owner();
  return d;
end $$;

create function pg_temp.test_unmask() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; v uuid; conv uuid; d uuid; first_masked bigint;
begin
  perform pg_temp.open();
  b := pg_temp.bad('b@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  conv := pg_temp.released(b, v);
  perform pg_temp.say(v, conv, 'Mon 06 12 34 56 78');
  first_masked := pg_temp.last_message(conv);
  return next is(pg_temp.body_of_last(conv), 'Mon [•••]', 'Permis permanent, no Cavale: masked');
  perform pg_temp.as_user(v);
  return next is(public.get_conversation(conv) ->> 'unmasked', 'false', 'the notice is not shown yet');
  perform pg_temp.as_owner();
  d := pg_temp.accepted_cavale(b, v, conv);
  perform pg_temp.say(v, conv, 'Mon 06 12 34 56 78');
  return next is(pg_temp.body_of_last(conv), 'Mon 06 12 34 56 78', 'Cavale accepted: in clear');
  return next is((select body from public.messages where id = first_masked), 'Mon [•••]', 'the earlier messages stay masked');
  perform pg_temp.as_user(b);
  return next is(public.get_conversation(conv) ->> 'unmasked', 'true', '« Ne partage jamais d''argent ni de codes »');
  perform public.cancel_date(d);
  perform pg_temp.as_owner();
  perform pg_temp.say(b, conv, 'Écris à lune@example.com');
  return next is(pg_temp.body_of_last(conv), 'Écris à lune@example.com', 'a cancelled Cavale keeps it lifted');
  -- A blocking report masks again while it is open.
  insert into public.reports (reporter_id, target_user_id, target_type, target_id, category)
  values (v, b, 'visit_request', gen_random_uuid()::text, 'other');
  perform pg_temp.say(b, conv, 'Écris à lune@example.com');
  return next is(pg_temp.body_of_last(conv), 'Écris à [•••]', 'a report open between the two: masked');
  update public.reports set status = 'rejected' where target_user_id = b;
  insert into public.reports (reporter_id, target_user_id, target_type, target_id, category)
  values (null, v, 'permit', gen_random_uuid()::text, 'scam');
  perform pg_temp.say(b, conv, 'Écris à lune@example.com');
  return next is(pg_temp.body_of_last(conv), 'Écris à [•••]', 'an open scam report against one of them: masked');
  update public.reports set status = 'rejected' where target_user_id = v;
  perform pg_temp.say(b, conv, 'Écris à lune@example.com');
  return next is(pg_temp.body_of_last(conv), 'Écris à lune@example.com', 'reports closed: in clear again');
  -- An account of less than 7 days.
  update public.profiles set created_at = now() - interval '3 days' where id = v;
  perform pg_temp.say(b, conv, 'Écris à lune@example.com');
  return next is(pg_temp.body_of_last(conv), 'Écris à [•••]', 'an account of less than 7 days: masked');
end $$;

create function pg_temp.test_unmask_never_during_a_visit() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; v uuid; visit uuid; conv uuid;
begin
  perform pg_temp.open();
  b := pg_temp.bad('b@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  visit := pg_temp.live_visit(b, v);
  perform pg_temp.join(v, visit);
  perform pg_temp.join(b, visit);
  conv := pg_temp.conv(visit);
  -- Even if the column were set, a conversation in its visit is never unmasked.
  update public.conversations set cavale_accepted_at = now() where id = conv;
  perform pg_temp.say(v, conv, 'Mon 06 12 34 56 78');
  return next is(pg_temp.body_of_last(conv), 'Mon [•••]', 'during the 30 minutes: always masked');
  return next ok(not has_function_privilege('authenticated', 'private.can_unmask(uuid)', 'execute'), 'internal');
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
