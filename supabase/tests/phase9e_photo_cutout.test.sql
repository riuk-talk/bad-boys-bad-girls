-- Phase 9e (pgTAP): photos on the height chart (owner's decisions of 2026-10-23). `is_cutout` is
-- set by the server only; a pose not cut out on the device waits for the Greffe's cut-out and is
-- never validated as it is; the batch of old photos is off unless switched on (preview only). Every test_* function
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

create function pg_temp.test_member_pose_waits_for_cutout() returns setof text language plpgsql as $$
declare b uuid := pg_temp.new_member('bad'); face uuid; extra uuid;
begin
  perform pg_temp.as_user(b);
  insert into public.photos (owner_id, position, pending_path) values (b, 0, b || '/f.webp') returning id into face;
  insert into public.photos (owner_id, position, pending_path) values (b, 3, b || '/x.webp') returning id into extra;
  perform pg_temp.as_owner();
  return next is((select needs_cutout from public.photos where id = face), true,
    'a pose sent by a member waits for its cut-out');
  return next is((select needs_cutout from public.photos where id = extra), false,
    'an extra photo is never cut out');

  return next throws_ok(format('update public.photos set status = %L where id = %L', 'approved', face),
    '23514', null, 'a photo waiting for its cut-out cannot be validated as it is');
  update public.photos set is_cutout = true, needs_cutout = false where id = face;
  update public.photos set status = 'approved' where id = face;
  return next is((select status::text from public.photos where id = face), 'approved',
    'once cut out (by the server), it can be validated');
end $$;

create function pg_temp.test_greffe_cuts_out() returns setof text language plpgsql as $$
declare b uuid := pg_temp.new_member('bad'); g uuid := pg_temp.new_member('visitor'); ph uuid;
  previous text; listed uuid[];
begin
  perform pg_temp.as_user(b);
  insert into public.photos (owner_id, position, pending_path) values (b, 1, b || '/old.webp') returning id into ph;

  return next throws_ok(format('select public.admin_store_cutout(%L, %L)', ph, b || '/new.webp'),
    '42501', 'admin_only', 'a member cannot record a cut-out');
  perform pg_temp.as_owner();
  insert into public.admin_users (user_id) values (g);

  perform pg_temp.as_admin(g);
  listed := array(select public.admin_photos_to_cut_out(array[ph]));
  return next is(listed, array[ph], 'the Greffe sees the photo waits for its cut-out');
  return next throws_ok(format('select public.admin_store_cutout(%L, %L)', ph, g || '/new.webp'),
    '22023', 'invalid_path', 'the cut-out stays in the owner''s folder');
  previous := public.admin_store_cutout(ph, b || '/new.webp');
  return next is(previous, b || '/old.webp', 'the previous file is returned, to be removed');
  return next throws_ok(format('select public.admin_store_cutout(%L, %L)', ph, b || '/again.webp'),
    'P0001', 'photo_not_waiting_cutout', 'only once');
  perform pg_temp.as_owner();
  return next ok((select is_cutout and not needs_cutout and pending_path = b || '/new.webp'
    from public.photos where id = ph), 'the photo is cut out and can now be validated');
end $$;

create function pg_temp.test_batch_off_unless_switched_on() returns setof text language plpgsql as $$
declare b uuid := pg_temp.new_member('bad'); g uuid := pg_temp.new_member('visitor'); ph uuid; n integer;
  r record;
begin
  insert into public.photos (owner_id, position, pending_path) values (b, 2, b || '/r.webp') returning id into ph;
  -- Cut out by the previous engine, not re-cut yet (9k: a validated pose is cut out or waived).
  update public.photos set status = 'approved', public_path_large = 'old.webp', public_path_small = 'old-s.webp',
    is_cutout = true where id = ph;
  insert into public.admin_users (user_id) values (g);

  perform pg_temp.as_admin(g);
  return next throws_ok('select * from public.admin_photo_batch(10)', '42501', 'batch_not_allowed',
    'off by default (production): the batch is refused');
  return next throws_ok(format('select * from public.admin_replace_public_photo(%L, %L, %L)', ph, 'n.webp', 'n-s.webp'),
    '42501', 'batch_not_allowed', 'and so is the replacement');
  perform pg_temp.as_owner();

  update public.app_settings set photo_batch_allowed = true;
  perform pg_temp.as_user(b);
  return next throws_ok('select * from public.admin_photo_batch(10)', '42501', 'admin_only',
    'a member never reaches it');
  perform pg_temp.as_admin(g);
  select count(*) into n from public.admin_photo_batch(100) where photo_id = ph;
  return next is(n, 1, 'switched on (preview): the old validated poses are listed');
  return next throws_ok(format('select * from public.admin_replace_public_photo(%L, %L, %L)', ph, 'a/n.webp', 'n-s.webp'),
    '22023', 'invalid_path', 'public names only');
  select * into r from public.admin_replace_public_photo(ph, 'n.webp', 'n-s.webp');
  return next is(r.old_large, 'old.webp', 'the previous files are returned, to be removed');
  select count(*) into n from public.admin_photo_batch(100) where photo_id = ph;
  return next is(n, 0, 'a re-cut photo leaves the batch');
  perform pg_temp.as_owner();
  return next ok((select is_cutout and public_path_large = 'n.webp' and recut_at is not null
    from public.photos where id = ph), 'the validated photo is now cut out, and re-cut');
  -- 9i: a pose already cut out by the previous engine is re-cut too, once.
  update public.photos set is_cutout = true, recut_at = null where id = ph;
  perform pg_temp.as_admin(g);
  select count(*) into n from public.admin_photo_batch(100) where photo_id = ph;
  perform pg_temp.as_owner();
  return next is(n, 1, 'a pose cut out before 9i is in the batch until it is re-cut');
  return next ok(not has_column_privilege('authenticated', 'public.photos', 'recut_at', 'update')
    and not has_column_privilege('authenticated', 'public.photos', 'recut_at', 'insert'),
    'members cannot write recut_at');
  return next ok(not has_column_privilege('authenticated', 'public.app_settings', 'photo_batch_allowed', 'update'),
    'members cannot switch the batch on');
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
