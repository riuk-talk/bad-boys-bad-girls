-- Phase 9k (pgTAP): the Greffe may validate a pose without its cut-out, with a motive (owner's
-- decision 2026-11-03). Only an admin (second factor) waives it, never the member; a waiver
-- needs a motive; a validated pose is cut out or waived; the motive stays internal; the batch
-- ignores waived poses. Every test_* function runs in its own rolled-back transaction (runtests).

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

create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- A pose sent by the member and not cut out on the device: pending, waiting for the Greffe.
create function pg_temp.pose_not_cut_out(p_owner uuid, p_position smallint default 0) returns uuid
language sql as $$
  insert into public.photos (owner_id, position, pending_path, needs_cutout)
  values (p_owner, p_position, p_owner || '/' || gen_random_uuid() || '.webp', true) returning id
$$;

create function pg_temp.new_admin() returns uuid language plpgsql as $$
declare a uuid := pg_temp.new_member('visitor');
begin
  insert into public.admin_users (user_id) values (a);
  return a;
end $$;

create function pg_temp.public_names() returns text[] language sql as $$
  select array[n || '.webp', n || '-s.webp'] from (select gen_random_uuid()::text n) x
$$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_member_cannot_waive() returns setof text language plpgsql as $$
declare b uuid := pg_temp.new_member('bad'); ph uuid := pg_temp.pose_not_cut_out(b);
begin
  perform pg_temp.as_user(b);
  return next matches(coalesce(pg_temp.try(format(
    'select public.admin_waive_cutout(%L, ''failed_cutout'')', ph)), 'ok'),
    '^42501', 'a member cannot waive the cut-out of their own pose');
  return next matches(coalesce(pg_temp.try(format(
    'update public.photos set cutout_waived = true, cutout_waived_reason = ''x'' where id = %L', ph)), 'ok'),
    '^42501', 'nor by writing the table');
  return next matches(coalesce(pg_temp.try(format(
    'insert into public.photos (owner_id, position, pending_path, cutout_waived, cutout_waived_reason) values (%L, 1, %L, true, ''x'')',
    b, b || '/w.webp')), 'ok'),
    '^42501', 'nor by sending a waived pose');
  return next matches(coalesce(pg_temp.try(format(
    'select public.admin_approve_without_cutout(%L, ''failed_cutout'', null, %L, %L)', ph,
    gen_random_uuid() || '.webp', gen_random_uuid() || '-s.webp')), 'ok'),
    '^42501 admin_only', 'nor validate it without cut-out');
  -- An admin without the second factor (aal1) is refused too.
  perform pg_temp.as_owner();
  insert into public.admin_users (user_id) values (b);
  perform pg_temp.as_user(b);
  return next matches(coalesce(pg_temp.try(format(
    'select public.admin_waive_cutout(%L, ''failed_cutout'')', ph)), 'ok'),
    '^42501 admin_only', 'an admin at aal1 cannot waive either');
  perform pg_temp.as_owner();
  return next ok((select not cutout_waived from public.photos where id = ph), 'the pose is still not waived');
  return next ok(not has_column_privilege('authenticated', 'public.photos', 'cutout_waived', 'insert')
    and not has_column_privilege('authenticated', 'public.photos', 'cutout_waived', 'update')
    and not has_column_privilege('authenticated', 'public.photos', 'cutout_waived_reason', 'insert')
    and not has_column_privilege('authenticated', 'public.photos', 'cutout_waived_reason', 'update'),
    'members write neither column');
end $$;

create function pg_temp.test_motive_required() returns setof text language plpgsql as $$
declare b uuid := pg_temp.new_member('bad'); ph uuid := pg_temp.pose_not_cut_out(b); adm uuid := pg_temp.new_admin();
begin
  perform pg_temp.as_admin(adm);
  return next matches(coalesce(pg_temp.try(format('select public.admin_waive_cutout(%L, null)', ph)), 'ok'),
    '^22023 invalid_reason', 'an admin without a motive is refused');
  return next matches(coalesce(pg_temp.try(format('select public.admin_waive_cutout(%L, ''ugly'')', ph)), 'ok'),
    '^22023 invalid_reason', 'a motive outside the list is refused');
  return next matches(coalesce(pg_temp.try(format('select public.admin_waive_cutout(%L, ''other'', ''  '')', ph)), 'ok'),
    '^22023 invalid_reason', '« other » without its text is refused');
  return next matches(coalesce(pg_temp.try(format('select public.admin_approve_without_cutout(%L, null, null, %L, %L)', ph,
    gen_random_uuid() || '.webp', gen_random_uuid() || '-s.webp')), 'ok'),
    '^22023 invalid_reason', 'nor validated without cut-out and without a motive');
  perform pg_temp.as_owner();
  return next ok((select status = 'pending' and not cutout_waived from public.photos where id = ph),
    'the pose stays pending, not waived');
  return next matches(coalesce(pg_temp.try(format(
    'update public.photos set cutout_waived = true where id = %L', ph)), 'ok'),
    '^23514', 'the table itself refuses a waiver without a motive');
end $$;

create function pg_temp.test_waived_pose_can_be_validated() returns setof text language plpgsql as $$
declare
  b uuid := pg_temp.new_member('bad');
  ph uuid := pg_temp.pose_not_cut_out(b);
  other uuid := pg_temp.pose_not_cut_out(b, 1::smallint);
  adm uuid := pg_temp.new_admin();
  names text[] := pg_temp.public_names();
  log record;
begin
  perform pg_temp.as_admin(adm);
  perform public.admin_waive_cutout(ph, 'failed_cutout');
  perform public.admin_decide_photo(ph, true, null, names[1], names[2]);
  names := pg_temp.public_names();
  perform public.admin_approve_without_cutout(other, 'other', 'Fond trop proche du visage', names[1], names[2]);
  perform pg_temp.as_owner();
  return next ok((select status = 'approved' and cutout_waived and not is_cutout and not needs_cutout
                         and cutout_waived_reason = 'failed_cutout' from public.photos where id = ph),
    'a waived pose can be validated');
  return next ok((select status = 'approved' and cutout_waived_reason = 'other: Fond trop proche du visage'
                  from public.photos where id = other),
    '« Valider sans détourage » waives and validates in one go, with the text of « other »');
  select * into log from public.moderation_actions
    where target_user_id = b and action = 'photo_cutout_waive' order by id limit 1;
  return next ok(log.admin_id = adm and log.reason = 'failed_cutout', 'the waiver is in the moderation log');
  return next is((select count(*)::int from public.moderation_actions
                  where target_user_id = b and action = 'photo_cutout_waive'), 2, 'one line per waiver');
  -- The member is told the photo is validated, never the motive.
  return next is((select count(*)::int from public.notifications where user_id = b
                  and type = 'moderation_decision' and (payload ->> 'approved')::boolean
                  and payload ->> 'reason' is null), 2, 'the member is told only that the photo is validated');
  perform pg_temp.as_user(b);
  return next ok(not has_column_privilege('authenticated', 'public.photos', 'cutout_waived_reason', 'select'),
    'members cannot read the motive');
  return next matches(coalesce(pg_temp.try('select cutout_waived_reason from public.photos'), 'ok'),
    '^42501', 'not even on their own photos');
  return next is((select cutout_waived from public.photos where id = ph), true,
    'they can read that it is validated without cut-out (displayed as a print)');
  return next ok(not (public.get_my_decisions()::text like '%failed_cutout%'),
    'the motive is not in their exposé des motifs');
  return next ok(not (public.export_my_data()::text like '%failed_cutout%'),
    'nor in their data export');
  perform pg_temp.as_owner();
  return next is((select (x -> 'waived')::boolean from jsonb_array_elements(public.public_photos(b, array[0]::smallint[])) x),
    true, 'the displays know a waived pose');
  return next ok(not (public.public_photos(b, array[0, 1]::smallint[])::text like '%Fond%'
                      or public.public_photos(b, array[0, 1]::smallint[])::text like '%failed%'),
    'and never its motive');
end $$;

create function pg_temp.test_neither_cut_out_nor_waived_refused() returns setof text language plpgsql as $$
declare b uuid := pg_temp.new_member('bad'); ph uuid := pg_temp.pose_not_cut_out(b); adm uuid := pg_temp.new_admin();
  names text[] := pg_temp.public_names();
begin
  perform pg_temp.as_admin(adm);
  return next matches(coalesce(pg_temp.try(format('select public.admin_decide_photo(%L, true, null, %L, %L)',
    ph, names[1], names[2])), 'ok'),
    '^23514', 'a pose neither cut out nor waived is still refused');
  perform pg_temp.as_owner();
  update public.photos set needs_cutout = false where id = ph;
  return next matches(coalesce(pg_temp.try(format(
    'update public.photos set status = ''approved'' where id = %L', ph)), 'ok'),
    '^23514', 'even when it no longer waits for the Greffe (written by the server)');
  return next is((select status::text from public.photos where id = ph), 'pending', 'it stays pending');
  -- A pose already cut out needs no waiver.
  update public.photos set is_cutout = true where id = ph;
  perform pg_temp.as_admin(adm);
  return next matches(coalesce(pg_temp.try(format('select public.admin_waive_cutout(%L, ''failed_cutout'')', ph)), 'ok'),
    '^23514 photo_already_cut_out', 'a cut-out pose is not waived');
end $$;

create function pg_temp.test_batch_ignores_waived() returns setof text language plpgsql as $$
declare b uuid := pg_temp.new_member('bad'); ph uuid := pg_temp.pose_not_cut_out(b); adm uuid := pg_temp.new_admin();
  names text[] := pg_temp.public_names(); n integer;
begin
  update public.app_settings set photo_batch_allowed = true;
  perform pg_temp.as_admin(adm);
  perform public.admin_approve_without_cutout(ph, 'atypical_photo', null, names[1], names[2]);
  select count(*) into n from public.admin_photo_batch(100) where photo_id = ph;
  return next is(n, 0, 'the batch ignores a waived pose');
  return next matches(coalesce(pg_temp.try(format('select * from public.admin_replace_public_photo(%L, %L, %L)',
    ph, 'n.webp', 'n-s.webp')), 'ok'),
    'photo_not_in_batch', 'and never replaces it');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
