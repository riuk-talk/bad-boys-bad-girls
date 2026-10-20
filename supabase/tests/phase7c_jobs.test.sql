-- Phase 7c (pgTAP): les tâches planifiées (SPEC §3, §5, §11, §14). Every test_* function runs in its
-- own rolled-back transaction (runtests), so nothing persists (no real quartier is ever opened).
-- Helpers as in phase7b_pilotage.

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
-- Bonne conduite
----------------------------------------------------------------------------------------------
create function pg_temp.held_visit(p_bad uuid, p_visitor uuid) returns void language plpgsql as $$
declare visit uuid;
begin
  visit := pg_temp.live_visit(p_bad, p_visitor);
  perform pg_temp.join(p_visitor, visit);
  perform pg_temp.join(p_bad, visit);
  perform pg_temp.finish(visit);
end $$;

create function pg_temp.test_good_conduct() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); b uuid; b2 uuid; i integer;
begin
  perform pg_temp.open();
  b := pg_temp.bad('bad@test.local', pl);
  b2 := pg_temp.bad('bad2@test.local', pl);
  update public.profiles set created_at = now() - interval '40 days' where id in (b, b2);
  for i in 1..3 loop
    perform pg_temp.held_visit(b, pg_temp.visitor('v' || i || '@test.local', pl));
  end loop;
  perform pg_temp.held_visit(b2, pg_temp.visitor('w1@test.local', pl));
  perform public.compute_good_conduct();
  return next ok((select is_reglo from public.profiles where id = b), '3 visits held, 30 days, nothing against: Bonne conduite');
  return next ok(not (select is_reglo from public.profiles where id = b2), 'one visit is not enough');
  insert into public.reports (reporter_id, target_user_id, target_type, target_id, category, status)
  values (b2, b, 'profile', b::text, 'other', 'upheld');
  perform public.compute_good_conduct();
  return next ok(not (select is_reglo from public.profiles where id = b), 'a report upheld takes it away');
end $$;

----------------------------------------------------------------------------------------------
-- Fiches en veille
----------------------------------------------------------------------------------------------
create function pg_temp.test_inactive_profiles() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); b uuid; b2 uuid;
begin
  b := pg_temp.bad('bad@test.local', pl);
  b2 := pg_temp.bad('bad2@test.local', pl);
  update public.profiles set last_seen_at = now() - interval '91 days' where id = b;
  update public.profiles set last_seen_at = now() - interval '30 days' where id = b2;
  return next is(public.process_inactive_profiles(), 1, 'one Fiche goes to sleep');
  return next is(public.process_inactive_profiles(), 0, 'only once');
  return next ok((select dormant_since is not null from public.profiles where id = b), 'after 90 days');
  return next ok((select dormant_since is null from public.profiles where id = b2), 'not before');
  return next is(pg_temp.notified(b, 'profile_dormant'), 1, 'the member is told');
  return next is((select count(*)::integer from public.email_outbox where user_id = b and kind = 'profile_dormant'), 1,
    'by e-mail too');
  perform pg_temp.as_user(b);
  perform public.touch_activity();
  perform pg_temp.as_owner();
  return next ok((select dormant_since is null from public.profiles where id = b), 'coming back wakes the Fiche up');
end $$;

-- 21 days: out of the Promenade, last in the Découverte.
create function pg_temp.test_inactive_fiches() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); active uuid; idle uuid; v uuid;
begin
  perform pg_temp.open();
  active := pg_temp.bad('active@test.local', pl);
  idle := pg_temp.bad('idle@test.local', pl);
  v := pg_temp.visitor('visitor@test.local', pl);
  update public.profiles set last_seen_at = now() - interval '25 days' where id = idle;
  perform public.build_daily_promenade(null, current_date);
  return next ok(exists (select 1 from public.promenade_picks where visitor_id = v and bad_id = active), 'an active Bad walks');
  return next ok(not exists (select 1 from public.promenade_picks where visitor_id = v and bad_id = idle),
    'a Bad without sign-in for 21 days does not');
  perform pg_temp.as_user(v);
  return next is((select array_agg(d.id order by d.sort_key desc, d.id desc) from public.discover_bads() d),
    array[active, idle], 'the Découverte shows them last');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
-- Quartiers: ready once, opened by itself only with auto_open
----------------------------------------------------------------------------------------------
create function pg_temp.test_auto_open() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); adm uuid; girl uuid; boy uuid; v uuid; z smallint;
begin
  adm := pg_temp.new_admin('admin@test.local');
  girl := pg_temp.bad('girl@test.local', pl);
  boy := pg_temp.bad('boy@test.local', pl);
  update public.profiles set gender = 'man' where id = boy;
  v := pg_temp.visitor('visitor@test.local', pl);
  z := pg_temp.new_zone(adm, pl);
  perform public.auto_open_zones();
  return next ok((select ready_at is not null and status = 'waitlist' from public.launch_zones where id = z),
    'ready, but not opened without auto_open');
  return next is((select count(*)::integer from public.email_outbox where kind = 'admin_zone_ready'
                  and payload ->> 'zone_id' = z::text and payload ->> 'admin_id' = adm::text), 1, 'the admin is told');
  perform public.auto_open_zones();
  return next is((select count(*)::integer from public.email_outbox where kind = 'admin_zone_ready'
                  and payload ->> 'zone_id' = z::text), 1, 'once');
  update public.launch_zones set auto_open = true where id = z;
  perform public.auto_open_zones();
  return next ok((select status = 'open' from public.launch_zones where id = z), 'opened by itself with auto_open');
  return next is(pg_temp.notified(v, 'zone_opened'), 1, 'and its members are told');
end $$;

----------------------------------------------------------------------------------------------
-- Clean-up
----------------------------------------------------------------------------------------------
create function pg_temp.test_cleanup() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); m uuid; stale uuid; old_admin uuid; sa uuid; done_member uuid; r jsonb;
begin
  m := pg_temp.visitor('member@test.local', pl);
  insert into public.push_outbox (user_id, type, dedupe_key, status, created_at) values
    (m, 'promenade_open', 'old', 'sent', now() - interval '31 days'),
    (m, 'promenade_open', 'new', 'sent', now() - interval '2 days');
  insert into public.banned_email_hashes (hash, expires_at) values ('\x01', now() - interval '1 day');
  r := public.cleanup_rows();
  return next is((r ->> 'push_outbox')::integer, 1, 'old handled pushes are removed');
  return next ok(exists (select 1 from public.push_outbox where dedupe_key = 'new'), 'recent ones stay');
  return next ok(not exists (select 1 from public.banned_email_hashes where hash = '\x01'), 'expired fingerprints go');

  stale := pg_temp.new_user('stale@test.local');
  old_admin := pg_temp.new_admin('old-admin@test.local');
  sa := pg_temp.new_super_admin();
  done_member := pg_temp.visitor('done@test.local', pl);
  perform pg_temp.as_owner();
  update auth.users set created_at = now() - interval '31 days' where id in (stale, old_admin, done_member);
  return next is((select array_agg(c.user_id) from public.cleanup_accounts_due() c
                  where c.user_id in (stale, old_admin, sa, done_member)), array[stale],
    'only accounts without a finished onboarding after 30 days, never an admin or the super admin');
  return next ok(not has_function_privilege('authenticated', 'public.cleanup_accounts_due(integer)', 'execute')
    and has_function_privilege('service_role', 'public.cleanup_accounts_due(integer)', 'execute'),
    'for the secret key only');
  return next ok(not has_function_privilege('service_role', 'public.cleanup_rows()', 'execute'), 'the jobs are the owner''s');
end $$;

create function pg_temp.test_photo_rotation() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); banned uuid; paused uuid; ph uuid; old_large text;
  new_large text := gen_random_uuid() || '.webp';
begin
  banned := pg_temp.bad('banned@test.local', pl);
  paused := pg_temp.bad('paused@test.local', pl);
  update public.profiles set banned_at = now() where id = banned;
  update public.profiles set is_paused = true where id = paused;
  update public.profiles set paused_at = now() - interval '31 days' where id = paused;
  return next is((select count(*)::integer from public.cleanup_photos_due() d
                  join public.photos p on p.id = d.photo_id where p.owner_id in (banned, paused)), 6,
    'the photos of a banned member and of a Fiche paused for 30 days get new names');
  select d.photo_id, d.public_path_large into ph, old_large
  from public.cleanup_photos_due() d join public.photos p on p.id = d.photo_id where p.owner_id = banned limit 1;
  return next ok(public.cleanup_photo_rotated(ph, old_large, new_large, replace(new_large, '.webp', '-s.webp')), 'renamed');
  return next ok(not exists (select 1 from public.cleanup_photos_due() d where d.photo_id = ph), 'once');
  return next ok(not public.cleanup_photo_rotated(ph, old_large, gen_random_uuid() || '.webp', gen_random_uuid() || '-s.webp'),
    'refused if the photo changed meanwhile');
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
