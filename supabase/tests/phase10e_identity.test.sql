-- Phase 10e (pgTAP, owner's request 2026-11-11): « Mon identité ». The pseudo changes once every
-- 30 days after the onboarding, with the rules of the sign-up, and its history is kept; the date of
-- birth never changes by the member once the dossier is finished, only through a request the
-- Greffe decides (always 18 or more), kept as a log, the member notified; place_zone() tells the
-- quartier of a town before it is saved. Every test_* function runs in its own rolled-back
-- transaction (runtests).

create function pg_temp.new_user(p_email text default null, p_confirmed boolean default true)
returns uuid language plpgsql as $$
declare uid uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    coalesce(p_email, uid || '@test.local'), '', case when p_confirmed then now() end, '{}', '{}', now(), now());
  return uid;
end $$;

create function pg_temp.new_member(p_role public.member_role, p_done boolean default true,
  p_gender public.gender default 'woman', p_birthdate date default date '1990-01-01')
returns uuid language plpgsql as $$
declare uid uuid := pg_temp.new_user(); place bigint;
begin
  insert into public.places (official_code, name, lat, lng)
  values ('D' || substr(md5(random()::text), 1, 8), 'Ville test', 47.5, 3.5) returning id into place;
  insert into public.profiles (id, pseudo, birthdate, gender, seeking_genders, place_id, role, visit_motive)
  values (uid, 'd' || translate(substr(replace(uid::text, '-', ''), 1, 12), '0123456789', 'ghijklmnop'),
    p_birthdate, p_gender, '{man,woman}', place, p_role,
    case when p_role = 'visitor' then 'Motif de test' end);
  if p_done then update public.profiles set onboarding_completed_at = now() where id = uid; end if;
  return uid;
end $$;

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.as_admin(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end $$;

create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function pg_temp.new_admin() returns uuid language plpgsql as $$
declare a uuid := pg_temp.new_member('visitor');
begin
  insert into public.admin_users (user_id) values (a);
  return a;
end $$;


create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare m text; d text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics m = message_text, d = pg_exception_detail;
  return sqlstate || ' ' || m;
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_rights() returns setof text language plpgsql as $$
declare
  v uuid := pg_temp.new_member('visitor');
  aal1 uuid := pg_temp.new_member('visitor');
  member_calls text[] := array[
    'select * from public.place_zone(1)',
    'select public.pseudo_next_change()',
    'select public.request_birthdate_correction(date ''1990-01-02'', ''Erreur de saisie'')',
    'select public.my_identity_history()'];
  admin_calls text[] := array[
    'select * from public.admin_birthdate_corrections()',
    'select public.admin_decide_birthdate_correction(1, true, null)'];
  call text;
begin
  insert into public.admin_users (user_id) values (aal1);
  foreach call in array member_calls || admin_calls loop
    perform pg_temp.as_anon();
    return next matches(coalesce(pg_temp.try(call), 'ok'), '^42501', 'anonymous refused: ' || call);
    perform pg_temp.as_owner();
  end loop;
  foreach call in array admin_calls loop
    perform pg_temp.as_user(v);
    return next matches(coalesce(pg_temp.try(call), 'ok'), '^42501', 'a member refused: ' || call);
    perform pg_temp.as_owner();
    perform pg_temp.as_user(aal1);
    return next matches(coalesce(pg_temp.try(call), 'ok'), '^42501', 'an admin at aal1 refused: ' || call);
    perform pg_temp.as_owner();
  end loop;
  perform pg_temp.as_user(v);
  return next matches(coalesce(pg_temp.try('select * from public.pseudo_history'), 'ok'), '^42501',
    'the pseudo history is not readable through the API');
  return next matches(coalesce(pg_temp.try(format(
    'update public.profiles set pseudo_changed_at = null where id = %L', v)), 'ok'), '^42501',
    'a member cannot reset the date of the last pseudo change');
  return next matches(coalesce(pg_temp.try(format(
    'insert into public.birthdate_corrections (user_id, current_birthdate, requested_birthdate, reason) values (%L, date ''1990-01-01'', date ''1991-01-01'', ''abc'')', v)), 'ok'),
    '^42501', 'a member cannot write a request directly');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_pseudo() returns setof text language plpgsql as $$
declare
  m uuid := pg_temp.new_member('bad', true);
  other uuid := pg_temp.new_member('visitor', true);
  fresh uuid := pg_temp.new_member('visitor', false);
  taken text := (select pseudo::text from public.profiles where id = other);
begin
  perform pg_temp.as_user(m);
  return next is(public.pseudo_next_change(), null, 'never changed: the pseudo may change now');
  return next is(pg_temp.try(format('update public.profiles set pseudo = %L where id = %L', 'Lune Rousse', m)), null,
    'a first change after the onboarding is accepted');
  return next ok(public.pseudo_next_change() between now() + interval '29 days' and now() + interval '31 days',
    'the next one in 30 days');
  return next matches(coalesce(pg_temp.err(format('update public.profiles set pseudo = %L where id = %L', 'Lune Noire', m)), 'ok'),
    '^23514 pseudo_too_soon', 'a second change within 30 days is refused');
  perform pg_temp.as_owner();
  return next is((select array_agg(new_pseudo) from public.pseudo_history where user_id = m),
    array['Lune Rousse'], 'the change is kept in the history, with the old pseudo');
  -- 31 days later (the trigger keeps the date as it is: set here without the triggers).
  set local session_replication_role = replica;
  update public.profiles set pseudo_changed_at = now() - interval '31 days' where id = m;
  set local session_replication_role = origin;
  perform pg_temp.as_user(m);
  -- The rules of the sign-up still apply.
  return next matches(coalesce(pg_temp.err(format('update public.profiles set pseudo = %L where id = %L', 'ab', m)), 'ok'),
    '^23514 .*check constraint', 'too short: refused');
  return next matches(coalesce(pg_temp.err(format('update public.profiles set pseudo = %L where id = %L', 'Lune 0612345678', m)), 'ok'),
    '^23514 pseudo_contains_contacts', 'contact details: refused');
  return next matches(coalesce(pg_temp.err(format('update public.profiles set pseudo = %L where id = %L', upper(taken), m)), 'ok'),
    '^23505', 'a pseudo already taken (whatever the case): refused');
  return next is(pg_temp.try(format('update public.profiles set pseudo = %L where id = %L', 'Lune Noire', m)), null,
    '30 days later: accepted');
  perform pg_temp.as_owner();
  return next is((select count(*)::integer from public.pseudo_history where user_id = m), 2, 'two changes kept');
  -- During the onboarding: free, nothing kept.
  perform pg_temp.as_user(fresh);
  return next is(pg_temp.try(format('update public.profiles set pseudo = %L where id = %L', 'Brouillon Un', fresh)), null,
    'during the onboarding the pseudo is free');
  return next is(pg_temp.try(format('update public.profiles set pseudo = %L where id = %L', 'Brouillon Deux', fresh)), null,
    'again and again');
  perform pg_temp.as_owner();
  return next is((select count(*)::integer from public.pseudo_history where user_id = fresh), 0,
    'and nothing is kept before the dossier is finished');
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_birthdate_correction() returns setof text language plpgsql as $$
declare
  adm uuid := pg_temp.new_admin();
  m uuid := pg_temp.new_member('bad', true);
  other uuid := pg_temp.new_member('visitor', true);
  fresh uuid := pg_temp.new_member('visitor', false);
  req bigint;
  young bigint;
begin
  perform pg_temp.as_user(m);
  return next matches(coalesce(pg_temp.err(format('update public.profiles set birthdate = date ''1991-05-05'' where id = %L', m)), 'ok'),
    '^42501 birthdate_locked', 'a finished dossier: the member cannot change the date of birth');
  return next matches(coalesce(pg_temp.err(format('select public.request_birthdate_correction(%L, %L)',
    (current_date - interval '17 years')::date, 'Je me suis trompé')), 'ok'),
    '^23514 underage', 'a request under 18 is refused');
  return next matches(coalesce(pg_temp.err('select public.request_birthdate_correction(date ''1990-01-01'', ''Je me suis trompé'')'), 'ok'),
    '^23514 same_birthdate', 'the same date is not a correction');
  return next matches(coalesce(pg_temp.err('select public.request_birthdate_correction(date ''1991-05-05'', ''x'')'), 'ok'),
    '^23514 invalid_reason', 'a motive of 3 characters at least');
  req := public.request_birthdate_correction(date '1991-05-05', 'Erreur de saisie à l''inscription');
  return next ok(req is not null, 'a request with a short motive is recorded');
  return next matches(coalesce(pg_temp.err('select public.request_birthdate_correction(date ''1992-05-05'', ''Encore une'')'), 'ok'),
    '^23505 correction_pending', 'one request at a time');
  return next is((select count(*)::integer from public.birthdate_corrections), 1, 'the member reads its own request');
  perform pg_temp.as_owner();
  perform pg_temp.as_user(other);
  return next is((select count(*)::integer from public.birthdate_corrections), 0, 'another member reads nothing of it');
  perform pg_temp.as_owner();
  perform pg_temp.as_user(fresh);
  return next matches(coalesce(pg_temp.err('select public.request_birthdate_correction(date ''1991-05-05'', ''Erreur'')'), 'ok'),
    '^23514 edit_in_onboarding', 'during the onboarding, step 1 edits the date itself');
  perform pg_temp.as_owner();

  -- The Greffe decides.
  perform pg_temp.as_admin(adm);
  return next is((select count(*)::integer from public.admin_birthdate_corrections() c where c.id = req and c.status = 'pending'),
    1, 'the Greffe lists the request');
  return next matches(coalesce(pg_temp.err(format('select public.admin_decide_birthdate_correction(%s, false, null)', req)), 'ok'),
    '^23514 reason_required', 'a refusal needs a motive');
  return next is(pg_temp.try(format('select public.admin_decide_birthdate_correction(%s, true, null)', req)), null,
    'the Greffe accepts');
  return next matches(coalesce(pg_temp.err(format('select public.admin_decide_birthdate_correction(%s, false, ''Non'')', req)), 'ok'),
    '^23514 already_decided', 'a decision is final');
  perform pg_temp.as_owner();
  return next is((select birthdate from public.profiles where id = m), date '1991-05-05', 'the date of birth is corrected');
  return next ok((select status = 'accepted' and decided_by = adm and decided_at is not null
                  from public.birthdate_corrections where id = req), 'the log keeps who decided and when');
  return next is((select payload from public.notifications where user_id = m and type = 'birthdate_correction'),
    '{"accepted": true, "reason": null}'::jsonb, 'the member is notified');
  -- Never under 18, even for a request written by other means.
  insert into public.birthdate_corrections (user_id, current_birthdate, requested_birthdate, reason)
  values (other, date '1990-01-01', (current_date - interval '16 years')::date, 'Test')
  returning id into young;
  perform pg_temp.as_admin(adm);
  return next matches(coalesce(pg_temp.err(format('select public.admin_decide_birthdate_correction(%s, true, null)', young)), 'ok'),
    '^23514 underage', 'the Greffe can never accept a date under 18');
  return next is(pg_temp.try(format('select public.admin_decide_birthdate_correction(%s, false, %L)', young, 'Pièce non conforme')), null,
    'it refuses with a motive');
  perform pg_temp.as_owner();
  return next is((select birthdate from public.profiles where id = other), date '1990-01-01', 'a refusal changes nothing');
  -- Only an accepted correction, in its own transaction, unlocks the date.
  return next matches(coalesce(pg_temp.err(format('update public.profiles set birthdate = date ''1993-03-03'' where id = %L', m)), 'ok'),
    '^42501 birthdate_locked', 'not even the database owner without an accepted correction');
  perform pg_temp.as_user(m);
  return next is((public.my_identity_history() -> 'birthdate_corrections' -> 0 ->> 'status'), 'accepted',
    'the export of my data holds my requests');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_place_zone() returns setof text language plpgsql as $$
declare
  m uuid := pg_temp.new_member('visitor', true);
  inside bigint;
  outside bigint;
  zid smallint;
  z record;
begin
  insert into public.places (official_code, name, lat, lng) values ('Z' || substr(md5(random()::text), 1, 7), 'Centre test', 44.5, 1.5)
  returning id into inside;
  insert into public.places (official_code, name, lat, lng) values ('Z' || substr(md5(random()::text), 1, 7), 'Loin test', -40.0, 170.0)
  returning id into outside;
  insert into public.launch_zones (slug, name, center_place_id, radius_km, status)
  values ('test-' || substr(md5(random()::text), 1, 6), 'Quartier test', inside, 10, 'waitlist') returning id into zid;
  update public.app_settings set launch_mode = 'zones' where id;
  perform pg_temp.as_user(m);
  select * into z from public.place_zone(inside);
  return next is(z.zone_name, 'Quartier test', 'the quartier of the town');
  return next is(z.open, false, 'not open yet: the member is told before saving');
  select * into z from public.place_zone(outside);
  return next is(z.zone_name, null, 'a town in no quartier');
  perform pg_temp.as_owner();
  update public.launch_zones set status = 'open' where id = zid;
  perform pg_temp.as_user(m);
  return next is((select open from public.place_zone(inside)), true, 'once open, it says so');
  return next is(pg_temp.try(format('update public.profiles set place_id = %s where id = %L', inside, m)), null,
    'the member changes town');
  perform pg_temp.as_owner();
  return next is((select zone_id from public.profiles where id = m), zid, 'and the quartier follows');
end $$;

select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
