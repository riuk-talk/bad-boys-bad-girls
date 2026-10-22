-- Phase 9c (pgTAP): le badge « Complices recrutés » (SPEC §5 [P1], §3). Every test_* function runs
-- in its own rolled-back transaction (runtests).

create function pg_temp.new_member(p_role public.member_role, p_done boolean default true)
returns uuid language plpgsql as $$
declare uid uuid := gen_random_uuid(); place bigint;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    uid || '@test.local', '', now(), '{}', '{}', now(), now());
  insert into public.places (official_code, name, lat, lng)
  values ('R' || substr(md5(random()::text), 1, 8), 'Ville test', 47.5, 3.5) returning id into place;
  insert into public.profiles (id, pseudo, birthdate, gender, seeking_genders, place_id, role, visit_motive)
  values (uid, 'r' || translate(substr(replace(uid::text, '-', ''), 1, 12), '0123456789', 'ghijklmnop'),
    date '1990-01-01', 'woman', '{man,woman}', place, p_role,
    case when p_role = 'visitor' then 'Motif de test' end);
  if p_done then update public.profiles set onboarding_completed_at = now() where id = uid; end if;
  return uid;
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

create function pg_temp.test_recruited() returns setof text language plpgsql as $$
declare b uuid := pg_temp.new_member('bad');
  done1 uuid := pg_temp.new_member('visitor'); done2 uuid := pg_temp.new_member('bad');
  unfinished uuid := pg_temp.new_member('visitor', false); banned uuid := pg_temp.new_member('visitor');
  seed uuid := pg_temp.new_member('visitor'); r jsonb; n integer;
begin
  update public.profiles set referred_by = b where id in (done1, done2, unfinished, banned, seed);
  update public.profiles set banned_at = now() where id = banned;
  update public.profiles set is_seed = true where id = seed;

  perform pg_temp.as_user(b);
  r := public.get_fiche(b);
  n := public.referral_count();
  perform pg_temp.as_owner();
  return next is((r ->> 'recruited')::int, 2, 'the Fiche counts the referred members who finished their onboarding');
  return next is(n, 2, '« Mon quartier » shows the same count');

  return next ok(not has_function_privilege('authenticated', 'private.recruited_count(uuid)', 'execute'),
    'the count itself is not callable');
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
