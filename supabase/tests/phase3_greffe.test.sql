-- Phase 3e security tests (pgTAP): the Greffe (one decision per photo) and in-app notifications.
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

create function pg_temp.as_admin(p_uid uuid) returns void language plpgsql as $$
begin
  -- Admins act with a second factor (aal2, Phase 5a-ter).
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
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

-- A pending photo at a position, as the database owner.
create function pg_temp.pending_photo(p_owner uuid, p_position smallint) returns uuid language sql as $$
  insert into public.photos (owner_id, position, pending_path)
  values (p_owner, p_position, p_owner || '/' || gen_random_uuid() || '.webp') returning id
$$;

create function pg_temp.new_admin() returns uuid language plpgsql as $$
declare a uuid := pg_temp.new_member('admin@test.local', 'man', null, 'visitor');
begin
  insert into public.admin_users (user_id) values (a);
  return a;
end $$;

----------------------------------------------------------------------------------------------
-- Access
----------------------------------------------------------------------------------------------
create function pg_temp.test_greffe_admin_only() returns setof text language plpgsql as $$
declare
  b uuid := pg_temp.new_member('b@test.local');
  p uuid := pg_temp.pending_photo(b, 0::smallint);
begin
  perform pg_temp.as_user(b);
  return next matches(coalesce(pg_temp.try('select * from public.admin_photo_queue()'), 'ok'),
    '^42501 admin_only', 'a member cannot read the Greffe queue');
  return next matches(coalesce(pg_temp.try(format(
    'select public.admin_decide_photo(%L, true, null, %L, %L)', p,
    gen_random_uuid() || '.webp', gen_random_uuid() || '-s.webp')), 'ok'),
    '^42501 admin_only', 'a member cannot approve a photo, not even their own');
  return next matches(coalesce(pg_temp.try(format('update public.photos set status = ''approved'' where id = %L', p)), 'ok'),
    '^42501', 'nor approve it by writing the table');
  -- An admin without the second factor (aal1) is refused too (Phase 5a-ter).
  perform pg_temp.as_owner();
  insert into public.admin_users (user_id) values (b);
  perform pg_temp.as_user(b);
  return next matches(coalesce(pg_temp.try('select * from public.admin_photo_queue()'), 'ok'),
    '^42501 admin_only', 'an admin at aal1 cannot read the Greffe queue');
  return next matches(coalesce(pg_temp.try(format(
    'select public.admin_decide_photo(%L, true, null, %L, %L)', p,
    gen_random_uuid() || '.webp', gen_random_uuid() || '-s.webp')), 'ok'),
    '^42501 admin_only', 'nor decide, without a second factor');
  perform pg_temp.as_anon();
  return next matches(coalesce(pg_temp.try('select * from public.admin_photo_queue()'), 'ok'),
    '^42501', 'anon cannot call the Greffe functions');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
-- Queue order (SPEC §11): Visitors' face in an open zone, then the Bads' 3 poses, then the rest
----------------------------------------------------------------------------------------------
create function pg_temp.test_greffe_queue_priority() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place('Ville test', 47.5, 3.5);
  adm uuid := pg_temp.new_admin();
  bad uuid := pg_temp.new_member('bad@test.local', 'woman', ville);
  vis uuid := pg_temp.new_member('vis@test.local', 'man', ville, 'visitor');
  extra uuid; pose uuid; face uuid;
begin
  insert into public.launch_zones (slug, name, center_place_id, radius_km, status)
    values ('test-greffe', 'Ville test', ville, 30, 'open');
  extra := pg_temp.pending_photo(bad, 3::smallint);
  pose := pg_temp.pending_photo(bad, 1::smallint);
  face := pg_temp.pending_photo(vis, 0::smallint);
  perform pg_temp.as_admin(adm);
  return next is((select array_agg(photo_id order by ord) from (
      select photo_id, row_number() over () ord from public.admin_photo_queue()) q),
    array[face, pose, extra], 'Visitor face (open zone) first, then a Bad pose, then an extra photo');
  return next is((select string_agg(photo_position::text, ',') from public.admin_photo_queue()), '0,1,3',
    'each pose is its own entry');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
-- Decisions
----------------------------------------------------------------------------------------------
create function pg_temp.test_greffe_approve() returns setof text language plpgsql as $$
declare
  adm uuid := pg_temp.new_admin();
  b uuid := pg_temp.new_member('b@test.local');
  p uuid := pg_temp.pending_photo(b, 1::smallint);
  pending text := (select pending_path from public.photos where id = p);
  large text := gen_random_uuid() || '.webp';
  small text := replace(large, '.webp', '-s.webp');
begin
  perform pg_temp.as_admin(adm);
  return next matches(coalesce(pg_temp.try(format(
    'select public.admin_decide_photo(%L, true, null, %L, %L)', p, b || '/x.webp', small)), 'ok'),
    'invalid_public_path', 'a public path must be a bare random UUID (never the owner id)');
  return next is(pg_temp.val(format('select public.admin_decide_photo(%L, true, null, %L, %L)', p, large, small)),
    pending, 'approval returns the pending file to remove');
  perform pg_temp.as_owner();
  return next is((select status::text || ' ' || public_path_large || ' ' || (pending_path is null)::text
    from public.photos where id = p), 'approved ' || large || ' true', 'the photo is approved, published, no longer pending');
  return next is((select reviewed_by from public.photos where id = p), adm, 'the reviewer is recorded');
  return next is((select type::text || ' ' || (payload ->> 'photo_position') || ' ' || (payload ->> 'approved')
    from public.notifications where user_id = b), 'moderation_decision 1 true', 'the owner is notified for this pose');
  perform pg_temp.as_admin(adm);
  return next matches(coalesce(pg_temp.try(format(
    'select public.admin_decide_photo(%L, false, ''other'')', p)), 'ok'),
    'photo_not_pending', 'a decided photo cannot be decided again');
  perform pg_temp.as_owner();
end $$;

create function pg_temp.test_greffe_reject() returns setof text language plpgsql as $$
declare
  adm uuid := pg_temp.new_admin();
  b uuid := pg_temp.new_member('b@test.local');
  p uuid := pg_temp.pending_photo(b, 0::smallint);
begin
  perform pg_temp.as_admin(adm);
  return next matches(coalesce(pg_temp.try(format('select public.admin_decide_photo(%L, false)', p)), 'ok'),
    'invalid_reason', 'a refusal needs a reason');
  return next matches(coalesce(pg_temp.try(format('select public.admin_decide_photo(%L, false, ''tu es moche'')', p)), 'ok'),
    'invalid_reason', 'only the listed reasons are accepted');
  return next is(pg_temp.try(format('select public.admin_decide_photo(%L, false, ''sunglasses'')', p)), null,
    'refused for sunglasses on the face');
  perform pg_temp.as_owner();
  return next is((select status::text || ' ' || rejection_reason || ' ' || (pending_path is null)::text
    from public.photos where id = p), 'rejected sunglasses true', 'rejected with its reason, pending file released');
  return next is((select payload ->> 'reason' from public.notifications where user_id = b), 'sunglasses',
    'the owner is told why');
end $$;

create function pg_temp.test_greffe_permit_granted() returns setof text language plpgsql as $$
declare
  adm uuid := pg_temp.new_admin();
  v uuid := pg_temp.new_member('v@test.local', 'man', null, 'visitor');
  b uuid := pg_temp.new_member('b@test.local');
  pv uuid := pg_temp.pending_photo(v, 0::smallint);
  pb uuid := pg_temp.pending_photo(b, 0::smallint);
  large text;
begin
  perform pg_temp.as_admin(adm);
  large := gen_random_uuid() || '.webp';
  perform public.admin_decide_photo(pv, true, null, large, replace(large, '.webp', '-s.webp'));
  large := gen_random_uuid() || '.webp';
  perform public.admin_decide_photo(pb, true, null, large, replace(large, '.webp', '-s.webp'));
  perform pg_temp.as_owner();
  return next is((select count(*)::int from public.notifications where user_id = v and type = 'permit_granted'), 1,
    'a Visitor''s face photo delivers the Permis (« PERMIS DÉLIVRÉ »)');
  return next is((select count(*)::int from public.notifications where user_id = b and type = 'permit_granted'), 0,
    'a Bad''s face photo does not');
end $$;

----------------------------------------------------------------------------------------------
-- Notifications: owner only, written by SQL only
----------------------------------------------------------------------------------------------
create function pg_temp.test_notifications_private() returns setof text language plpgsql as $$
declare
  a uuid := pg_temp.new_member('a@test.local');
  b uuid := pg_temp.new_member('b@test.local');
begin
  insert into public.notifications (user_id, type) values (a, 'moderation_decision'), (b, 'moderation_decision');
  perform pg_temp.as_user(a);
  return next is(pg_temp.val('select count(*) from public.notifications'), '1', 'a member reads only their own');
  return next matches(coalesce(pg_temp.try(format(
    'insert into public.notifications (user_id, type) values (%L, ''permit_granted'')', a)), 'ok'),
    '^42501', 'nobody grants themself a Permis through the table');
  return next matches(coalesce(pg_temp.try('update public.notifications set read_at = now()'), 'ok'),
    '^42501', 'no direct update');
  return next is(pg_temp.try('select public.mark_notifications_read()'), null, 'mark as read through the function');
  perform pg_temp.as_owner();
  return next is((select (read_at is not null)::text from public.notifications where user_id = a), 'true', 'own: read');
  return next is((select (read_at is null)::text from public.notifications where user_id = b), 'true',
    'another member''s notification untouched');
end $$;

----------------------------------------------------------------------------------------------
-- The zone counts a Bad only once the 3 poses are validated (PARCOURS-DESIGN §3)
----------------------------------------------------------------------------------------------
create function pg_temp.test_zone_needs_three_approved_poses() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place('Ville test', 47.2, 3.2);
  me uuid := pg_temp.new_member('me@test.local', 'man', ville);
  w uuid := pg_temp.new_member('w@test.local', 'woman', ville);
begin
  insert into public.launch_zones (slug, name, center_place_id, radius_km, threshold_bads)
    values ('test-poses', 'Ville test', ville, 30, 5);
  update public.profiles set onboarding_completed_at = now(), last_seen_at = now() where id = w;
  insert into public.photos (owner_id, position, pending_path)
    select w, p, w || '/' || p || '.webp' from generate_series(0, 2) p;
  update public.photos set status = 'approved' where owner_id = w and position in (0, 1);
  perform pg_temp.as_user(me);
  return next is(pg_temp.val('select bads from public.zone_progress()'), '0', 'two validated poses out of three: not counted');
  perform pg_temp.as_owner();
  update public.photos set status = 'approved' where owner_id = w and position = 2;
  perform pg_temp.as_user(me);
  return next is(pg_temp.val('select bads from public.zone_progress()'), '1', 'the 3 poses validated: counted');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
