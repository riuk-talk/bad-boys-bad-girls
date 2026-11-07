-- Phase 4a security tests (pgTAP): the Demande de parloir, the Fiche and the Permis seen by others,
-- the Découverte, the Promenade, the Courrier, blocks, reports, role change and the N° d'écrou.
-- Rule 14: no function returns the chosen charge, the true line, the Casier copy or the result of
-- the bet, to the Bad, to the Visitor or to a third party.
-- Every test_* function runs in its own rolled-back transaction (runtests), so nothing persists.
-- Run: `supabase test db`, or paste this file into the SQL editor / Supabase connector.

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

create function pg_temp.new_place(p_name text, p_lat double precision, p_lng double precision)
returns bigint language sql as $$
  insert into public.places (official_code, name, lat, lng)
  values ('T' || substr(md5(random()::text), 1, 8), p_name, p_lat, p_lng) returning id
$$;

-- A member whose onboarding is complete, seen today, account older than 24 h (database owner).
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

-- A Bad seen by Visitors: 3 validated poses and a Casier (true line = 2).
create function pg_temp.visible_bad(p_email text, p_place bigint, p_gender public.gender default 'woman')
returns uuid language plpgsql as $$
declare b uuid := pg_temp.new_member(p_email, p_gender, p_place, 'bad');
begin
  perform pg_temp.approve_photo(b, 0);
  perform pg_temp.approve_photo(b, 1);
  perform pg_temp.approve_photo(b, 2);
  insert into public.casier_charges (profile_id, charge_1, charge_2, charge_3, true_index)
  values (b, 'Chef UN a traversé la Manche en kayak', 'Chef DEUX a dormi dans un phare breton',
    'Chef TROIS a volé une cloche de vache', 2);
  return b;
end $$;

-- A Visitor with the Permis de visite delivered (face validated).
create function pg_temp.permit_visitor(p_email text, p_place bigint, p_gender public.gender default 'man')
returns uuid language plpgsql as $$
declare v uuid := pg_temp.new_member(p_email, p_gender, p_place, 'visitor');
begin
  perform pg_temp.approve_photo(v, 0);
  return v;
end $$;

-- The whole country open (launch_mode = 'open'), so that zones do not hide anyone.
create function pg_temp.open_launch() returns void language sql as $$
  update public.app_settings set launch_mode = 'open' where id
$$;

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
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

-- Runs a statement as the current role; returns null on success, else "SQLSTATE message".
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- Runs a query returning one value as the current role.
create function pg_temp.val(p_sql text) returns text language plpgsql as $$
declare result text;
begin
  execute p_sql into result;
  return result;
end $$;

-- Everything a member function returns, as one JSON text (errors included, as text).
create function pg_temp.output(p_call text) returns text language plpgsql as $$
declare result text;
begin
  if p_call ~ '^public\.get_(fiche|permit)\(' then
    execute 'select (' || p_call || ')::text' into result;
  else
    execute 'select coalesce(jsonb_agg(to_jsonb(x)), ''[]'')::text from ' || p_call || ' x' into result;
  end if;
  return result;
exception when others then
  return 'error ' || sqlstate || ' ' || sqlerrm;
end $$;

-- Sends a Demande de parloir as p_visitor; returns the request id.
create function pg_temp.request(p_visitor uuid, p_bad uuid, p_guess integer, p_note text default null)
returns uuid language plpgsql as $$
declare r uuid;
begin
  perform pg_temp.as_user(p_visitor);
  r := public.send_visit_request(p_bad, p_guess::smallint, p_note);
  perform pg_temp.as_owner();
  return r;
end $$;

----------------------------------------------------------------------------------------------
-- Rule 14: nothing about the bet leaks, to the Bad, the Visitor or a third party
----------------------------------------------------------------------------------------------
create function pg_temp.test_rule14_no_leak() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place('Ville test', 47.5, 3.5);
  b uuid; v uuid; t uuid; x uuid; req uuid;
  viewer uuid; call text; out text; calls text[]; who text; expected jsonb;
  -- Calls that must return data (so that the checks below are not run on empty answers).
  served text[] := array['bad:get_fiche', 'bad:get_permit', 'bad:get_mailbox',
    'visitor:get_fiche', 'visitor:get_permit', 'visitor:get_my_requests', 'visitor:discover_bads',
    'visitor:get_my_promenade', 'third_visitor:get_fiche', 'third_visitor:discover_bads',
    'third_visitor:get_my_promenade'];
  forbidden text := '(true_index|guessed_index|casier_snapshot|guess_correct|guess|chosen|snapshot)';
begin
  perform pg_temp.open_launch();
  b := pg_temp.visible_bad('b@test.local', ville);
  x := pg_temp.visible_bad('x@test.local', ville);
  v := pg_temp.permit_visitor('v@test.local', ville);
  t := pg_temp.permit_visitor('t@test.local', ville);
  -- The Visitor bets on the true line (2): the result is « correct » in the database only.
  req := pg_temp.request(v, b, 2, 'Bonjour, je parie sur le phare.');
  return next is((select guess_correct from public.visit_requests where id = req), true,
    'the bet and its result are stored (database owner only)');
  -- Promenade for the Visitor and the third party, visible now.
  insert into public.promenade_picks (visitor_id, bad_id, promenade_date, rank, score, visible_from, visible_until)
  values (v, b, current_date, 1, 50, now() - interval '1 hour', now() + interval '1 hour'),
         (t, b, current_date, 1, 50, now() - interval '1 hour', now() + interval '1 hour');

  foreach who in array array['bad', 'visitor', 'third_visitor', 'third_bad'] loop
    viewer := case who when 'bad' then b when 'visitor' then v when 'third_visitor' then t else x end;
    calls := array[
      format('public.get_fiche(%L)', b), format('public.get_permit(%L)', v), 'public.get_mailbox()',
      'public.get_my_requests()', 'public.discover_bads()', 'public.get_my_promenade()'];
    perform pg_temp.as_user(viewer);
    foreach call in array calls loop
      out := pg_temp.output(call);
      if who || ':' || substring(call from 'public\.(\w+)\(') = any (served) then
        return next ok(out !~ '^error' and out <> '[]', format('%s → %s: answers (not an empty check)', who, call));
      end if;
      return next ok(out !~* forbidden, format('%s → %s: no key about the bet', who, call));
      -- The charges appear only on the Fiche (all three, in the Bad's order): never in a list.
      if call !~ 'get_fiche' then
        return next ok(out !~ 'Chef (UN|DEUX|TROIS)', format('%s → %s: no charge text', who, call));
      end if;
    end loop;
    perform pg_temp.as_owner();
  end loop;

  -- The Fiche gives the three charges in the same order to everyone, never marked.
  expected := (select jsonb_build_array(charge_1, charge_2, charge_3) from public.casier_charges where profile_id = b);
  perform pg_temp.as_user(v);
  return next is(public.get_fiche(b) -> 'charges', '["Chef UN a traversé la Manche en kayak", "Chef DEUX a dormi dans un phare breton", "Chef TROIS a volé une cloche de vache"]'::jsonb,
    'the Visitor who bet sees the three charges, unmarked');
  perform pg_temp.as_user(t);
  return next is(public.get_fiche(b) -> 'charges', expected, 'a third Visitor sees exactly the same');
  perform pg_temp.as_user(b);
  return next is(public.get_fiche(b) -> 'charges', expected, 'the Bad too (the true line is never flagged here)');
  perform pg_temp.as_owner();
end $$;

-- Whitelists: the exact keys of the Fiche and the Permis, the exact columns of the lists.
create function pg_temp.test_rule14_shapes() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place('Ville test', 47.5, 3.5);
  b uuid; v uuid;
begin
  perform pg_temp.open_launch();
  b := pg_temp.visible_bad('b@test.local', ville);
  v := pg_temp.permit_visitor('v@test.local', ville);
  perform pg_temp.request(v, b, 1);
  perform pg_temp.as_user(v);
  return next is((select array_agg(k order by k) from jsonb_object_keys(public.get_fiche(b)) k),
    array['age', 'bio', 'casier_changed_since_request', 'charges', 'city', 'common_points', 'complicity',
      'cooldown_until', 'distance_km', 'ecrou', 'gender', 'good_conduct', 'id', 'my_request_status',
      'on_file_since', 'photos', 'pseudo', 'recruited', 'requests_open', 'seek_age_max', 'seek_age_min',
      'seeking_genders', 'tribes'], 'get_fiche: exactly these keys');
  perform pg_temp.as_user(b);
  return next is((select array_agg(k order by k) from jsonb_object_keys(public.get_permit(v)) k),
    array['age', 'city', 'clean_record', 'common_points', 'complicity', 'distance_km', 'gender', 'id',
      'motive', 'photo', 'pseudo', 'tribes', 'visits_due', 'visits_honored'], 'get_permit: exactly these keys');
  perform pg_temp.as_owner();
  return next is((select array_to_string(proargnames, ',')
    from pg_proc where oid = 'public.get_mailbox()'::regprocedure),
    'request_id,status,created_at,visitor_id,pseudo,gender,age,city,distance_km,photo_small,motive,clean_record,visits_honored,visits_due,complicity,note',
    'get_mailbox: exactly these columns');
  return next is((select array_to_string(proargnames, ',') from pg_proc where oid = 'public.get_my_requests()'::regprocedure),
    'request_id,status,created_at,decided_at,bad_id,pseudo,gender,photo_small,cooldown_until',
    'get_my_requests: exactly these columns');
  return next is((select array_to_string(proargnames, ',') from pg_proc where oid = 'public.get_my_promenade()'::regprocedure),
    'rank,id,pseudo,gender,age,city,distance_km,photo_small,good_conduct,requests_open,complicity,seen,visible_until',
    'get_my_promenade: exactly these columns');
  return next is((select array_to_string(proargnames[10:], ',') from pg_proc
      where oid = 'public.discover_bads(integer, integer, integer, smallint[], boolean, boolean, bigint, uuid, integer)'::regprocedure),
    'id,pseudo,gender,age,city,distance_km,photo_small,good_conduct,requests_open,complicity,sort_key',
    'discover_bads: exactly these columns');
  -- No function a member or a visitor of the site may call has an output named after the bet
  -- (the bet itself is an input of send_visit_request only).
  return next is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join lateral unnest(coalesce(p.proargnames, '{}'),
        coalesce(p.proargmodes, array_fill('i'::"char", array[coalesce(cardinality(p.proargnames), 0)]))) a(name, mode)
      where n.nspname = 'public' and a.mode in ('o', 't', 'b')
        and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
        and a.name ~* '(true_index|guess|snapshot|charge)'), 0,
    'no callable function has an output named after the bet or the charges');
  return next is((select string_agg(p.proname::text, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
        and exists (select 1 from unnest(p.proargnames) a where a ~* 'guess')), 'send_visit_request',
    'the bet is only ever an input, of send_visit_request');
  return next is(pg_get_function_result('public.send_visit_request(uuid, smallint, text)'::regprocedure), 'uuid',
    'sending a request returns its id only (not the result of the bet)');
end $$;

-- The tables themselves stay closed (no policy, no grant).
create function pg_temp.test_tables_closed() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place('Ville test', 47.5, 3.5);
  b uuid; v uuid; member uuid;
begin
  perform pg_temp.open_launch();
  b := pg_temp.visible_bad('b@test.local', ville);
  v := pg_temp.permit_visitor('v@test.local', ville);
  perform pg_temp.request(v, b, 3);
  foreach member in array array[b, v] loop
    perform pg_temp.as_user(member);
    return next matches(coalesce(pg_temp.try('select * from public.visit_requests'), 'ok'), '^42501',
      'visit_requests cannot be read by the Bad nor the Visitor');
    return next matches(coalesce(pg_temp.try('select * from public.promenade_picks'), 'ok'), '^42501',
      'promenade_picks cannot be read');
    return next matches(coalesce(pg_temp.try('select * from public.reports'), 'ok'), '^42501', 'reports cannot be read');
    return next matches(coalesce(pg_temp.try('select * from public.moderation_actions'), 'ok'), '^42501',
      'moderation_actions cannot be read');
    return next matches(coalesce(pg_temp.try(format(
      'insert into public.visit_requests (visitor_id, bad_id, guessed_index, casier_snapshot, guess_correct) values (%L, %L, 1, ''{}'', true)', v, b)), 'ok'),
      '^42501', 'nor written directly');
    perform pg_temp.as_owner();
  end loop;
  perform pg_temp.as_anon();
  return next matches(coalesce(pg_temp.try(format('select public.get_fiche(%L)', b)), 'ok'), '^42501',
    'anon cannot call get_fiche');
  return next matches(coalesce(pg_temp.try('select * from public.discover_bads()'), 'ok'), '^42501',
    'anon cannot call discover_bads');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
-- N° d'écrou: 6 random digits, unique, Bads only, chosen by nobody, found by nothing
----------------------------------------------------------------------------------------------
create function pg_temp.test_ecrou() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place('Ville test', 47.5, 3.5);
  b uuid; v uuid; other uuid; e text; i integer;
begin
  perform pg_temp.open_launch();
  b := pg_temp.visible_bad('b@test.local', ville);
  v := pg_temp.permit_visitor('v@test.local', ville);
  e := (select ecrou from public.profiles where id = b);
  return next matches(e, '^[0-9]{6}$', 'a Bad gets a N° d''écrou of 6 digits');
  return next is((select ecrou from public.profiles where id = v), null, 'a Visitor has none');
  for i in 1..60 loop
    perform pg_temp.new_member('bulk' || i || '@test.local', 'woman', ville, 'bad');
  end loop;
  return next is((select count(distinct ecrou) from public.profiles where ecrou is not null),
    (select count(*) from public.profiles where ecrou is not null), 'every N° d''écrou is unique');
  -- Nobody chooses it: not the member (no column right), not even an update by the owner.
  perform pg_temp.as_user(b);
  return next matches(coalesce(pg_temp.try(format('update public.profiles set ecrou = ''000001'' where id = %L', b)), 'ok'),
    '^42501', 'a member cannot write their N° d''écrou');
  perform pg_temp.as_user(v);
  return next matches(coalesce(pg_temp.try(format('update public.profiles set ecrou = %L where id = %L', e, v)), 'ok'),
    '^42501', 'a Visitor cannot give themself one');
  -- No lookup: a member cannot read another profile, so the number finds no account.
  return next is(pg_temp.val(format('select count(*) from public.profiles where ecrou = %L', e)), '0',
    'searching profiles by N° d''écrou finds nothing');
  perform pg_temp.as_owner();
  update public.profiles set ecrou = '000001' where id = b;
  return next is((select ecrou from public.profiles where id = b)::text, e, 'it never changes once given');
  insert into public.profiles (id, pseudo, birthdate, gender, seeking_genders, role, ecrou)
    values (pg_temp.new_user('forced@test.local'), 'forced_ecrou', date '1990-01-01', 'woman', '{man}', 'visitor', '123456');
  return next is((select ecrou from public.profiles where pseudo = 'forced_ecrou'), null,
    'a value given at creation is ignored (Visitor: none)');
  -- No function takes it as an input; only these four mention it.
  return next is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and exists (select 1 from unnest(p.proargnames) a where a ~* 'ecrou')
        and p.proname <> 'new_ecrou'), 0, 'no function has a parameter or output named ecrou');
  return next is((select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosrc ~* 'ecrou'),
    array['admin_search_members', 'admin_view_fiche', 'get_fiche', 'new_ecrou', 'profiles_before_write'],
    'only get_fiche and the Greffe view (10a) show it; only the admin search (10c, owner''s request) searches by it, without returning it');
end $$;

----------------------------------------------------------------------------------------------
-- La Demande de parloir: every limit is in SQL
----------------------------------------------------------------------------------------------
create function pg_temp.test_request_limits() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place('Ville test', 47.5, 3.5);
  b uuid; b2 uuid; v uuid; fresh uuid; nopermit uuid; bads uuid[] := '{}'; i integer; req uuid;
begin
  perform pg_temp.open_launch();
  b := pg_temp.visible_bad('b@test.local', ville);
  b2 := pg_temp.visible_bad('b2@test.local', ville);
  v := pg_temp.permit_visitor('v@test.local', ville);
  nopermit := pg_temp.new_member('np@test.local', 'man', ville, 'visitor');
  for i in 1..6 loop bads := bads || pg_temp.visible_bad('lot' || i || '@test.local', ville); end loop;

  perform pg_temp.as_user(b2);
  return next matches(coalesce(pg_temp.try(format('select public.send_visit_request(%L, 1::smallint)', b)), 'ok'),
    '^42501 visitors_only', 'a Bad cannot send a Demande de parloir');
  perform pg_temp.as_user(nopermit);
  return next matches(coalesce(pg_temp.try(format('select public.send_visit_request(%L, 1::smallint)', b)), 'ok'),
    '^42501 permit_pending', 'a Visitor without a delivered Permis cannot either');
  perform pg_temp.as_user(v);
  return next matches(coalesce(pg_temp.try(format('select public.send_visit_request(%L, 4::smallint)', b)), 'ok'),
    '^22023 invalid_guess', 'the bet is 1, 2 or 3');
  return next matches(coalesce(pg_temp.try(format('select public.send_visit_request(%L, 1::smallint)', v)), 'ok'),
    '^P0002 not_found', 'a Visitor cannot send a request to a Visitor');
  perform pg_temp.as_owner();

  -- 5 per 24 h, the 6th is refused.
  for i in 1..5 loop perform pg_temp.request(v, bads[i], 1); end loop;
  perform pg_temp.as_user(v);
  return next matches(coalesce(pg_temp.try(format('select public.send_visit_request(%L, 1::smallint)', bads[6])), 'ok'),
    '^23514 daily_limit', 'the 6th request within 24 h is refused');
  return next matches(coalesce(pg_temp.try(format('select public.send_visit_request(%L, 1::smallint)', bads[1])), 'ok'),
    '^23514 daily_limit|^23505 already_requested', 'and a second request to the same Bad too');
  perform pg_temp.as_owner();

  -- An account younger than 24 h: 2 requests only.
  fresh := pg_temp.permit_visitor('fresh@test.local', ville);
  update public.profiles set created_at = now() where id = fresh;
  perform pg_temp.request(fresh, bads[1], 1);
  perform pg_temp.request(fresh, bads[2], 1);
  perform pg_temp.as_user(fresh);
  return next matches(coalesce(pg_temp.try(format('select public.send_visit_request(%L, 1::smallint)', bads[3])), 'ok'),
    '^23514 daily_limit', 'a new account (< 24 h) is limited to 2 requests');
  perform pg_temp.as_owner();

  -- One request in progress per pair.
  fresh := pg_temp.permit_visitor('pair@test.local', ville);
  req := pg_temp.request(fresh, b, 1);
  perform pg_temp.as_user(fresh);
  return next matches(coalesce(pg_temp.try(format('select public.send_visit_request(%L, 2::smallint)', b)), 'ok'),
    '^23505 already_requested', 'one request in progress per pair');
  -- Only the Bad decides; the Visitor or another Bad cannot.
  return next matches(coalesce(pg_temp.try(format('select public.decide_visit_request(%L, true)', req)), 'ok'),
    '^P0002 not_found', 'the Visitor cannot accept their own request');
  perform pg_temp.as_user(b2);
  return next matches(coalesce(pg_temp.try(format('select public.decide_visit_request(%L, true)', req)), 'ok'),
    '^P0002 not_found', 'another Bad cannot decide it');
  -- Affaire classée → 30 days before a new request, and the Visitor's dismissals are counted.
  perform pg_temp.as_user(b);
  return next is(pg_temp.try(format('select public.decide_visit_request(%L, false)', req)), null, 'the Bad classes the case');
  return next matches(coalesce(pg_temp.try(format('select public.decide_visit_request(%L, true)', req)), 'ok'),
    '^23514 not_pending', 'a decision is final');
  perform pg_temp.as_user(fresh);
  return next matches(coalesce(pg_temp.try(format('select public.send_visit_request(%L, 2::smallint)', b)), 'ok'),
    '^23514 cooldown', '30 days before writing to the same Bad again');
  return next ok((select (x ->> 'cooldown_until')::timestamptz > now() + interval '29 days'
    from public.get_my_requests() r, to_jsonb(r) x limit 1), 'Mes demandes shows the date it ends');
  perform pg_temp.as_owner();
  return next is((select consecutive_dismissals from public.profiles where id = fresh), 1::smallint,
    'the Visitor''s consecutive dismissals are counted (advice after 3)');
  return next is((select count(*)::integer from public.notifications where user_id = fresh and type = 'request_dismissed'), 1,
    'the Visitor is told in-app with the neutral message');
  return next is((select count(*)::integer from public.notifications where user_id = b and type = 'request_received'), 1,
    'the Bad was told in-app when the request arrived');
end $$;

-- « Parloir complet »: at the cap, no more requests; accepting frees nothing (still in progress).
create function pg_temp.test_parloir_complet() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place('Ville test', 47.5, 3.5);
  b uuid; v uuid; i integer; first_req uuid;
begin
  perform pg_temp.open_launch();
  b := pg_temp.visible_bad('b@test.local', ville);
  update public.profiles set requests_cap = 5 where id = b;
  for i in 1..5 loop
    v := pg_temp.permit_visitor('v' || i || '@test.local', ville);
    if i = 1 then first_req := pg_temp.request(v, b, 1); else perform pg_temp.request(v, b, 1); end if;
  end loop;
  return next is((select pending_requests_count::integer from public.profiles where id = b), 5, '5 requests pending');
  v := pg_temp.permit_visitor('v6@test.local', ville);
  perform pg_temp.as_user(v);
  return next is((public.get_fiche(b) ->> 'requests_open')::boolean, false, 'the Fiche shows « Parloir complet »');
  return next matches(coalesce(pg_temp.try(format('select public.send_visit_request(%L, 1::smallint)', b)), 'ok'),
    '^23514 parloir_full', 'the 6th Visitor cannot send a request');
  perform pg_temp.as_user(b);
  -- Phase 5b: accepting means proposing 2 or 3 Heures de visite.
  perform public.accept_visit_request(first_req,
    array[date_trunc('hour', now()) + interval '3 hours', date_trunc('hour', now()) + interval '5 hours']);
  return next is((select status::text from public.get_mailbox() where request_id = first_req), 'accepted',
    'an accepted request stays « accepted » in the Courrier');
  perform pg_temp.as_user(v);
  return next is(pg_temp.try(format('select public.send_visit_request(%L, 1::smallint)', b)), null,
    'an answered request frees a place');
  perform pg_temp.as_owner();
  update public.profiles set requests_closed_manual = true where id = b;
  v := pg_temp.permit_visitor('v7@test.local', ville);
  perform pg_temp.as_user(v);
  return next matches(coalesce(pg_temp.try(format('select public.send_visit_request(%L, 1::smallint)', b)), 'ok'),
    '^23514 parloir_full', 'a Bad can close the Parloir by hand');
  perform pg_temp.as_owner();
end $$;

-- Anti-scam: the same note for the 3rd time within 7 days is flagged; contacts are masked.
create function pg_temp.test_note_anti_scam() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place('Ville test', 47.5, 3.5);
  v uuid; i integer; req uuid;
begin
  perform pg_temp.open_launch();
  v := pg_temp.permit_visitor('v@test.local', ville);
  for i in 1..3 loop
    req := pg_temp.request(v, pg_temp.visible_bad('b' || i || '@test.local', ville), 1,
      'Salut, ta fiche me plaît beaucoup, on se voit au parloir ce soir ' || repeat('!', i));
  end loop;
  return next is((select count(*)::integer from public.flagged_texts where user_id = v and 'repeated_note' = any (matched_terms)), 1,
    'the 3rd identical note is flagged for moderation');
  req := pg_temp.request(v, pg_temp.visible_bad('b9@test.local', ville), 1, 'Appelle-moi au 06 12 34 56 78');
  return next ok((select note from public.visit_requests where id = req) !~ '06 12 34 56 78', 'a phone number in the note is masked');
end $$;

----------------------------------------------------------------------------------------------
-- Who sees whom: Visitors never see Visitors, Bads never see Bads, blocks hide everywhere
----------------------------------------------------------------------------------------------
create function pg_temp.test_visibility() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place('Ville test', 47.5, 3.5);
  b uuid; b2 uuid; v uuid; v2 uuid; picky uuid; hidden uuid; paused uuid;
begin
  perform pg_temp.open_launch();
  b := pg_temp.visible_bad('b@test.local', ville);
  b2 := pg_temp.visible_bad('b2@test.local', ville);
  v := pg_temp.permit_visitor('v@test.local', ville);
  v2 := pg_temp.permit_visitor('v2@test.local', ville);
  picky := pg_temp.visible_bad('picky@test.local', ville);
  update public.profiles set seeking_genders = '{woman}' where id = picky;
  hidden := pg_temp.new_member('hidden@test.local', 'woman', ville, 'bad');
  paused := pg_temp.visible_bad('paused@test.local', ville);
  update public.profiles set is_paused = true where id = paused;

  perform pg_temp.as_user(v);
  return next ok(exists (select 1 from public.discover_bads() d where d.id = b), 'a Visitor discovers a visible Bad');
  return next ok(not exists (select 1 from public.discover_bads() d where d.id in (v, v2)), 'never a Visitor');
  return next ok(not exists (select 1 from public.discover_bads() d where d.id = picky), 'not a Bad whose criteria exclude them');
  return next ok(not exists (select 1 from public.discover_bads() d where d.id = hidden), 'not a Bad without poses nor Casier');
  return next ok(not exists (select 1 from public.discover_bads() d where d.id = paused), 'not a Bad on pause');
  return next matches(coalesce(pg_temp.try(format('select public.get_fiche(%L)', v2)), 'ok'), '^P0002 not_found',
    'a Visitor cannot open another Visitor''s file');
  return next matches(coalesce(pg_temp.try(format('select public.get_permit(%L)', v2)), 'ok'), '^P0002 not_found',
    'nor their Permis');
  return next matches(coalesce(pg_temp.try(format('select public.get_fiche(%L)', picky)), 'ok'), '^P0002 not_found',
    'nor the Fiche of a Bad whose criteria exclude them');
  perform pg_temp.as_user(b);
  return next matches(coalesce(pg_temp.try('select * from public.discover_bads()'), 'ok'), '^42501 visitors_only',
    'a Bad has no Découverte');
  return next matches(coalesce(pg_temp.try('select * from public.get_my_promenade()'), 'ok'), '^42501 visitors_only',
    'nor a Promenade');
  return next matches(coalesce(pg_temp.try(format('select public.get_fiche(%L)', b2)), 'ok'), '^P0002 not_found',
    'a Bad cannot open another Bad''s Fiche');
  return next matches(coalesce(pg_temp.try(format('select public.get_permit(%L)', v)), 'ok'), '^P0002 not_found',
    'nor the Permis of a Visitor who did not write to them');
  perform pg_temp.as_user(v);
  return next matches(coalesce(pg_temp.try('select * from public.get_mailbox()'), 'ok'), '^42501 bads_only',
    'a Visitor has no Courrier');
  perform pg_temp.as_owner();
end $$;

create function pg_temp.test_blocks() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place('Ville test', 47.5, 3.5);
  b uuid; v uuid; req uuid;
begin
  perform pg_temp.open_launch();
  b := pg_temp.visible_bad('b@test.local', ville);
  v := pg_temp.permit_visitor('v@test.local', ville);
  req := pg_temp.request(v, b, 1);
  insert into public.promenade_picks (visitor_id, bad_id, promenade_date, rank, score, visible_from, visible_until)
  values (v, b, current_date, 1, 50, now() - interval '1 hour', now() + interval '1 hour');
  -- The Bad blocks the Visitor.
  perform pg_temp.as_user(b);
  return next is(pg_temp.try(format('select public.block_user(%L)', v)), null, 'the Bad blocks the Visitor');
  return next is((select count(*)::integer from public.get_mailbox()), 0, 'the request leaves the Courrier');
  return next matches(coalesce(pg_temp.try(format('select public.get_permit(%L)', v)), 'ok'), '^P0002', 'the Permis is hidden');
  return next is(pg_temp.val('select count(*) from public.blocks'), '1', 'the Bad sees their own block list');
  perform pg_temp.as_user(v);
  return next is(pg_temp.val('select count(*) from public.blocks'), '0', 'the blocked member does not see it');
  return next ok(not exists (select 1 from public.discover_bads() d where d.id = b), 'the Bad leaves the Découverte');
  return next is((select count(*)::integer from public.get_my_promenade()), 0, 'and the Promenade');
  return next is((select count(*)::integer from public.get_my_requests()), 0, 'and Mes demandes');
  return next matches(coalesce(pg_temp.try(format('select public.get_fiche(%L)', b)), 'ok'), '^P0002', 'the Fiche is hidden');
  return next matches(coalesce(pg_temp.try(format('select public.send_visit_request(%L, 1::smallint)', b)), 'ok'),
    '^P0002 not_found', 'no new request');
  perform pg_temp.as_owner();
  return next is((select status::text from public.visit_requests where id = req), 'cancelled', 'the request in progress is closed');
  -- Unblocking keeps the history (no row removed).
  perform pg_temp.as_user(b);
  perform public.unblock_user(v);
  perform pg_temp.as_owner();
  return next ok((select unblocked_at is not null from public.blocks where blocker_id = b and blocked_id = v),
    'unblocking is recorded, the row stays');
  perform pg_temp.as_user(v);
  return next ok(exists (select 1 from public.discover_bads() d where d.id = b), 'after unblocking, the Bad is visible again');
  return next matches(coalesce(pg_temp.try(format('select public.block_user(%L)', v)), 'ok'), '^22023', 'nobody blocks themself');
  perform pg_temp.as_owner();
end $$;

-- Ma Fiche lists my own blocks only; opening a screen marks read only my notifications of its types.
create function pg_temp.test_my_blocks_and_notifications() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place('Ville test', 47.5, 3.5);
  b uuid; v uuid; v2 uuid; v_pseudo text;
begin
  perform pg_temp.open_launch();
  b := pg_temp.visible_bad('b@test.local', ville);
  v := pg_temp.permit_visitor('v@test.local', ville);
  v2 := pg_temp.permit_visitor('v2@test.local', ville);
  v_pseudo := (select pseudo from public.profiles where id = v);
  perform pg_temp.as_user(b);
  perform public.block_user(v);
  perform pg_temp.as_user(v2);
  perform public.block_user(b);
  perform pg_temp.as_user(b);
  return next is((select array_agg(blocked_id) from public.get_my_blocks()), array[v],
    'get_my_blocks: my blocks only (not the ones against me)');
  return next is((select pseudo from public.get_my_blocks()), v_pseudo, 'with the pseudo, to unblock from Ma Fiche');
  perform public.unblock_user(v);
  return next is((select count(*)::integer from public.get_my_blocks()), 0, 'an unblocked member leaves the list');
  perform pg_temp.as_anon();
  return next matches(coalesce(pg_temp.try('select * from public.get_my_blocks()'), 'ok'), '^42501', 'anon cannot call it');

  perform pg_temp.as_owner();
  perform public.notify(b, 'request_received');
  perform public.notify(b, 'moderation_decision');
  perform public.notify(v, 'request_received');
  perform pg_temp.as_user(b);
  perform public.mark_notifications_read(array['request_received']::public.notification_type[]);
  perform pg_temp.as_owner();
  return next is((select read_at is not null from public.notifications where user_id = b and type = 'request_received'), true,
    'mark_notifications_read: the types given are read');
  return next is((select read_at from public.notifications where user_id = b and type = 'moderation_decision'), null,
    'the other types stay unread (the Greffe''s notices)');
  return next is((select read_at from public.notifications where user_id = v and type = 'request_received'), null,
    'and another member''s are untouched');
  perform pg_temp.as_anon();
  return next matches(coalesce(pg_temp.try('select public.mark_notifications_read(array[''request_received'']::public.notification_type[])'), 'ok'),
    '^42501', 'anon cannot call it');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
-- Role change, report
----------------------------------------------------------------------------------------------
create function pg_temp.test_change_role() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place('Ville test', 47.5, 3.5);
  b uuid; v uuid; req uuid; e text;
begin
  perform pg_temp.open_launch();
  b := pg_temp.visible_bad('b@test.local', ville);
  v := pg_temp.permit_visitor('v@test.local', ville);
  req := pg_temp.request(v, b, 2);
  e := (select ecrou from public.profiles where id = b);
  perform pg_temp.as_user(b);
  return next matches(coalesce(pg_temp.try(format('update public.profiles set role = ''visitor'' where id = %L', b)), 'ok'),
    '^42501', 'the role cannot be written directly');
  return next matches(coalesce(pg_temp.try('select public.change_role(''visitor'')'), 'ok'), '^23514 visit_motive_required',
    'a Bad becoming a Visitor needs a Motif de visite');
  perform pg_temp.as_owner();
  update public.profiles set visit_motive = 'Je viens voir' where id = b;
  perform pg_temp.as_user(b);
  return next is(pg_temp.try('select public.change_role(''visitor'')'), null, 'the Bad becomes a Visitor');
  return next matches(coalesce(pg_temp.try('select public.change_role(''bad'')'), 'ok'), '^23514 role_change_too_soon',
    'one change per 7 days');
  perform pg_temp.as_owner();
  return next is((select status::text || '/' || close_reason::text from public.visit_requests where id = req), 'dismissed/role_change',
    'the requests received are closed');
  return next is((select consecutive_dismissals::integer from public.profiles where id = v), 0,
    'a role change is not a refusal: the Visitor''s dismissals are not counted');
  return next is((select ecrou from public.profiles where id = b)::text, e, 'the N° d''écrou is kept');
  perform pg_temp.as_user(v);
  return next matches(coalesce(pg_temp.try(format('select public.get_fiche(%L)', b)), 'ok'), '^P0002',
    'the former Bad''s Fiche (and N° d''écrou) is no longer shown');
  perform pg_temp.as_owner();
  update public.profiles set role_changed_at = now() - interval '8 days' where id = b;
  perform pg_temp.as_user(b);
  return next is(pg_temp.try('select public.change_role(''bad'')'), null, 'after 7 days, back to Bad');
  perform pg_temp.as_owner();
  return next is((select ecrou from public.profiles where id = b)::text, e, 'with the same N° d''écrou');
end $$;

create function pg_temp.test_report() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place('Ville test', 47.5, 3.5);
  b uuid; hidden_bad uuid; v uuid; v2 uuid; other uuid; fresh uuid; nophoto uuid; unfinished uuid; reglo uuid;
  req uuid;
begin
  perform pg_temp.open_launch();
  b := pg_temp.visible_bad('b@test.local', ville);
  hidden_bad := pg_temp.visible_bad('hb@test.local', ville);
  update public.profiles set is_paused = true where id = hidden_bad;
  v := pg_temp.permit_visitor('v@test.local', ville);
  v2 := pg_temp.permit_visitor('v2@test.local', ville);
  other := pg_temp.permit_visitor('o@test.local', ville);
  req := pg_temp.request(v, b, 1);
  perform pg_temp.as_user(v);
  return next matches(coalesce(pg_temp.try(format('select public.report(''profile'', %L, ''fake_profile'')', v)), 'ok'),
    '^P0002', 'nobody reports themself');
  return next matches(coalesce(pg_temp.try(format('select public.report(''profile'', %L, ''fake_profile'')', v2)), 'ok'),
    '^P0002', 'a Visitor cannot report another Visitor they cannot see');
  return next matches(coalesce(pg_temp.try(format('select public.report(''profile'', %L, ''minor'')', hidden_bad)), 'ok'),
    '^P0002', 'nor a Bad who is hidden from them (paused), even knowing the id');
  perform pg_temp.as_user(other);
  return next matches(coalesce(pg_temp.try(format('select public.report(''visit_request'', %L, ''scam'')', req)), 'ok'),
    '^P0002', 'a third party cannot report a request that is not theirs');
  perform pg_temp.as_user(b);
  return next ok(pg_temp.try(format('select public.report(''visit_request'', %L, ''scam'', ''Note bizarre'')', req)) is null,
    'the Bad reports the request they received');
  return next ok(pg_temp.try(format('select public.report(''permit'', %L, ''fake_profile'')', v)) is null,
    'and the Permis of the Visitor who wrote to them');
  return next matches(coalesce(pg_temp.try(format('select public.report(''permit'', %L, ''fake_profile'')', v2)), 'ok'),
    '^P0002', 'but not the Permis of a Visitor who never wrote to them');
  -- Unfinished sign-up: no report at all.
  perform pg_temp.as_owner();
  unfinished := pg_temp.permit_visitor('u@test.local', ville);
  update public.profiles set onboarding_completed_at = null where id = unfinished;
  perform pg_temp.as_user(unfinished);
  return next matches(coalesce(pg_temp.try(format('select public.report(''profile'', %L, ''minor'')', b)), 'ok'),
    '^P0002', 'a member who has not finished the sign-up cannot report');
  -- A block opens the right to report the blocked member.
  perform pg_temp.as_user(other);
  perform public.block_user(v2);
  return next ok(pg_temp.try(format('select public.report(''profile'', %L, ''harassment'')', v2)) is null,
    'a member can report someone they blocked');
  perform pg_temp.as_owner();

  -- « Mineur »: two reporters who are not established do not hide anyone.
  fresh := pg_temp.permit_visitor('fresh@test.local', ville);
  update public.profiles set created_at = now() - interval '2 days' where id = fresh;
  nophoto := pg_temp.new_member('np@test.local', 'man', ville, 'visitor');
  foreach unfinished in array array[fresh, nophoto] loop
    perform pg_temp.as_user(unfinished);
    perform public.report('profile', b::text, 'minor');
    perform pg_temp.as_owner();
  end loop;
  return next is((select count(*)::integer from public.reports where target_user_id = b and category = 'minor'), 2,
    'their two reports are recorded');
  return next is((select hidden_reason from public.profiles where id = b), null,
    'but a new account (< 7 days) and an account without a validated photo do not hide the Bad');
  -- Two established reporters: hidden at once.
  perform pg_temp.as_user(v);
  perform public.report('profile', b::text, 'minor');
  perform pg_temp.as_owner();
  return next is((select hidden_reason from public.profiles where id = b), null, 'one established report is not enough');
  perform pg_temp.as_user(v2);
  perform public.report('profile', b::text, 'minor');
  perform pg_temp.as_owner();
  return next is((select hidden_reason from public.profiles where id = b), 'minor_report',
    'hidden after 2 distinct established reporters');
  perform pg_temp.as_user(other);
  return next ok(not exists (select 1 from public.discover_bads() d where d.id = b), 'and gone from the Découverte');
  perform pg_temp.as_owner();
  -- A Bad with Bonne conduite is enough alone.
  reglo := pg_temp.visible_bad('reglo@test.local', ville);
  update public.profiles set is_reglo = true where id = reglo;
  perform pg_temp.request(other, reglo, 1);
  perform pg_temp.as_user(reglo);
  perform public.report('permit', other::text, 'minor');
  perform pg_temp.as_owner();
  return next is((select hidden_reason from public.profiles where id = other), 'minor_report',
    'one report from a Bad with Bonne conduite hides at once');
end $$;

----------------------------------------------------------------------------------------------
-- La Promenade: 5 Bads per Visitor at most, attention shared out, never a request already sent
----------------------------------------------------------------------------------------------
create function pg_temp.test_promenade_build() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place('Ville test', 47.5, 3.5);
  z smallint; v uuid; blocked uuid; asked uuid; seed uuid; i integer; built integer; vis uuid[] := '{}';
begin
  insert into public.launch_zones (slug, name, center_place_id, radius_km, status, timezone)
    values ('test-promenade', 'Ville test', ville, 30, 'open', 'Europe/Paris') returning id into z;
  for i in 1..8 loop perform pg_temp.visible_bad('b' || i || '@test.local', ville); end loop;
  blocked := pg_temp.visible_bad('blocked@test.local', ville);
  asked := pg_temp.visible_bad('asked@test.local', ville);
  seed := pg_temp.visible_bad('seed@test.local', ville);
  update public.profiles set is_seed = true where id = seed;
  for i in 1..12 loop vis := vis || pg_temp.permit_visitor('v' || i || '@test.local', ville); end loop;
  v := vis[1];
  insert into public.blocks (blocker_id, blocked_id) values (blocked, v);
  perform pg_temp.request(v, asked, 1);
  update public.app_settings set promenade_max_appearances_per_day = 6 where id;

  perform pg_temp.as_user(v);
  return next matches(coalesce(pg_temp.try(format('select public.build_daily_promenade(%s::smallint, current_date)', z)), 'ok'),
    '^42501', 'a member cannot build the Promenade');
  perform pg_temp.as_owner();
  built := public.build_daily_promenade(z, current_date);
  return next ok(built > 0, 'the Promenade is built');
  return next is((select max(n)::integer from (select count(*) n from public.promenade_picks
    where promenade_date = current_date group by visitor_id) t), 5, 'at most 5 Bads per Visitor');
  return next ok((select max(n) from (select count(*) n from public.promenade_picks
    where promenade_date = current_date group by bad_id) t) <= 6, 'no Bad beyond the daily cap');
  return next ok(not exists (select 1 from public.promenade_picks where visitor_id = v and bad_id in (blocked, asked)),
    'never a blocked Bad nor one already asked');
  return next ok(not exists (select 1 from public.promenade_picks where bad_id = seed), 'never a test (seed) profile');
  return next ok(not exists (select 1 from public.promenade_picks pp join public.profiles p on p.id = pp.bad_id
    where p.role <> 'bad'), 'only Bads');
  return next ok(not exists (select 1 from public.promenade_picks where promenade_date = current_date
      group by visitor_id having max(rank) <> count(*)), 'ranks run from 1 without a gap');
  return next ok((select count(*) from public.promenade_picks where promenade_date = current_date) >= 40,
    'the attention is shared out: 8 Bads × 6 appearances serve most of the 12 Visitors');
  return next is((select min(visible_from) from public.promenade_picks where promenade_date = current_date),
    (current_date + time '21:00') at time zone 'Europe/Paris', 'shown from 21:00 local time');
  -- Built twice in the same transaction (several zones per job): the temporary table is reused.
  return next is(pg_temp.try(format('select public.build_daily_promenade(%s::smallint, current_date + 1)', z)), null,
    'a second build in the same transaction works');
  return next ok(not exists (select 1 from public.promenade_picks a join public.promenade_picks c
      on c.visitor_id = a.visitor_id and c.bad_id = a.bad_id and c.promenade_date = a.promenade_date + 1
    where a.promenade_date = current_date), 'a Bad is not shown again to the same Visitor within 14 days');
  return next is((select count(*)::integer from public.promenade_picks where promenade_date = current_date + 1) > 0, true,
    'the second build gives a Promenade too');
end $$;

----------------------------------------------------------------------------------------------
-- Rights: RLS on the new tables, members call only the 13 functions meant for them
----------------------------------------------------------------------------------------------
create function pg_temp.test_privileges() returns setof text language plpgsql as $$
begin
  return next is((select count(*)::integer from pg_class
    where oid in ('public.blocks'::regclass, 'public.reports'::regclass, 'public.moderation_actions'::regclass,
                  'public.visit_requests'::regclass, 'public.promenade_picks'::regclass) and relrowsecurity), 5,
    'RLS is on for the 5 new tables');
  return next is((select array_agg(c.relname::text order by c.relname) from pg_class c
    where c.oid in ('public.blocks'::regclass, 'public.reports'::regclass, 'public.moderation_actions'::regclass,
                    'public.visit_requests'::regclass, 'public.promenade_picks'::regclass)
      and (has_table_privilege('authenticated', c.oid, 'select,insert,update')
           or has_table_privilege('anon', c.oid, 'select,insert,update'))),
    array['blocks'], 'only blocks is readable (own rows, policy)');
  return next ok(not has_table_privilege('authenticated', 'public.blocks', 'insert,update'),
    'blocks is written through block_user / unblock_user only');
  return next is((select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
        and p.proname in ('new_ecrou', 'is_blocked_between', 'is_member_active', 'zone_is_open', 'has_permit',
          'is_bad_visible', 'criteria_match', 'can_view_bad', 'has_open_relation', 'pair_cooldown_until',
          'visitor_reputation', 'complicity_from_sums', 'complicity_with', 'complicity_score', 'distance_km',
          'public_photos', 'public_tribes', 'place_name', 'notify', 'build_daily_promenade', 'run_promenades_due',
          'note_fingerprint', 'expire_visit_requests', 'visit_requests_after_write', 'can_report',
          'is_trusted_reporter',
          'get_fiche', 'get_permit', 'discover_bads', 'get_my_promenade', 'mark_promenade_seen',
          'send_visit_request', 'get_mailbox', 'decide_visit_request', 'get_my_requests', 'change_role',
          'block_user', 'unblock_user', 'report')),
    array['block_user', 'change_role', 'decide_visit_request', 'discover_bads', 'get_fiche', 'get_mailbox',
      'get_my_promenade', 'get_my_requests', 'get_permit', 'mark_promenade_seen', 'report', 'send_visit_request',
      'unblock_user'], 'members call only the 13 functions meant for them');
  return next is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
        and p.proname in ('get_fiche', 'get_permit', 'discover_bads', 'get_my_promenade', 'send_visit_request',
          'get_mailbox', 'get_my_requests', 'report', 'block_user', 'change_role')), 0, 'anon calls none of them');
  return next is((select array_agg(jobname::text order by jobname) from cron.job
      where jobname in ('promenades-due', 'expire-visit-requests')), array['expire-visit-requests', 'promenades-due'],
    'the two hourly jobs are scheduled');
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
