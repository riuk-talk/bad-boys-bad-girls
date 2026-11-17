-- Phase 10f-bis (pgTAP, owner's request 2026-11-17): « Voir comme un Bad ». admin_view_visitors
-- lists every Visitor whose Permis is delivered, with filters gender, age, quartier; it asks for
-- vue_bad.view (ticked for the three starting roles) and the second factor; it writes nothing
-- about the Visitors but the Greffe's log (one line per Permis shown, context « vue_bad »); it
-- never gives a Visitor's search criteria. admin_zone_names gives the quartiers' names to the two
-- views without zones.edit. Every test_* function runs in its own rolled-back transaction.

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


create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- An admin account (no member profile) holding a role with exactly these permissions.
create function pg_temp.staff(p_permissions text[]) returns uuid language plpgsql as $$
declare u uuid := pg_temp.new_user(); r smallint;
begin
  insert into public.admin_roles (name) values ('Rôle ' || substr(md5(random()::text), 1, 8)) returning id into r;
  insert into public.admin_role_permissions (role_id, permission) select r, x from unnest(p_permissions) x;
  insert into public.admin_users (user_id, role_id) values (u, r);
  return u;
end $$;

create function pg_temp.super_admin() returns uuid language plpgsql as $$
declare u uuid := pg_temp.new_user();
begin
  insert into public.super_admins (user_id) values (u);
  return u;
end $$;


-- A Visitor with its Permis delivered (face photo validated), aged 30 unless told otherwise.
create function pg_temp.permit_visitor(p_gender public.gender default 'man', p_years integer default 30)
returns uuid language plpgsql as $$
declare v uuid := pg_temp.new_member('visitor', true, p_gender, (current_date - make_interval(years => p_years, months => 2))::date);
begin
  insert into public.photos (owner_id, position, pending_path) values (v, 0, v || '/0.webp');
  update public.photos set status = 'approved', pending_path = null, is_cutout = true,
    public_path_large = gen_random_uuid() || '.webp', public_path_small = gen_random_uuid() || '-s.webp'
  where owner_id = v;
  return v;
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_rights() returns setof text language plpgsql as $$
declare
  viewer uuid := pg_temp.staff(array['vue_bad.view']);
  other uuid := pg_temp.staff(array['vue_visiteur.view']);
  nothing uuid := pg_temp.staff(array['dashboard.view']);
  member uuid := pg_temp.new_member('bad', true);
  call text := 'select * from public.admin_view_visitors()';
begin
  perform pg_temp.as_anon();
  return next matches(pg_temp.err(call), '^42501', 'anonymous refused');
  perform pg_temp.as_owner();
  perform pg_temp.as_user(member);
  return next matches(pg_temp.err(call), '^42501 admin_only', 'a Bad refused');
  perform pg_temp.as_owner();
  perform pg_temp.as_user(viewer);
  return next matches(pg_temp.err(call), '^42501 admin_only', 'without the second factor: refused');
  perform pg_temp.as_owner();
  perform pg_temp.as_admin(other);
  return next matches(pg_temp.err(call), '^42501 admin_only', 'the Visitor view alone does not open it');
  return next is(pg_temp.err('select * from public.admin_zone_names()'), 'ok', 'but gives the quartiers'' names');
  perform pg_temp.as_owner();
  perform pg_temp.as_admin(viewer);
  return next is(pg_temp.err(call), 'ok', 'with vue_bad.view: allowed');
  return next is(pg_temp.err('select * from public.admin_zone_names()'), 'ok', 'and the quartiers'' names');
  perform pg_temp.as_owner();
  perform pg_temp.as_admin(nothing);
  return next matches(pg_temp.err('select * from public.admin_zone_names()'), '^42501 admin_only',
    'no view, no quartiers'' names');
  perform pg_temp.as_owner();
  return next is((select array_agg(r.role_id order by r.role_id) from public.admin_role_permissions r
                  where r.permission = 'vue_bad.view' and r.role_id <= 3), array[1, 2, 3]::smallint[],
    'ticked for Admin, Modérateur and Observateur');
  return next ok(not exists (select 1 from pg_proc p, unnest(p.proargnames) a
                             where p.proname = 'admin_view_visitors' and a ~* 'seek|criteria'),
    'it never gives the Visitor''s search criteria');
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_list_filters_log() returns setof text language plpgsql as $$
declare
  viewer uuid := pg_temp.staff(array['vue_bad.view']);
  him uuid := pg_temp.permit_visitor('man', 30);
  her uuid := pg_temp.permit_visitor('woman', 52);
  waiting uuid := pg_temp.new_member('visitor', true);
  bad uuid := pg_temp.new_member('bad', true);
  staff_visitor uuid := pg_temp.permit_visitor('man', 31);
  ids uuid[];
  before_notifications bigint := (select count(*) from public.notifications);
  zone smallint;
begin
  insert into public.admin_users (user_id, role_id) values (staff_visitor, 3);
  perform pg_temp.as_admin(viewer);
  select array_agg(v.id) into ids from public.admin_view_visitors() v;
  perform pg_temp.as_owner();
  return next ok(him = any (ids) and her = any (ids), 'every Visitor with a Permis delivered');
  return next ok(not (waiting = any (ids)), 'not a Visitor whose photo is not validated');
  return next ok(not (bad = any (ids)), 'never a Bad');
  return next ok(not (staff_visitor = any (ids)), 'nor an account with a role');
  return next is((select count(*)::integer from public.greffe_fiche_views
                  where admin_id = viewer and context = 'vue_bad' and bad_id in (him, her)), 2,
    'each Permis shown is logged in the Greffe''s log');
  return next is((select count(*) from public.notifications), before_notifications, 'nothing written about the Visitors');
  perform pg_temp.as_admin(viewer);
  return next ok((select bool_and(v.gender = 'woman') from public.admin_view_visitors(p_gender => 'woman') v)
                 and exists (select 1 from public.admin_view_visitors(p_gender => 'woman') v where v.id = her),
    'filter: gender');
  return next ok(exists (select 1 from public.admin_view_visitors(p_age_min => 50, p_age_max => 55) v where v.id = her)
                 and not exists (select 1 from public.admin_view_visitors(p_age_min => 50, p_age_max => 55) v where v.id = him),
    'filter: age');
  perform pg_temp.as_owner();
  insert into public.places (official_code, name, lat, lng) values ('VB' || substr(md5(random()::text), 1, 6), 'Centre VB', 44.9, 2.1);
  insert into public.launch_zones (slug, name, center_place_id, radius_km, status)
  values ('vb-' || substr(md5(random()::text), 1, 6), 'Quartier VB', (select id from public.places where name = 'Centre VB'), 10, 'waitlist')
  returning id into zone;
  update public.profiles set place_id = (select id from public.places where name = 'Centre VB') where id = him;
  perform pg_temp.as_admin(viewer);
  return next is((select array_agg(v.id) from public.admin_view_visitors(p_zone => zone) v), array[him],
    'filter: quartier (whether it is open or not)');
  return next is((select v.zone_name from public.admin_view_visitors(p_zone => zone) v), 'Quartier VB', 'with its name');
  perform pg_temp.as_owner();
end $$;

select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
