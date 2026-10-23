-- Phase 9e (pgTAP): photos on the height chart (owner's decision 2026-10-23, version B).
-- `is_cutout` is set by the server only; the Greffe and the Fiche read it. Every test_* function
-- runs in its own rolled-back transaction (runtests).

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

-- Admin rights need the second factor (aal2, Phase 5 bis).
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

create function pg_temp.test_cutout_written_by_server_only() returns setof text language plpgsql as $$
declare b uuid := pg_temp.new_member('bad'); ph uuid;
begin
  return next ok(not has_column_privilege('authenticated', 'public.photos', 'is_cutout', 'insert'),
    'a member cannot send a photo already marked as cut out');
  return next ok(not has_column_privilege('authenticated', 'public.photos', 'is_cutout', 'update'),
    'a member cannot mark a photo as cut out');

  insert into public.photos (owner_id, position, pending_path, width, height)
  values (b, 0, b || '/face.webp', 900, 1200) returning id into ph;
  return next is((select is_cutout from public.photos where id = ph), false, 'a photo is as it is by default');
end $$;

create function pg_temp.test_cutout_read() returns setof text language plpgsql as $$
declare b uuid := pg_temp.new_member('bad'); g uuid := pg_temp.new_member('visitor'); ph uuid; r jsonb;
begin
  insert into public.photos (owner_id, position, pending_path, width, height, is_cutout)
  values (b, 0, b || '/face.webp', 900, 1200, true) returning id into ph;
  -- The insert trigger keeps every new photo pending; the Greffe approves it.
  update public.photos set status = 'approved', public_path_large = b || '/l.webp',
    public_path_small = b || '/s.webp' where id = ph;

  perform pg_temp.as_user(g);
  return next throws_ok(format('select * from public.admin_photo_cutouts(array[%L]::uuid[])', ph),
    '42501', 'admin_only', 'only the Greffe reads the state of pending photos');
  perform pg_temp.as_owner();

  insert into public.admin_users (user_id) values (g);
  perform pg_temp.as_admin(g);
  return next is((select is_cutout from public.admin_photo_cutouts(array[ph])), true,
    'the Greffe sees the photo cut out, as it will be shown');
  perform pg_temp.as_owner();

  r := public.public_photos(b, array[0]::smallint[]);
  return next is((r -> 0 ->> 'cutout')::boolean, true, 'the Fiche knows the photo is cut out');
  return next ok(not has_function_privilege('anon', 'public.admin_photo_cutouts(uuid[])', 'execute'),
    'not callable without an account');
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
