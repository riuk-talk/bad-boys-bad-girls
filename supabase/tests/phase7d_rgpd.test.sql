-- Phase 7d (pgTAP): RGPD (SPEC §10). Every test_* function runs in its own rolled-back transaction
-- (runtests), so nothing persists. Helpers as in phase7c_jobs.

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
-- Export: my data, the other person reduced to their pseudo
----------------------------------------------------------------------------------------------
create function pg_temp.export_of(p_user uuid) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  perform pg_temp.as_user(p_user);
  j := public.export_my_data();
  perform pg_temp.as_owner();
  return j;
end $$;

create function pg_temp.test_export() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); b uuid; v uuid; conv uuid; e jsonb; bp text;
begin
  perform pg_temp.open();
  b := pg_temp.bad('bad@test.local', pl);
  v := pg_temp.visitor('visitor@test.local', pl);
  conv := pg_temp.released(b, v);
  perform pg_temp.say(v, conv, 'Texte du Visiteur');
  perform pg_temp.say(b, conv, 'Texte du Bad');
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (v, 'https://push.example/abc', repeat('k', 60), repeat('a', 16));
  select pseudo::text into bp from public.profiles where id = b;
  e := pg_temp.export_of(v);
  return next is(e -> 'account' ->> 'email', 'visitor@test.local', 'my account');
  return next is(e -> 'profile' ->> 'visit_motive', 'Motif de test', 'my Permis');
  return next is(e -> 'requests_sent' -> 0 ->> 'bad', bp, 'the other person by their pseudo');
  return next is(e -> 'requests_sent' -> 0 ->> 'my_note', 'Couche-tard aussi.', 'my own note');
  return next ok(position('Texte du Visiteur' in e::text) > 0, 'my messages');
  return next ok(position('Texte du Bad' in e::text) = 0, 'never the messages of the other');
  return next ok(position('Chef UN' in e::text) = 0 and position('guess_correct' in e::text) = 0
    and position('true_index' in e::text) = 0, 'never the Casier of the Bad nor the result of the bet');
  return next ok(position(b::text in e::text) = 0, 'never the id of the other');
  return next ok(jsonb_array_length(e -> 'push_devices') = 1 and position('push.example' in e::text) = 0
    and position(repeat('k', 60) in e::text) = 0, 'my devices without their address or keys');
  e := pg_temp.export_of(b);
  return next ok(position('Couche-tard' in e::text) = 0, 'the Bad never gets the note of the Visitor');
  return next ok(e -> 'casier' ->> 'charge_1' like 'Chef UN%', 'the Bad gets their own Casier');
end $$;

----------------------------------------------------------------------------------------------
-- Deletion: messages erased, conversation kept for the other, visits cancelled, cascade
----------------------------------------------------------------------------------------------
create function pg_temp.test_deletion() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); b uuid; v uuid; v2 uuid; adm uuid; conv uuid; req2 uuid; visit2 uuid;
  files record; c jsonb;
begin
  perform pg_temp.open();
  b := pg_temp.bad('bad@test.local', pl);
  v := pg_temp.visitor('visitor@test.local', pl);
  v2 := pg_temp.visitor('visitor2@test.local', pl);
  adm := pg_temp.new_admin('admin@test.local');
  conv := pg_temp.released(b, v);
  perform pg_temp.say(v, conv, 'Mon numéro bientôt');
  perform pg_temp.say(b, conv, 'Message du Bad');
  -- A visit planned with another Visitor, and a decision of the Greffe about the Bad.
  req2 := pg_temp.request(v2, b);
  perform pg_temp.accept(b, req2, 30, 31);
  visit2 := pg_temp.choose(v2, pg_temp.slot_at(req2, 30));
  perform pg_temp.as_admin(adm, format('select public.admin_sanction(%L, ''warn'', ''Un motif assez long'')', b));

  perform pg_temp.as_user(b);
  select * into files from public.prepare_my_account_deletion();
  perform pg_temp.as_owner();
  return next ok(cardinality(files.pending_paths) + cardinality(files.public_paths) > 0, 'my files are listed for the server');
  return next ok((select status = 'cancelled' from public.visits where id = visit2), 'my scheduled visits are cancelled');
  return next is(pg_temp.notified(v2, 'request_dismissed'), 1, 'the Visitor is told neutrally');
  return next ok(not exists (select 1 from public.messages where conversation_id = conv and sender_id = b
                             and (removed_at is null or body <> '')), 'my messages are erased');
  return next ok(not exists (select 1 from public.messages where conversation_id = conv and system_payload ->> 'type' = 'bet'),
    'my Casier copied in the bet is erased');

  -- The server then deletes the Auth account (secret key): every row follows.
  delete from auth.users where id = b;
  return next ok(not exists (select 1 from public.profiles where id = b), 'the profile is gone');
  return next ok(not exists (select 1 from public.moderation_actions where target_user_id = b), 'with the decisions about it');
  return next ok(exists (select 1 from public.conversations where id = conv and bad_id is null and visitor_id = v),
    'the conversation stays for the other');
  perform pg_temp.as_user(v);
  c := public.get_conversation(conv);
  return next ok((c ->> 'other_deleted')::boolean and c ->> 'status' = 'closed', '« Ce compte a été supprimé », nothing can be sent');
  return next ok(exists (select 1 from public.get_my_parloirs() p where p.conversation_id = conv and p.other_id is null),
    'it stays in the list of Parloirs');
  return next ok((select bool_and(m.body is null and m.payload ->> 'type' = 'removed')
                  from public.get_messages(conv) m where m.kind = 'text' and not m.mine), '« Message supprimé »');
  return next ok(exists (select 1 from public.get_messages(conv) m where m.mine and m.body = 'Mon numéro bientôt'),
    'my own messages stay');
  perform pg_temp.as_owner();
  return next is(pg_temp.err(format('update public.moderation_actions set reason = ''x'' where target_user_id = %L', v)),
    'ok', 'nothing to rewrite about a living member here');
end $$;

-- The decisions about a living member stay append-only.
create function pg_temp.test_append_only_kept() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); v uuid; adm uuid;
begin
  v := pg_temp.visitor('visitor@test.local', pl);
  adm := pg_temp.new_admin('admin@test.local');
  perform pg_temp.as_admin(adm, format('select public.admin_sanction(%L, ''warn'', ''Un motif assez long'')', v));
  return next is(pg_temp.err(format('delete from public.moderation_actions where target_user_id = %L', v)),
    '42501 append_only', 'never erased while the member exists');
  return next is(pg_temp.err(format('update public.moderation_actions set reason = ''x'' where target_user_id = %L', v)),
    '42501 append_only', 'never rewritten');
  return next ok(not has_function_privilege('anon', 'public.export_my_data()', 'execute')
    and not has_function_privilege('anon', 'public.prepare_my_account_deletion()', 'execute'), 'nothing for anon');
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
