-- Phase 2 / 2b security tests (pgTAP, xUnit style).
-- Every test_* function runs in its own rolled-back transaction (runtests), so nothing persists.
-- Helpers and tests live in pg_temp: they disappear with the session.
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

-- Member with a profile, created as the database owner (bypasses RLS on purpose).
create function pg_temp.new_member(p_email text, p_gender public.gender default 'woman',
  p_place bigint default null, p_role public.member_role default 'bad') returns uuid language plpgsql as $$
declare uid uuid := pg_temp.new_user(p_email);
begin
  insert into public.profiles (id, pseudo, birthdate, gender, seeking_genders, place_id, role, visit_motive)
  values (uid, 'm' || translate(substr(replace(uid::text, '-', ''), 1, 12), '0123456789', 'ghijklmnop'), date '1990-01-01', p_gender,
    '{man,woman}', p_place, p_role, case when p_role = 'visitor' then 'Motif de test' end);
  return uid;
end $$;

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

----------------------------------------------------------------------------------------------
-- Structure
----------------------------------------------------------------------------------------------
create function pg_temp.test_rls_enabled_everywhere() returns setof text language plpgsql as $$
begin
  return next is(
    (select array_agg(relname::text order by relname) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
    null, 'every public table has RLS enabled');
end $$;

create function pg_temp.test_anon_has_no_table_privilege() returns setof text language plpgsql as $$
begin
  return next is(
    (select array_agg(t.table_name::text order by t.table_name) from information_schema.tables t
     where t.table_schema = 'public' and (
       has_table_privilege('anon', 'public.' || quote_ident(t.table_name), 'select')
       or has_table_privilege('anon', 'public.' || quote_ident(t.table_name), 'insert')
       or has_table_privilege('anon', 'public.' || quote_ident(t.table_name), 'update')
       or has_table_privilege('anon', 'public.' || quote_ident(t.table_name), 'delete'))),
    null, 'anon has no privilege on any public table');
end $$;

create function pg_temp.test_anon_cannot_execute_functions() returns setof text language plpgsql as $$
begin
  return next is(
    (select array_agg(p.proname::text order by p.proname) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')),
    null, 'anon cannot execute any public function');
end $$;

create function pg_temp.test_private_tables_closed_to_members() returns setof text language plpgsql as $$
declare t text;
begin
  foreach t in array array['admin_users', 'app_settings', 'moderation_keywords', 'banned_email_hashes',
    'flagged_texts', 'email_outbox', 'super_admins'] loop
    return next ok(not has_table_privilege('authenticated', 'public.' || t, 'select')
      and not has_table_privilege('authenticated', 'public.' || t, 'insert'),
      'members have no access to ' || t);
  end loop;
end $$;

create function pg_temp.test_hook_only_for_auth_service() returns setof text language plpgsql as $$
begin
  return next ok(has_function_privilege('supabase_auth_admin', 'public.hook_before_user_created(jsonb)', 'execute'),
    'auth service can call the hook');
  return next ok(not has_function_privilege('authenticated', 'public.hook_before_user_created(jsonb)', 'execute'),
    'members cannot call the hook');
  return next ok(not has_function_privilege('authenticated', 'public.ban_email_hash(text)', 'execute'),
    'members cannot compute ban fingerprints');
end $$;

----------------------------------------------------------------------------------------------
-- Profiles
----------------------------------------------------------------------------------------------
create function pg_temp.test_members_cannot_read_each_other() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_member('a@test.local'); b uuid := pg_temp.new_member('b@test.local');
begin
  perform pg_temp.as_user(a);
  return next is(pg_temp.val(format('select count(*) from public.profiles where id = %L', b)), '0',
    'A cannot read B''s profile');
  return next is(pg_temp.val('select count(*) from public.profiles'), '1', 'A sees only their own profile');
  return next is(pg_temp.val(format('select count(*) from public.notification_preferences where user_id = %L', b)), '0',
    'A cannot read B''s preferences');
  return next is(pg_temp.val(format('select count(*) from public.profile_tribes where profile_id = %L', b)), '0',
    'A cannot read B''s tribes');
  perform pg_temp.as_owner();
end $$;

create function pg_temp.test_members_cannot_write_protected_columns() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_member('a@test.local'); col text;
begin
  perform pg_temp.as_user(a);
  foreach col in array array['moderation_status = ''approved''', 'is_reglo = true', 'banned_at = null',
    'hidden_reason = null', 'suspended_until = null', 'pending_requests_count = 0', 'requests_open = true',
    'role = ''visitor''', 'role_changed_at = now()',
    'zone_id = null', 'is_seed = true', 'referral_code = ''HACKED00''', 'referred_by = null',
    'onboarding_completed_at = now()', 'last_seen_at = now()', 'consecutive_dismissals = 0',
    'lat = 0', 'paused_at = null', 'ecrou = ''123456'''] loop
    return next matches(coalesce(pg_temp.try(format('update public.profiles set %s where id = %L', col, a)), 'ok'),
      '^42501', 'member cannot set ' || col);
  end loop;
  perform pg_temp.as_owner();
end $$;

create function pg_temp.test_members_cannot_impersonate() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_user('a@test.local'); b uuid := pg_temp.new_user('b@test.local');
begin
  perform pg_temp.as_user(a);
  return next matches(coalesce(pg_temp.try(format(
    'insert into public.profiles (id, pseudo) values (%L, ''Usurpateur'')', b)), 'ok'),
    '^42501', 'A cannot create a profile for B');
  return next is(pg_temp.try(format('insert into public.profiles (id, pseudo) values (%L, ''Rebelle'')', a)), null,
    'A can create their own profile');
  return next is(pg_temp.val(format('update public.profiles set bio = ''x'' where id = %L returning 1', b)), null,
    'A cannot update B''s profile');
  perform pg_temp.as_owner();
end $$;

create function pg_temp.test_underage_refused_even_through_api() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_user('a@test.local'); b uuid := pg_temp.new_member('b@test.local');
begin
  perform pg_temp.as_user(a);
  return next matches(coalesce(pg_temp.try(format(
    'insert into public.profiles (id, birthdate) values (%L, current_date - interval ''18 years'' + interval ''1 day'')', a)), 'ok'),
    'underage', 'insert: 17 years and 364 days is refused');
  return next is(pg_temp.try(format(
    'insert into public.profiles (id, birthdate) values (%L, (current_date - interval ''18 years'')::date)', a)), null,
    'insert: exactly 18 today is accepted');
  perform pg_temp.as_user(b);
  return next matches(coalesce(pg_temp.try(format(
    'update public.profiles set birthdate = current_date - interval ''10 years'' where id = %L', b)), 'ok'),
    'underage', 'update to a minor birthdate is refused');
  perform pg_temp.as_owner();
  return next matches(coalesce(pg_temp.try(format(
    'update public.profiles set birthdate = current_date - interval ''15 years'' where id = %L', b)), 'ok'),
    'underage', 'even the database owner cannot store a minor birthdate');
end $$;

create function pg_temp.test_birthdate_locked_after_onboarding() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_member('a@test.local', 'woman', pg_temp.new_place('Ville', 43.1, 5.9));
begin
  update public.profiles set onboarding_completed_at = now() where id = a;
  perform pg_temp.as_user(a);
  return next matches(coalesce(pg_temp.try(format(
    'update public.profiles set birthdate = date ''1985-05-05'' where id = %L', a)), 'ok'),
    'birthdate_locked', 'birthdate cannot change after onboarding');
  perform pg_temp.as_owner();
end $$;

create function pg_temp.test_pseudo_and_bio_contacts() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_member('a@test.local');
begin
  perform pg_temp.as_user(a);
  return next matches(coalesce(pg_temp.try(format('update public.profiles set pseudo = ''0612345678'' where id = %L', a)), 'ok'),
    'pseudo_contains_contacts|23514', 'a phone number is refused as pseudo');
  return next matches(coalesce(pg_temp.try(format('update public.profiles set pseudo = ''a@b.fr'' where id = %L', a)), 'ok'),
    'pseudo_contains_contacts|23514', 'an e-mail is refused as pseudo');
  return next matches(coalesce(pg_temp.try(format('update public.profiles set pseudo = ''insta.com'' where id = %L', a)), 'ok'),
    'pseudo_contains_contacts', 'a link is refused as pseudo');
  perform pg_temp.try(format('update public.profiles set bio = ''Écris-moi : rebel@mail.fr ou 06 12 34 56 78'' where id = %L', a));
  return next is(pg_temp.val(format('select bio from public.profiles where id = %L', a)),
    'Écris-moi : [•••] ou [•••]', 'contacts in the bio are masked');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
-- Photos, tribes, consents
----------------------------------------------------------------------------------------------
create function pg_temp.test_photos_rules() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_member('a@test.local'); b uuid := pg_temp.new_member('b@test.local'); i int;
begin
  perform pg_temp.as_user(a);
  return next matches(coalesce(pg_temp.try(format(
    'insert into public.photos (owner_id, position, pending_path) values (%L, 0, %L)', b, b || '/x.webp')), 'ok'),
    '^42501', 'A cannot add a photo to B');
  return next matches(coalesce(pg_temp.try(format(
    'insert into public.photos (owner_id, position, status) values (%L, 0, ''approved'')', a)), 'ok'),
    '^42501', 'A cannot choose the moderation status');
  return next matches(coalesce(pg_temp.try(format(
    'insert into public.photos (owner_id, position, pending_path) values (%L, 0, %L)', a, b || '/x.webp')), 'ok'),
    '23514', 'the pending path must be inside the owner''s folder');
  for i in 0..5 loop
    perform pg_temp.try(format('insert into public.photos (owner_id, position, pending_path) values (%L, %s, %L)',
      a, i, a || '/' || i || '.webp'));
  end loop;
  return next is(pg_temp.val('select count(*) from public.photos'), '6', 'six photos accepted');
  return next matches(coalesce(pg_temp.try(format(
    'insert into public.photos (owner_id, position) values (%L, 5)', a)), 'ok'),
    'too_many_photos', 'a seventh photo is refused');
  return next is(pg_temp.val('select string_agg(distinct status::text, '','') from public.photos'), 'pending',
    'new photos are always pending');
  return next matches(coalesce(pg_temp.try('update public.photos set status = ''approved'''), 'ok'),
    '^42501', 'A cannot approve their own photos');
  perform pg_temp.as_owner();
end $$;

create function pg_temp.test_tribes_rules() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_member('a@test.local'); t smallint;
begin
  perform pg_temp.as_user(a);
  for t in select id from public.tribes order by id limit 5 loop
    perform pg_temp.try(format('insert into public.profile_tribes values (%L, %s, ''Kawasaki Z650 www.moto.fr'')', a, t));
  end loop;
  return next is(pg_temp.val('select count(*) from public.profile_tribes'), '5', 'five distinctive signs accepted');
  return next matches(coalesce(pg_temp.try(format('insert into public.profile_tribes values (%L, %s, null)', a,
    (select max(id) from public.tribes))), 'ok'), 'too_many_tribes', 'a sixth is refused');
  return next is(pg_temp.val('select detail from public.profile_tribes limit 1'), 'Kawasaki Z650 [•••]',
    'links in details are masked');
  perform pg_temp.as_owner();
end $$;

create function pg_temp.test_consents_append_only_and_private() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_member('a@test.local'); b uuid := pg_temp.new_member('b@test.local');
begin
  insert into public.consents (user_id, type, text_version, granted) values (b, 'terms', 'v1', true);
  perform pg_temp.as_user(a);
  return next matches(coalesce(pg_temp.try(format(
    'insert into public.consents (user_id, type, text_version, granted) values (%L, ''terms'', ''v1'', true)', a)), 'ok'),
    '^42501', 'members cannot write consents directly (server records the IP)');
  return next is(pg_temp.val('select count(*) from public.consents'), '0', 'A cannot read B''s consents');
  perform pg_temp.as_owner();
  return next matches(coalesce(pg_temp.try('update public.consents set granted = false'), 'ok'),
    'append_only', 'consents are never overwritten, even by the owner');
end $$;

----------------------------------------------------------------------------------------------
-- Admin, bans, zones, onboarding, referral
----------------------------------------------------------------------------------------------
create function pg_temp.test_admin_role_not_self_assignable() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_member('a@test.local');
begin
  perform pg_temp.as_user(a);
  return next matches(coalesce(pg_temp.try(format('insert into public.admin_users (user_id) values (%L)', a)), 'ok'),
    '^42501', 'a member cannot make themself admin');
  return next is(pg_temp.val('select public.is_admin()'), 'false', 'is_admin() is false for a member');
  perform pg_temp.as_owner();
  insert into public.admin_users (user_id) values (a);
  perform pg_temp.as_user(a);
  return next is(pg_temp.val('select public.is_admin()'), 'false',
    'is_admin() stays false without a second factor (aal1)');
  perform pg_temp.as_owner();
  perform set_config('request.jwt.claims',
    json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
  return next is(pg_temp.val('select public.is_admin()'), 'true', 'is_admin() is true once listed, with aal2');
  perform pg_temp.as_owner();
end $$;

create function pg_temp.test_ban_hook() returns setof text language plpgsql as $$
begin
  insert into public.banned_email_hashes (hash, expires_at)
  values (public.ban_email_hash('Banni@Example.org'), now() + interval '1 year'),
         (public.ban_email_hash('expire@example.org'), now() - interval '1 day');
  return next is(public.hook_before_user_created('{"user":{"email":"banni@example.org"}}') #>> '{error,message}',
    'email_banned', 'a banned e-mail is refused (case-insensitive)');
  return next is(public.hook_before_user_created('{"user":{"email":" BANNI@example.org "}}') #>> '{error,http_code}',
    '403', 'surrounding spaces do not bypass the ban');
  return next is(public.hook_before_user_created('{"user":{"email":"banni+alias@example.org"}}'), '{}'::jsonb,
    'aliases are not normalised (decision 11)');
  return next is(public.hook_before_user_created('{"user":{"email":"expire@example.org"}}'), '{}'::jsonb,
    'an expired fingerprint no longer blocks');
  return next is(public.hook_before_user_created('{"user":{"email":"nouveau@example.org"}}'), '{}'::jsonb,
    'a normal sign-up passes');
  return next is(public.hook_before_user_created('{"user":{"phone":"+33600000000"}}'), '{}'::jsonb,
    'an event without e-mail passes');
end $$;

create function pg_temp.test_zone_recomputed_when_zones_change() returns setof text language plpgsql as $$
declare
  -- Fictitious places far from the dev zones (about 20 km apart).
  toulon bigint := pg_temp.new_place('Centre test', 46.0, 2.0);
  hyeres bigint := pg_temp.new_place('Voisine test', 46.0, 2.26);
  a uuid := pg_temp.new_member('a@test.local', 'woman', hyeres);
  z smallint;
begin
  return next is((select zone_id from public.profiles where id = a), null, 'no zone before any zone exists');
  insert into public.launch_zones (slug, name, center_place_id, radius_km) values ('test-centre', 'Centre test', toulon, 30)
    returning id into z;
  return next is((select zone_id from public.profiles where id = a), z, 'existing member attached when the zone is created');
  update public.launch_zones set radius_km = 10 where id = z;
  return next is((select zone_id from public.profiles where id = a), null, 'member detached when the radius shrinks');
  update public.launch_zones set radius_km = 25 where id = z;
  return next is((select zone_id from public.profiles where id = a), z, 'member re-attached when the radius grows');
end $$;

create function pg_temp.test_complete_onboarding() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_member('a@test.local', 'woman', pg_temp.new_place('Ville', 43.1, 5.9)); t text;
begin
  update public.profiles set role = null where id = a;
  perform pg_temp.as_user(a);
  return next matches(coalesce(pg_temp.try('select public.complete_onboarding()'), 'ok'),
    '^23514 onboarding_incomplete', 'refused without role, consents and photo');
  perform pg_temp.as_owner();
  update public.profiles set role = 'bad' where id = a;
  foreach t in array array['terms', 'privacy', 'age_18', 'art9_seeking'] loop
    insert into public.consents (user_id, type, text_version, granted) values (a, t::public.consent_type, 'v1', true);
  end loop;
  insert into public.photos (owner_id, position, pending_path)
    select a, p, a || '/' || p || '.webp' from generate_series(0, 2) p;
  -- Phase 3: the 3 poses, the Casier and the 10 core answers are required too (tested in phase3_security).
  insert into public.casier_charges (profile_id, charge_1, charge_2, charge_3, true_index) values (a, 'un', 'deux', 'trois', 1);
  insert into public.answers (user_id, question_id, option_id)
    select a, q.id, q.id * 10 + 1 from public.questions q where q.phase = 'core' and q.is_active;
  perform pg_temp.as_user(a);
  return next is(pg_temp.try('select public.complete_onboarding()'), null, 'a Bad is accepted once the common steps are done');
  perform pg_temp.as_owner();
  return next isnt((select onboarding_completed_at from public.profiles where id = a), null, 'onboarding marked complete');
  insert into public.consents (user_id, type, text_version, granted) values (a, 'art9_seeking', 'v1', false);
  return next is((select count(*)::int from public.consents where user_id = a), 5, 'withdrawal is a new row, history kept');
end $$;

create function pg_temp.test_referral() returns setof text language plpgsql as $$
declare
  a uuid := pg_temp.new_member('a@test.local');
  b uuid := pg_temp.new_member('b@test.local');
  code text := (select referral_code from public.profiles where id = a);
begin
  perform pg_temp.as_user(a);
  return next is(pg_temp.val(format('select public.claim_referral(%L)', code)), 'false', 'cannot refer oneself');
  perform pg_temp.as_user(b);
  return next is(pg_temp.val(format('select public.claim_referral(%L)', lower(code))), 'true', 'B claims A''s code');
  return next is(pg_temp.val(format('select public.claim_referral(%L)', code)), 'false', 'only once');
  perform pg_temp.as_owner();
  update public.profiles set onboarding_completed_at = now(), place_id = pg_temp.new_place('V', 43, 6) where id = b;
  perform pg_temp.as_user(a);
  return next is(pg_temp.val('select public.referral_count()'), '1', 'A sees one recruited accomplice');
  perform pg_temp.as_owner();
end $$;

create function pg_temp.test_zone_progress_counts_active_bads() returns setof text language plpgsql as $$
declare
  nice bigint := pg_temp.new_place('Ville test', 47.0, 3.0);
  me uuid := pg_temp.new_member('me@test.local', 'man', nice);
  w1 uuid := pg_temp.new_member('w1@test.local', 'woman', nice);
  w2 uuid := pg_temp.new_member('w2@test.local', 'woman', nice);
  m1 uuid := pg_temp.new_member('m1@test.local', 'man', nice);
  paused uuid := pg_temp.new_member('paused@test.local', 'woman', nice);
  gone uuid := pg_temp.new_member('gone@test.local', 'woman', nice);
  nophoto uuid := pg_temp.new_member('nophoto@test.local', 'man', nice);
  v uuid := pg_temp.new_member('v@test.local', 'woman', nice, 'visitor');
begin
  -- 4 Bads required, floors: 50 % bad girls (2), 25 % bad boys (1).
  insert into public.launch_zones (slug, name, center_place_id, radius_km, threshold_bads,
    threshold_women_pct, threshold_men_pct) values ('test-ville', 'Ville test', nice, 30, 4, 50, 25);
  update public.profiles set onboarding_completed_at = now(), last_seen_at = now()
    where id in (w1, w2, m1, paused, nophoto, v);
  update public.profiles set onboarding_completed_at = now(), last_seen_at = now() - interval '31 days'
    where id = gone;
  update public.profiles set is_paused = true where id = paused;
  -- Phase 3: a Bad counts with the 3 poses validated (a Visitor has the face photo only).
  insert into public.photos (owner_id, position, pending_path)
    select id, p, id || '/' || p || '.webp' from unnest(array[w1, w2, m1, paused, gone, nophoto]) id,
      generate_series(0, 2) p;
  insert into public.photos (owner_id, position, pending_path) values (v, 0, v || '/0.webp');
  update public.photos set status = 'approved', is_cutout = true where owner_id <> nophoto;
  perform pg_temp.as_user(me);
  return next is(pg_temp.val('select bads from public.zone_progress()'), '3',
    'only active, visible Bads count (not paused, not inactive > 30 days, approved photo, no Visitor)');
  return next is(pg_temp.val('select bad_girls || ''/'' || min_bad_girls from public.zone_progress()'), '2/2',
    'bad girls floor is an absolute number');
  return next is(pg_temp.val('select bad_boys || ''/'' || min_bad_boys from public.zone_progress()'), '1/1',
    'bad boys floor is an absolute number');
  return next is(pg_temp.val('select ready from public.zone_progress()'), 'false', 'not ready below the total');
  return next is(pg_temp.val('select visitors_waiting from public.zone_progress()'), '1',
    'a Bad sees the Visitors waiting with a Permit');
  perform pg_temp.as_owner();
  update public.profiles set is_paused = false where id = paused;
  perform pg_temp.as_user(me);
  return next is(pg_temp.val('select ready from public.zone_progress()'), 'true', 'ready once all floors are met');
  perform pg_temp.as_user(v);
  return next is(pg_temp.val('select visitors_waiting is null from public.zone_progress()'), 'true',
    'a Visitor does not get the Visitors count');
  perform pg_temp.as_owner();
end $$;

-- Concept v2 (SPEC v7 §2 bis, §5 bis): the role is protected; a Visitor's Permis needs a Motif and one photo.
create function pg_temp.test_onboarding_role_rules() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_member('a@test.local', 'woman', pg_temp.new_place('Ville', 43.1, 5.9)); t text;
begin
  update public.profiles set role = null, visit_motive = null where id = a;
  perform pg_temp.as_user(a);
  return next matches(coalesce(pg_temp.try(format('update public.profiles set role = ''bad'' where id = %L', a)), 'ok'),
    '^42501', 'the role column is not writable by the member');
  return next is(pg_temp.try('select public.set_onboarding_role(''visitor'')'), null, 'role chosen at step 3');
  return next is(pg_temp.val(format('select role from public.profiles where id = %L', a)), 'visitor', 'role saved');
  perform pg_temp.as_owner();
  foreach t in array array['terms', 'privacy', 'age_18', 'art9_seeking'] loop
    insert into public.consents (user_id, type, text_version, granted) values (a, t::public.consent_type, 'v1', true);
  end loop;
  perform pg_temp.as_user(a);
  return next is(pg_temp.try(format('insert into public.photos (owner_id, position, pending_path) values (%L, 0, %L)',
    a, a || '/0.webp')), null, 'a Visitor adds the Permis photo');
  return next matches(coalesce(pg_temp.try(format(
    'insert into public.photos (owner_id, position, pending_path) values (%L, 1, %L)', a, a || '/1.webp')), 'ok'),
    'visitor_single_photo', 'a Visitor cannot add a second photo');
  return next matches(coalesce(pg_temp.try('select public.complete_onboarding()'), 'ok'),
    'onboarding_incomplete', 'a Visitor cannot finish without a Motif de visite');
  return next is(pg_temp.try(format('update public.profiles set visit_motive = %L where id = %L',
    'Écris-moi à moi@exemple.fr', a)), null, 'the Visitor writes the Motif');
  return next is(pg_temp.val(format('select position(''moi@exemple.fr'' in visit_motive) from public.profiles where id = %L', a)),
    '0', 'contacts are masked in the Motif');
  perform pg_temp.as_owner();
  insert into public.answers (user_id, question_id, option_id)
    select a, q.id, q.id * 10 + 1 from public.questions q where q.phase = 'core' and q.is_active;
  perform pg_temp.as_user(a);
  return next is(pg_temp.try('select public.complete_onboarding()'), null, 'a Visitor finishes with photo and Motif');
  return next matches(coalesce(pg_temp.try('select public.set_onboarding_role(''bad'')'), 'ok'),
    'role_locked', 'the role cannot be changed through the onboarding function afterwards');
  return next matches(coalesce(pg_temp.try(format('update public.profiles set visit_motive = null where id = %L', a)), 'ok'),
    '23514', 'a finished Visitor cannot erase the Motif');
  perform pg_temp.as_owner();
end $$;

create function pg_temp.test_storage_policies() returns setof text language plpgsql as $$
declare a uuid := pg_temp.new_member('a@test.local'); b uuid := pg_temp.new_member('b@test.local');
begin
  perform pg_temp.as_user(a);
  return next is(pg_temp.try(format(
    'insert into storage.objects (bucket_id, name, owner_id) values (''photos-pending'', %L, %L)', a || '/1.webp', a)), null,
    'A uploads into their own pending folder');
  return next matches(coalesce(pg_temp.try(format(
    'insert into storage.objects (bucket_id, name, owner_id) values (''photos-pending'', %L, %L)', b || '/1.webp', a)), 'ok'),
    '42501|row-level security', 'A cannot upload into B''s folder');
  return next matches(coalesce(pg_temp.try(format(
    'insert into storage.objects (bucket_id, name, owner_id) values (''photos'', %L, %L)', a || '/1.webp', a)), 'ok'),
    '42501|row-level security', 'members cannot write the public bucket');
  perform pg_temp.as_owner();
  insert into storage.objects (bucket_id, name) values ('photos-pending', b || '/2.webp');
  perform pg_temp.as_user(a);
  return next is(pg_temp.val(format(
    'select count(*) from storage.objects where bucket_id = ''photos-pending'' and name like %L', b || '/%')), '0',
    'A cannot list B''s pending photos');
  perform pg_temp.as_owner();
  return next is((select public from storage.buckets where id = 'photos-pending'), false, 'pending bucket is private');
  return next is((select allowed_mime_types from storage.buckets where id = 'photos'), array['image/webp'],
    'only WebP is accepted');
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
