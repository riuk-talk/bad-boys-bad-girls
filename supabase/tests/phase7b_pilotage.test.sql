-- Phase 7b (pgTAP): le pilotage (SPEC §3, §15). Every test_* function runs in its own rolled-back
-- transaction (runtests), so nothing persists (no real quartier is ever opened). Helpers as in
-- phase7a_moderation.

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
-- Admins only, with the second factor
----------------------------------------------------------------------------------------------
create function pg_temp.test_admin_only() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); m uuid; adm uuid; q text;
begin
  m := pg_temp.visitor('member@test.local', pl);
  adm := pg_temp.new_admin('admin@test.local');
  foreach q in array array[
    'select * from public.admin_zones()',
    pg_temp.zone_sql(pl),
    'select public.admin_set_zone_status(1::smallint, ''open'')',
    'select public.admin_set_launch_mode(''open'')',
    'select public.admin_launch_mode()',
    'select * from public.admin_tribes()',
    'select public.admin_save_tribe(''test'', ''Test'', ''Test'', 1::smallint, true)',
    'select * from public.admin_keywords()',
    'select public.admin_save_keyword(''motclef'', ''fr'', ''scam'', true)',
    'select * from public.admin_questions()',
    'select public.admin_save_question(1::smallint, ''Libellé test'', ''Test label'', true, ''[]'')',
    'select public.admin_zone_health(1::smallint, current_date, current_date)'] loop
    return next is(pg_temp.as_admin(m, q), '42501 admin_only', 'a member is refused: ' || left(q, 45));
    return next is(pg_temp.as_admin(adm, q, 'aal1'), '42501 admin_only', 'an admin without the second factor is refused: ' || left(q, 45));
  end loop;
  return next ok(not has_function_privilege('anon', 'public.admin_zone_health(smallint, date, date)', 'execute'), 'nothing for anon');
  return next ok(not has_function_privilege('authenticated', 'private.zone_gauge(smallint)', 'execute'), 'the gauge helper is internal');
end $$;

----------------------------------------------------------------------------------------------
-- Quartiers: thresholds checked, members recomputed, opening tells the members
----------------------------------------------------------------------------------------------
create function pg_temp.test_zones() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); adm uuid; sa uuid; b uuid; v uuid; seed uuid; z smallint; g jsonb;
begin
  adm := pg_temp.new_admin('admin@test.local');
  sa := pg_temp.new_super_admin();
  b := pg_temp.bad('bad@test.local', pl);
  v := pg_temp.visitor('visitor@test.local', pl);
  seed := pg_temp.visitor('seed@test.local', pl);
  update public.profiles set is_seed = true where id = seed;
  return next is(pg_temp.as_admin(adm, pg_temp.zone_sql(pl, 'Bad Slug')), '22023 invalid_slug', 'slug checked');
  return next is(pg_temp.as_admin(adm, pg_temp.zone_sql(pl, 'test-zone', 40, 20, 'Mars/Olympus')), '22023 invalid_timezone',
    'time zone checked');
  return next is(pg_temp.as_admin(adm, pg_temp.zone_sql(pl, 'test-zone', 70, 40)), '22023 invalid_thresholds',
    'the two floors never exceed 100 %');
  z := pg_temp.new_zone(adm, pl);
  return next is((select zone_id from public.profiles where id = b), z, 'the members of the area join the new quartier');
  return next is(pg_temp.as_admin(adm, pg_temp.zone_sql(pl)), '23505 slug_taken', 'one slug per quartier');
  perform pg_temp.as_user(adm, 'aal2');
  g := (select q.gauge from public.admin_zones() q where q.zone_id = z);
  perform pg_temp.as_owner();
  return next is((g ->> 'bads')::integer, 1, 'the gauge counts the Bad');
  return next is((g ->> 'visitors_waiting')::integer, 1, 'and the Visitor with a permit, never a seed account');
  return next is((g ->> 'min_bad_girls')::integer, 1, 'floors from the thresholds (2 Bads, 40 % → 1)');

  return next is(pg_temp.as_admin(adm, format('select public.admin_set_zone_status(%s::smallint, ''open'')', z)), 'ok', 'opened');
  return next ok((select status = 'open' and opened_at is not null from public.launch_zones where id = z), 'the quartier is open');
  return next is(pg_temp.notified(v, 'zone_opened'), 1, 'its members are told');
  return next is(pg_temp.notified(seed, 'zone_opened'), 0, 'never a seed account');
  return next is((select count(*)::integer from public.email_outbox where user_id = b and kind = 'zone_opened'), 1,
    'an e-mail is queued');
  return next is(pg_temp.as_admin(adm, format('select public.admin_set_zone_status(%s::smallint, ''open'')', z)),
    '23514 same_status', 'once');
  return next is(pg_temp.as_admin(adm, format('select public.admin_set_zone_status(%s::smallint, ''waitlist'')', z)), 'ok',
    'back to the waiting list by hand');

  return next is(pg_temp.as_admin(adm, 'select public.admin_set_launch_mode(''open'')'), '42501 super_admin_only',
    'the global mode is the super admin''s');
  return next is(pg_temp.as_admin(sa, 'select public.admin_set_launch_mode(''open'')'), 'ok', 'the super admin can');
end $$;

----------------------------------------------------------------------------------------------
-- Signes distinctifs, keywords, questions
----------------------------------------------------------------------------------------------
create function pg_temp.test_referentials() returns setof text language plpgsql as $$
declare adm uuid; t smallint; k integer; opts jsonb;
begin
  adm := pg_temp.new_admin('admin@test.local');
  perform pg_temp.as_user(adm, 'aal2');
  t := public.admin_save_tribe('noctambule-test', 'Noctambule', 'Night owl', 50::smallint, true);
  perform public.admin_save_tribe('noctambule-test', 'Noctambule', 'Night owl', 50::smallint, false, t);
  perform pg_temp.as_owner();
  return next ok((select not is_active and label ->> 'en' = 'Night owl' from public.tribes where id = t), 'a Signe is saved, then deactivated');
  return next is(pg_temp.as_admin(adm, 'select public.admin_save_tribe(''x-test'', ''X'', ''X'', 1::smallint, true)'),
    '22023 invalid_label', 'labels checked');

  perform pg_temp.as_user(adm, 'aal2');
  k := public.admin_save_keyword('  ArnaqueTest ', 'fr', 'scam', true);
  perform pg_temp.as_owner();
  return next is((select term from public.moderation_keywords where id = k), 'arnaquetest', 'a keyword is stored trimmed and lower case');
  return next is(pg_temp.as_admin(adm, 'select public.admin_save_keyword(''arnaquetest'', ''fr'', ''scam'', true)'),
    '23505 keyword_taken', 'once per language');

  return next is(pg_temp.as_admin(adm, 'select public.admin_save_question(1::smallint, ''Libellé corrigé'', ''Fixed label'', false, ''[]'')'),
    '23514 core_question', 'a core question stays active');
  return next is(pg_temp.as_admin(adm, 'select public.admin_save_question(1::smallint, ''Libellé corrigé'', ''Fixed label'', true, ''[]'')'),
    '22023 invalid_options', 'every option keeps its wording');
  select jsonb_agg(jsonb_build_object('id', o.id, 'fr', (o.label ->> 'fr') || ' !', 'en', o.label ->> 'en') order by o.position)
    into opts from public.question_options o where o.question_id = 1;
  return next is(pg_temp.as_admin(adm, format('select public.admin_save_question(1::smallint, ''Libellé corrigé'', ''Fixed label'', true, %L)', opts)),
    'ok', 'wording corrected');
  return next ok((select label ->> 'fr' = 'Libellé corrigé' from public.questions where id = 1)
    and (select bool_and(label ->> 'fr' like '% !') from public.question_options where question_id = 1), 'question and options updated');
  return next is(pg_temp.as_admin(adm, format('select public.admin_save_question(11::smallint, ''Libellé corrigé'', ''Fixed label'', false, %L)',
    (select jsonb_agg(jsonb_build_object('id', o.id, 'fr', o.label ->> 'fr', 'en', o.label ->> 'en') order by o.position)
     from public.question_options o where o.question_id = 11))), 'ok', 'an extra question can be deactivated');
end $$;

----------------------------------------------------------------------------------------------
-- Tableau de santé
----------------------------------------------------------------------------------------------
create function pg_temp.test_health() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); adm uuid; b uuid; v uuid; seed uuid; z smallint; req uuid; h jsonb;
begin
  perform pg_temp.open();
  adm := pg_temp.new_admin('admin@test.local');
  b := pg_temp.bad('bad@test.local', pl);
  v := pg_temp.visitor('visitor@test.local', pl);
  seed := pg_temp.visitor('seed@test.local', pl);
  update public.profiles set is_seed = true where id = seed;
  z := pg_temp.new_zone(adm, pl);
  req := pg_temp.request(v, b);
  perform pg_temp.accept(b, req, 6, 7);
  perform pg_temp.request(seed, b);
  return next is(pg_temp.as_admin(adm, format('select public.admin_zone_health(%s::smallint, current_date, current_date - 1)', z)),
    '22023 invalid_period', 'period checked');
  perform pg_temp.as_user(adm, 'aal2');
  -- The period is in Paris days, as the page sends it (lib/pilotage.ts healthPeriod): the UTC
  -- date of the database is the day before between midnight in Paris and midnight UTC.
  h := public.admin_zone_health(z, (now() at time zone 'Europe/Paris')::date - 30,
    (now() at time zone 'Europe/Paris')::date);
  perform pg_temp.as_owner();
  return next is((h -> 'requests' ->> 'sent')::integer, 1, 'requests sent, seed accounts left out');
  return next is((h -> 'requests' ->> 'accepted')::integer, 1, 'acceptances');
  return next is((h -> 'requests' ->> 'decided')::integer, 1, 'decisions of the Bad');
  return next ok(h -> 'requests' ? 'accepted_right_bet' and h -> 'requests' ? 'accepted_wrong_bet',
    'acceptance by right and wrong bet (must stay neutral)');
  return next is((h -> 'members' -> 'complete' ->> 'dossiers')::integer, 1, 'Dossiers complets');
  return next is((h -> 'members' -> 'complete' ->> 'permits')::integer, 1, 'Permis complets, never a seed account');
  return next is((h -> 'members' -> 'by_role_gender' ->> 'bad:woman')::integer, 1, 'Bads and Visitors by gender');
  return next ok(h ? 'visits' and h ? 'cavales' and h ? 'promenade' and h ? 'retention' and h ? 'moderation' and h ? 'push'
    and h ? 'gauge', 'every indicator of SPEC §15 is there');
end $$;

----------------------------------------------------------------------------------------------
-- Days of activity
----------------------------------------------------------------------------------------------
create function pg_temp.test_activity_days() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); v uuid;
begin
  v := pg_temp.visitor('visitor@test.local', pl);
  update public.profiles set last_seen_at = null where id = v;
  perform pg_temp.as_user(v);
  perform public.touch_activity();
  perform public.touch_activity();
  return next is(pg_temp.err('select count(*) from public.activity_days'), '42501 permission denied for table activity_days',
    'members cannot read the days of activity');
  perform pg_temp.as_owner();
  return next is((select count(*)::integer from public.activity_days where user_id = v), 1, 'one row per day');
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
