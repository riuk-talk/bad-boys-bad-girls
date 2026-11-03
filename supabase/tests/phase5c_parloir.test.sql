-- Phase 5c (pgTAP): la visite au Parloir (SPEC §7 ter, §13). Every test_* function runs in its own
-- rolled-back transaction (runtests), so nothing persists. Helpers as in phase5b_hours.

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

----------------------------------------------------------------------------------------------
-- Structure and rights
----------------------------------------------------------------------------------------------
create function pg_temp.test_parloir_structure() returns setof text language plpgsql as $$
declare f text;
begin
  return next is((select count(*)::integer from pg_class where oid in ('public.conversations'::regclass,
    'public.messages'::regclass) and relrowsecurity), 2, 'RLS is on for conversations and messages');
  return next ok(not has_table_privilege('authenticated', 'public.conversations', 'select,insert,update,delete')
    and not has_table_privilege('authenticated', 'public.messages', 'insert,update,delete')
    and not has_table_privilege('anon', 'public.messages', 'select'),
    'conversations through functions only; messages never written directly; nothing for anon');
  return next ok(has_table_privilege('authenticated', 'public.messages', 'select'),
    'messages readable (RLS: the two members), needed by Realtime');
  return next ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'messages'), 'messages are published to Realtime');
  foreach f in array array['get_visit(uuid)', 'join_visit(uuid)', 'choose_visit_end(uuid, boolean)',
    'send_message(uuid, text)', 'get_messages(uuid, bigint)', 'get_conversation(uuid)', 'get_my_parloirs()',
    'close_conversation(uuid)', 'close_after_absence(uuid)'] loop
    return next ok(has_function_privilege('authenticated', 'public.' || f, 'execute')
      and not has_function_privilege('anon', 'public.' || f, 'execute'), 'members (not anon) call ' || f);
  end loop;
  foreach f in array array['start_visit(uuid)', 'reveal_bet(uuid)', 'resolve_visit(uuid)', 'run_parloir_ticks()'] loop
    return next ok(not has_function_privilege('authenticated', 'public.' || f, 'execute'), 'internal: ' || f);
  end loop;
  return next is((select schedule from cron.job where jobname = 'parloir-ticks'), '* * * * *',
    'the Parloir job runs every minute');
end $$;

----------------------------------------------------------------------------------------------
-- Start, presence, the bet revealed only when both are there (rule 14)
----------------------------------------------------------------------------------------------
create function pg_temp.test_parloir_start_and_reveal() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; v uuid; stranger uuid; visit uuid; conv uuid; j jsonb; bet jsonb;
begin
  perform pg_temp.open();
  b := pg_temp.bad('b@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  stranger := pg_temp.visitor('s@test.local', ville);
  visit := pg_temp.live_visit(b, v);
  conv := pg_temp.conv(visit);
  return next is((select status::text from public.visits where id = visit), 'in_progress', 'the job starts the visit');
  return next ok(conv is not null, 'its conversation is created');
  return next is(pg_temp.notified(v, 'visit_starting'), 1, '« la visite commence », once');
  return next is((select count(*)::integer from public.messages where conversation_id = conv), 0,
    'nothing revealed before both are there');
  j := pg_temp.join(v, visit);
  return next is(j ->> 'me_present' || '/' || (j ->> 'other_present'), 'true/false', 'the Visitor is present, waiting');
  return next is((select count(*)::integer from public.messages where conversation_id = conv), 0,
    'one member alone: still nothing revealed');
  j := pg_temp.join(b, visit);
  return next is(j ->> 'other_present', 'true', 'the Bad joins: both present');
  select system_payload into bet from public.messages where conversation_id = conv and system_payload ->> 'type' = 'bet';
  return next is(bet ->> 'correct', 'false', 'the bet is revealed: wrong guess (1 instead of 2)');
  return next is(bet ->> 'charge', 'Chef UN a traversé la Manche en kayak', 'with the chosen charge');
  return next is(bet ->> 'true_charge', 'Chef DEUX a dormi dans un phare breton', 'and the true one');
  return next is((select system_payload ->> 'text' from public.messages where conversation_id = conv
    and system_payload ->> 'type' = 'note'), 'Couche-tard aussi.', 'then the Visitor''s note');
  perform pg_temp.join(v, visit);
  return next is((select count(*)::integer from public.messages where conversation_id = conv), 2, 'revealed once');
  perform pg_temp.as_user(v);
  return next is((select count(*)::integer from public.get_messages(conv)), 2, 'the Visitor reads the conversation');
  return next is((select count(*)::integer from public.messages), 2, 'RLS: a member reads its messages');
  return next is((select mine from public.get_messages(conv) where payload ->> 'type' = 'note'), true,
    'the note is the Visitor''s');
  perform pg_temp.as_user(stranger);
  return next matches(pg_temp.err(format('select public.get_messages(%L)', conv)), 'not_found', 'not a stranger');
  return next matches(pg_temp.err(format('select public.get_visit(%L)', visit)), 'not_found', 'nor the visit');
  return next is((select count(*)::integer from public.messages), 0, 'RLS: a stranger reads no message');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
-- Messages: during the visit only, both present, 1,000 characters, masked, 30 per minute
----------------------------------------------------------------------------------------------
create function pg_temp.test_parloir_messages() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; v uuid; stranger uuid; visit uuid; conv uuid; i integer; e text;
begin
  perform pg_temp.open();
  b := pg_temp.bad('b@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  stranger := pg_temp.visitor('s@test.local', ville);
  visit := pg_temp.live_visit(b, v);
  conv := pg_temp.conv(visit);
  perform pg_temp.join(v, visit);
  return next matches(pg_temp.say(v, conv, 'Salut'), 'not_open', 'alone in the Parloir: no message yet');
  perform pg_temp.join(b, visit);
  return next is(pg_temp.say(v, conv, 'Appelle-moi au 06 12 34 56 78'), 'ok', 'both present: a message');
  return next ok((select body from public.messages where conversation_id = conv and kind = 'text') like '%[•••]%',
    'the phone number is masked');
  return next matches(pg_temp.say(v, conv, '   '), 'message_empty', 'no empty message');
  return next matches(pg_temp.say(v, conv, repeat('a', 1001)), 'message_too_long', '1,000 characters at most');
  return next matches(pg_temp.say(stranger, conv, 'Coucou'), 'not_found', 'a stranger cannot write');
  for i in 2 .. 30 loop perform pg_temp.say(b, conv, 'message ' || i); end loop;
  e := pg_temp.say(b, conv, 'encore');
  return next is(e, 'ok', 'another member has their own limit');
  for i in 2 .. 30 loop perform pg_temp.say(v, conv, 'message ' || i); end loop;
  return next matches(pg_temp.say(v, conv, 'un de trop'), 'rate_limited', '30 messages per minute at most');
  update public.visits set ends_at = now() - interval '1 second', starts_at = now() - interval '30 minutes 1 second'
  where id = visit;
  return next matches(pg_temp.say(b, conv, 'trop tard'), 'not_open', 'the 30 minutes are over: no message');
end $$;

----------------------------------------------------------------------------------------------
-- Absence: 10 minutes after the start; a second absence classes the case
----------------------------------------------------------------------------------------------
create function pg_temp.test_parloir_absence() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; v uuid; visit uuid; req uuid; j jsonb; rep record;
begin
  perform pg_temp.open();
  b := pg_temp.bad('b@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  visit := pg_temp.live_visit(b, v);
  req := (select request_id from public.visits where id = visit);
  perform pg_temp.join(v, visit);
  update public.visits set starts_at = now() - interval '11 minutes', ends_at = now() + interval '19 minutes' where id = visit;
  perform public.run_parloir_ticks();
  return next is((select status::text || '/' || absent::text from public.visits where id = visit), 'no_show/bad',
    '+10 min without the Bad: absent');
  perform pg_temp.as_user(v);
  j := public.get_visit(visit);
  return next is(j ->> 'absent', 'other', 'the Visitor sees that the other was absent');
  perform pg_temp.as_owner();
  return next is(pg_temp.notified(b, 'visit_no_show') + pg_temp.notified(v, 'visit_no_show'), 2, 'both are told');
  return next is((select count(*)::integer from public.messages m join public.visits x on x.conversation_id = m.conversation_id
    where x.id = visit), 0, 'the bet is not revealed (no visit took place)');
  return next ok((select no_show_count = 1 and repropose_deadline > now() and status = 'accepted'
    from public.visit_requests where id = req), 'first absence: 48 h for new slots');
  select * into rep from public.visitor_reputation(v);
  return next is(rep.honored || '/' || rep.due, '1/1', 'the Visitor came: honored');
  perform pg_temp.as_user(b);
  return next is(public.get_visit(visit) ->> 'can_propose', 'true', 'the Bad may propose new slots');
  return next matches(pg_temp.err(format('select public.close_after_absence(%L)', req)), 'not_expected',
    'the Bad was the absent one: no « classer » for the absence');
  perform public.propose_slots(req, array[pg_temp.h(9), pg_temp.h(10)]);
  perform pg_temp.as_owner();
  visit := pg_temp.choose(v, pg_temp.slot_at(req, 9));
  update public.visits set starts_at = now() - interval '11 minutes', ends_at = now() + interval '19 minutes' where id = visit;
  perform public.run_parloir_ticks();
  return next is((select status::text || '/' || absent::text from public.visits where id = visit), 'no_show/both',
    'nobody came: both absent');
  return next is((select status::text || '/' || close_reason::text from public.visit_requests where id = req),
    'closed/second_no_show', 'second absence: the case is classed');
  return next is(pg_temp.notified(v, 'request_dismissed'), 1, 'neutral message to the Visitor');
  select * into rep from public.visitor_reputation(v);
  return next is(rep.honored || '/' || rep.due, '1/2', 'the Visitor''s absence: due, not honored');
end $$;

----------------------------------------------------------------------------------------------
-- The Visitor absent: the Bad may propose new slots, or class the case; neither is required
----------------------------------------------------------------------------------------------
create function pg_temp.test_parloir_visitor_absent() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; v uuid; b2 uuid; v2 uuid; visit uuid; req uuid; j jsonb; rep record;
begin
  perform pg_temp.open();
  -- Case 1: the Bad proposes new slots.
  b := pg_temp.bad('b@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  visit := pg_temp.live_visit(b, v);
  req := (select request_id from public.visits where id = visit);
  perform pg_temp.join(b, visit);
  update public.visits set starts_at = now() - interval '11 minutes', ends_at = now() + interval '19 minutes' where id = visit;
  perform public.run_parloir_ticks();
  return next is((select status::text || '/' || absent::text from public.visits where id = visit), 'no_show/visitor',
    '+10 min without the Visitor: absent');
  select * into rep from public.visitor_reputation(v);
  return next is(rep.honored || '/' || rep.due, '0/1', 'the absence counts in the Visitor''s « Visites honorées »');
  perform pg_temp.as_user(b);
  j := public.get_request_schedule(req);
  return next ok((j ->> 'can_propose')::boolean and (j ->> 'can_close_after_absence')::boolean,
    'the Bad may propose new slots or class the case');
  perform pg_temp.as_user(v);
  return next matches(pg_temp.err(format('select public.close_after_absence(%L)', req)), 'not_found',
    'only the Bad classes');
  return next is(public.get_request_schedule(req) ->> 'can_close_after_absence', 'false', 'nothing to class for the Visitor');
  perform pg_temp.as_user(b);
  perform public.propose_slots(req, array[pg_temp.h(9), pg_temp.h(10)]);
  return next is(public.get_request_schedule(req) ->> 'can_close_after_absence', 'false', 'new slots sent: no more « classer »');
  return next matches(pg_temp.err(format('select public.close_after_absence(%L)', req)), 'not_expected',
    'nor through the function');
  perform pg_temp.as_owner();
  return next ok((select status = 'accepted' and slots_round = 2 and choose_deadline > now()
    from public.visit_requests where id = req), 'reproposed: the Visitor has 48 h to choose');
  return next is(pg_temp.notified(v, 'slots_reproposed'), 1, 'the Visitor is told');

  -- Case 2: the Bad classes the case.
  b2 := pg_temp.bad('b2@test.local', ville);
  v2 := pg_temp.visitor('v2@test.local', ville);
  visit := pg_temp.live_visit(b2, v2);
  req := (select request_id from public.visits where id = visit);
  perform pg_temp.join(b2, visit);
  update public.visits set starts_at = now() - interval '11 minutes', ends_at = now() + interval '19 minutes' where id = visit;
  perform public.run_parloir_ticks();
  perform pg_temp.as_user(b2);
  perform public.close_after_absence(req);
  perform pg_temp.as_owner();
  return next is((select status::text || '/' || close_reason::text from public.visit_requests where id = req),
    'closed/closed_after_absence', '« Affaire classée » after the absence');
  return next is(pg_temp.notified(v2, 'request_dismissed'), 1, 'neutral message to the Visitor');
  return next is((select count(*)::integer from public.visit_slots where request_id = req and status = 'offered'), 0,
    'no slot left to choose');
  return next ok(public.pair_cooldown_until(v2, b2) > now() + interval '29 days', '30 days before a new request');
  select * into rep from public.visitor_reputation(v2);
  return next is(rep.honored || '/' || rep.due, '0/1', 'the absence stays counted');
  perform pg_temp.as_user(b2);
  return next matches(pg_temp.err(format('select public.propose_slots(%L, array[%L::timestamptz, %L::timestamptz])',
    req, pg_temp.h(9), pg_temp.h(10))), 'not_accepted', 'no new slots after that');
  return next matches(pg_temp.err(format('select public.close_after_absence(%L)', req)), 'not_expected', 'classed once');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
-- End of the visit: secret choices, Permis permanent only if both prolong
----------------------------------------------------------------------------------------------
create function pg_temp.test_parloir_permis_permanent() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; v uuid; visit uuid; conv uuid; req uuid; j jsonb;
begin
  perform pg_temp.open();
  b := pg_temp.bad('b@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  visit := pg_temp.live_visit(b, v);
  conv := pg_temp.conv(visit);
  req := (select request_id from public.visits where id = visit);
  perform pg_temp.join(v, visit);
  perform pg_temp.join(b, visit);
  perform pg_temp.as_user(v);
  return next matches(pg_temp.err(format('select public.choose_visit_end(%L, true)', visit)), 'not_open',
    'no choice during the visit');
  perform pg_temp.as_owner();
  perform pg_temp.finish(visit);
  return next ok((select status = 'ended' and end_choice_deadline = ends_at + interval '24 hours'
    from public.visits where id = visit), 'after 30 min: ended, 24 h to choose');
  j := pg_temp.choose_end(v, visit, true);
  return next is(j ->> 'my_choice' || '/' || coalesce(j ->> 'outcome', '-'), 'prolong/-', 'the Visitor prolongs, waiting');
  perform pg_temp.as_user(b);
  j := public.get_visit(visit);
  return next ok(j ->> 'my_choice' is null and j::text not like '%prolong%', 'the Bad never sees the other''s choice');
  return next matches(pg_temp.err(format('select public.choose_visit_end(%L, null)', visit)), 'choice_required', 'a choice');
  perform pg_temp.as_owner();
  return next matches((select pg_temp.err(format('select public.choose_visit_end(%L, false)', visit))), 'not_found',
    'the owner is not a participant');
  j := pg_temp.choose_end(b, visit, true);
  return next is(j ->> 'outcome', 'released', 'both prolong: Permis permanent');
  return next is((select status::text from public.visit_requests where id = req), 'released', 'the case is released');
  return next is((select status::text from public.conversations where id = conv), 'open', 'the Parloir stays open');
  return next is(pg_temp.notified(b, 'visit_released') + pg_temp.notified(v, 'visit_released'), 2, 'both are told');
  perform pg_temp.as_user(v);
  return next matches(pg_temp.err(format('select public.choose_visit_end(%L, false)', visit)), 'not_open', 'chosen once');
  return next is((select count(*)::integer from public.get_my_parloirs()), 1, 'in « Mes Parloirs »');
  perform pg_temp.as_owner();
  return next is(pg_temp.say(v, conv, 'Sans horaire maintenant'), 'ok', 'messages without a visit (Permis permanent)');
  perform pg_temp.say(v, conv, 'Et encore');
  return next is(pg_temp.notified(b, 'message_received'), 1, 'one message notification per 15 minutes');
  return next is(public.push_path('message_received'), '/visites', 'pushed, to the Visites tab');
  perform pg_temp.as_user(b);
  perform public.close_conversation(conv);
  perform pg_temp.as_owner();
  return next is((select status::text || '/' || close_reason::text from public.visit_requests where id = req),
    'closed/closed_after_release', '« Affaire classée » from the Parloir sans horaire');
  return next is((select status::text from public.conversations where id = conv), 'closed', 'the Parloir is closed');
  return next matches(pg_temp.say(v, conv, 'Allô ?'), 'conversation_closed', 'no message after that');
  return next is(pg_temp.notified(v, 'visit_closed'), 1, 'the other is told (neutral)');
  return next ok(public.pair_cooldown_until(v, b) > now() + interval '29 days', '30 days before a new request');
end $$;

create function pg_temp.test_parloir_closed_or_late() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; v uuid; b2 uuid; visit uuid; visit2 uuid; j jsonb;
begin
  perform pg_temp.open();
  b := pg_temp.bad('b@test.local', ville);
  b2 := pg_temp.bad('b2@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  visit := pg_temp.live_visit(b, v);
  perform pg_temp.join(v, visit);
  perform pg_temp.join(b, visit);
  perform pg_temp.finish(visit);
  perform pg_temp.choose_end(b, visit, false);
  j := pg_temp.choose_end(v, visit, true);
  return next is(j ->> 'outcome', 'closed', 'one « Affaire classée »: classed');
  return next is((select close_reason::text from public.visit_requests where id = (select request_id from public.visits where id = visit)),
    'not_prolonged', 'reason: not prolonged');
  return next is((select c.status::text from public.conversations c join public.visits x on x.conversation_id = c.id
    where x.id = visit), 'closed', 'the conversation is closed');
  -- Nobody answers within 24 h.
  visit2 := pg_temp.live_visit(b2, v);
  perform pg_temp.join(v, visit2);
  perform pg_temp.join(b2, visit2);
  perform pg_temp.finish(visit2);
  perform pg_temp.choose_end(v, visit2, true);
  update public.visits set end_choice_deadline = now() - interval '1 second' where id = visit2;
  perform public.run_parloir_ticks();
  return next is((select outcome from public.visits where id = visit2), 'closed', 'no answer within 24 h: classed');
  return next is((select close_reason::text from public.visit_requests where id = (select request_id from public.visits where id = visit2)),
    'no_end_choice', 'reason: no end choice');
end $$;

----------------------------------------------------------------------------------------------
-- Bloquer ends the visit at once
----------------------------------------------------------------------------------------------
create function pg_temp.test_parloir_block() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; v uuid; visit uuid; conv uuid;
begin
  perform pg_temp.open();
  b := pg_temp.bad('b@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  visit := pg_temp.live_visit(b, v);
  conv := pg_temp.conv(visit);
  perform pg_temp.join(v, visit);
  perform pg_temp.join(b, visit);
  perform pg_temp.as_user(v);
  perform public.block_user(b);
  return next matches(pg_temp.err(format('select public.get_visit(%L)', visit)), 'not_found', 'the visit is gone for them');
  perform pg_temp.as_owner();
  return next is((select status::text from public.visits where id = visit), 'cancelled', 'the visit ends');
  return next is((select status::text from public.conversations where id = conv), 'closed', 'the Parloir is closed');
  perform pg_temp.as_user(b);
  return next is((select count(*)::integer from public.messages), 0, 'RLS: no message readable after a block');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
