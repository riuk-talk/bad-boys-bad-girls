-- 10g, corrections of the advisor (pgTAP, 2026-11-23). 10-50: a new pose waiting for the Greffe
-- never removes the validated one; the Bad stays visible meanwhile; validated, the new one replaces
-- it (no new « Fiche en ligne », no new Permis); refused, the old one stays. 10-52: a photo proposed
-- by the team creates no row in photos before the member's « Accepter », and no « photos en
-- attente » alert to the admins, before or after. Every test_* function runs in its own
-- rolled-back transaction.

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



create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
end $$;

-- A stored file of the Messagerie (as the server would have uploaded it).
create function pg_temp.file(p_member uuid, p_prefix text default '') returns text language plpgsql as $$
declare path text := p_member || '/' || p_prefix || gen_random_uuid() || '.webp';
begin
  insert into storage.objects (bucket_id, name) values ('greffe-mail', path);
  return path;
end $$;

-- A thread of the member, opened by this member of the team, with one message of the team.
create function pg_temp.thread(p_team uuid, p_member uuid) returns uuid language plpgsql as $$
declare t uuid;
begin
  perform pg_temp.as_admin(p_team);
  t := public.admin_messagerie_open(p_member);
  perform public.greffe_send(t, 'Bonjour, ici le Greffe.');
  perform pg_temp.as_owner();
  return t;
end $$;


-- A Bad with its 3 poses validated (its Fiche is online).
create function pg_temp.visible_bad() returns uuid language plpgsql as $$
declare b uuid := pg_temp.new_member('bad', true);
begin
  for i in 0..2 loop
    insert into public.photos (owner_id, position, pending_path) values (b, i, b || '/old' || i || '.webp');
  end loop;
  update public.photos set status = 'approved', pending_path = null, is_cutout = true,
    public_path_large = gen_random_uuid() || '.webp', public_path_small = gen_random_uuid() || '-s.webp'
  where owner_id = b;
  return b;
end $$;

create function pg_temp.decide(p_admin uuid, p_photo uuid, p_approve boolean) returns text language plpgsql as $$
declare name text := gen_random_uuid()::text; reason text := (public.photo_rejection_reasons())[1];
begin
  perform pg_temp.as_admin(p_admin);
  if p_approve then
    perform public.admin_decide_photo(p_photo, true, null, name || '.webp', name || '-s.webp');
  else
    perform public.admin_decide_photo(p_photo, false, reason);
  end if;
  perform pg_temp.as_owner();
  return name;
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_replacement() returns setof text language plpgsql as $$
declare
  greffe uuid := pg_temp.staff(array['greffe.decide']);
  bad uuid := pg_temp.visible_bad();
  old_path text := (select public_path_large from public.photos where owner_id = bad and position = 1);
  fresh uuid;
  name text;
  notices bigint;
begin
  perform pg_temp.as_user(bad);
  insert into public.photos (owner_id, position, pending_path) values (bad, 1, bad || '/new1.webp') returning id into fresh;
  perform pg_temp.as_owner();
  return next is((select count(*)::integer from public.photos where owner_id = bad and position = 1), 2,
    'a new pose waits beside the validated one');
  return next ok(public.has_three_poses(bad, true), 'the Bad stays visible (its 3 validated poses count)');
  return next is((public.public_photos(bad, array[1]::smallint[]) -> 0 ->> 'large'), old_path,
    'the validated photo stays shown');
  -- Refused: the old one stays.
  perform pg_temp.decide(greffe, fresh, false);
  return next is((select public_path_large from public.photos where owner_id = bad and position = 1 and status = 'approved'),
    old_path, 'refused: the validated photo stays');
  return next ok(public.has_three_poses(bad, true), 'and the Bad visible');
  -- A new try (the refused one goes, as the upload does), then validated: it replaces the old one.
  perform pg_temp.as_user(bad);
  delete from public.photos where id = fresh;
  insert into public.photos (owner_id, position, pending_path) values (bad, 1, bad || '/new2.webp') returning id into fresh;
  perform pg_temp.as_owner();
  update public.photos set is_cutout = true where id = fresh;  -- cut out (the poses must be)
  notices := (select count(*) from public.notifications where user_id = bad and type in ('fiche_online', 'dossier_incomplete'));
  name := pg_temp.decide(greffe, fresh, true);
  return next is((select count(*)::integer from public.photos where owner_id = bad and position = 1), 1,
    'validated: one photo left at the position');
  return next is((select public_path_large from public.photos where owner_id = bad and position = 1),
    name || '.webp', 'the new one replaces the old one');
  return next ok(public.has_three_poses(bad, true), 'the Bad is still visible');
  return next is((select count(*) from public.notifications where user_id = bad and type in ('fiche_online', 'dossier_incomplete')),
    notices, 'no new « Fiche en ligne » for a replaced pose');
  -- A second waiting photo at the same position is refused (the upload removes the first).
  perform pg_temp.as_user(bad);
  insert into public.photos (owner_id, position, pending_path) values (bad, 2, bad || '/a.webp');
  return next matches(pg_temp.err(format('insert into public.photos (owner_id, position, pending_path) values (%L, 2, %L)',
    bad, bad || '/b.webp')), 'photos_one_other', 'one waiting photo per position');
  perform pg_temp.as_owner();
end $$;

create function pg_temp.test_permit_kept() returns setof text language plpgsql as $$
declare
  greffe uuid := pg_temp.staff(array['greffe.decide']);
  visitor uuid := pg_temp.new_member('visitor', true);
  first uuid;
  second uuid;
begin
  perform pg_temp.as_user(visitor);
  insert into public.photos (owner_id, position, pending_path) values (visitor, 0, visitor || '/a.webp') returning id into first;
  perform pg_temp.as_owner();
  update public.photos set is_cutout = true where id = first;
  perform pg_temp.decide(greffe, first, true);
  return next ok(public.has_permit(visitor), 'a Visitor with the Permis delivered');
  perform pg_temp.as_user(visitor);
  insert into public.photos (owner_id, position, pending_path) values (visitor, 0, visitor || '/b.webp') returning id into second;
  perform pg_temp.as_owner();
  return next ok(public.has_permit(visitor), 'keeps it while a new face photo waits');
  update public.photos set is_cutout = true where id = second;
  perform pg_temp.decide(greffe, second, true);
  return next is((select count(*)::integer from public.notifications where user_id = visitor and type = 'permit_granted'), 1,
    'the Permis is not delivered twice');
  return next ok(public.has_permit(visitor), 'and keeps it after');
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_proposal_no_row() returns setof text language plpgsql as $$
declare
  team uuid := pg_temp.staff(array['members.message']);
  watcher uuid := pg_temp.new_member('bad', true);
  bad uuid := pg_temp.new_member('bad', true);
  t uuid;
  large text;
  proposal uuid;
  alerts bigint;
begin
  -- An admin account the « photos en attente » e-mail goes to.
  insert into public.admin_users (user_id, role_id) values (watcher, 2);
  delete from public.email_outbox where kind = 'admin_photos_pending';
  perform pg_temp.as_admin(team);
  t := public.admin_messagerie_open(bad);
  perform pg_temp.as_owner();
  large := bad || '/proposal-' || gen_random_uuid() || '.webp';
  insert into storage.objects (bucket_id, name) values ('greffe-mail', large),
    ('greffe-mail', regexp_replace(large, '\.webp$', '-s.webp'));
  perform pg_temp.as_admin(team);
  proposal := public.greffe_propose_photo(t, 2::smallint, large, regexp_replace(large, '\.webp$', '-s.webp'), 900, 1200);
  perform pg_temp.as_owner();
  return next is((select count(*)::integer from public.photos where owner_id = bad), 0,
    'a proposal creates no photo before the member''s answer');
  return next is((select count(*)::integer from public.email_outbox where kind = 'admin_photos_pending'), 0,
    'nor any « photos en attente » alert');
  perform pg_temp.as_user(bad);
  perform public.greffe_decide_photo_proposal(proposal, true);
  perform pg_temp.as_owner();
  return next is((select count(*)::integer from public.photos where owner_id = bad), 0,
    'accepted but not yet applied: still no photo');
  large := gen_random_uuid()::text;
  perform pg_temp.as_service();
  perform public.greffe_apply_photo_proposal(proposal, large || '.webp', large || '-s.webp');
  perform pg_temp.as_owner();
  return next is((select status::text || '/' || public_path_large from public.photos where owner_id = bad and position = 2),
    'approved/' || large || '.webp', 'applied: inserted validated');
  return next is((select count(*)::integer from public.email_outbox where kind = 'admin_photos_pending'), 0,
    'no « photos en attente » alert after either');
  -- A real deposit still raises it.
  perform pg_temp.as_user(bad);
  insert into public.photos (owner_id, position, pending_path) values (bad, 0, bad || '/face.webp');
  perform pg_temp.as_owner();
  return next ok((select count(*) from public.email_outbox where kind = 'admin_photos_pending') > 0,
    'a deposit waiting for the Greffe still raises the alert');
end $$;

select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
