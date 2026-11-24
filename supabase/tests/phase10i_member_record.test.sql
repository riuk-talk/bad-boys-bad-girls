-- Phase 10i (pgTAP, owner's request 2026-11-24): the full member record. admin_member_extra asks
-- members.detail and the second factor (birth date, N° d'écrou, role, Interrogatoire, activity,
-- settings); admin_member_email asks members.email (Admin and the super admin only), logs each
-- showing, and shows nothing of an account without a profile; never the true charge of a Casier
-- (règle 14), not even to the super admin. Every test_* function runs in its own rolled-back
-- transaction.

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


----------------------------------------------------------------------------------------------
create function pg_temp.test_rights() returns setof text language plpgsql as $$
declare
  detail uuid := pg_temp.staff(array['members.detail']);
  viewer uuid := pg_temp.staff(array['members.view']);
  member uuid := pg_temp.new_member('bad', true);
  other uuid := pg_temp.new_member('visitor', true);
begin
  perform pg_temp.as_anon();
  return next matches(pg_temp.err(format('select public.admin_member_extra(%L)', member)), '^42501', 'anonymous: refused');
  return next matches(pg_temp.err(format('select public.admin_member_email(%L)', member)), '^42501', 'anonymous: no e-mail');
  perform pg_temp.as_owner();
  perform pg_temp.as_user(other);
  return next matches(pg_temp.err(format('select public.admin_member_extra(%L)', member)), '^42501', 'a member: refused');
  perform pg_temp.as_owner();
  perform pg_temp.as_user(detail);
  return next matches(pg_temp.err(format('select public.admin_member_extra(%L)', member)), '^42501',
    'without the second factor: refused');
  perform pg_temp.as_owner();
  perform pg_temp.as_admin(viewer);
  return next matches(pg_temp.err(format('select public.admin_member_extra(%L)', member)), '^42501 admin_only',
    'members.view alone does not open the record');
  perform pg_temp.as_owner();
  perform pg_temp.as_admin(detail);
  return next is(pg_temp.err(format('select public.admin_member_extra(%L)', member)), 'ok', 'members.detail opens it');
  return next matches(pg_temp.err(format('select public.admin_member_email(%L)', member)), '^42501 admin_only',
    'but not the e-mail without members.email');
  perform pg_temp.as_owner();
  return next is((select array_agg(r.role_id order by r.role_id) from public.admin_role_permissions r
                  where r.permission = 'members.email' and r.role_id <= 3), array[1]::smallint[],
    'members.email: ticked for Admin only (not Modérateur, not Observateur)');
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_email() returns setof text language plpgsql as $$
declare
  admin_role uuid := pg_temp.new_user();
  boss uuid := pg_temp.super_admin();
  moderator uuid := pg_temp.new_user();
  member uuid := pg_temp.new_member('bad', true);
  no_profile uuid := pg_temp.new_user('sans-profil@test.local');
  address text;
begin
  address := (select email from auth.users where id = member);
  insert into public.admin_users (user_id, role_id) values (admin_role, 1), (moderator, 2);
  perform pg_temp.as_admin(moderator);
  return next matches(pg_temp.err(format('select public.admin_member_email(%L)', member)), '^42501',
    'the Modérateur: no e-mail');
  perform pg_temp.as_owner();
  perform pg_temp.as_admin(admin_role);
  return next is(public.admin_member_email(member), address,
    'the Admin: the e-mail, on request');
  perform pg_temp.as_owner();
  perform pg_temp.as_admin(boss);
  perform public.admin_member_email(member);
  return next matches(pg_temp.err(format('select public.admin_member_email(%L)', no_profile)), '^P0002',
    'no showing for an account without a profile (it could not be logged)');
  perform pg_temp.as_owner();
  return next is((select count(*)::integer from public.greffe_fiche_views where bad_id = member and context = 'email'), 2,
    'each showing is logged (Admin, super admin)');
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_content() returns setof text language plpgsql as $$
declare
  detail uuid := pg_temp.staff(array['members.detail']);
  boss uuid := pg_temp.super_admin();
  bad uuid := pg_temp.new_member('bad', true);
  visitor uuid := pg_temp.new_member('visitor', true);
  q smallint := (select id from public.questions order by position limit 1);
  opts smallint[] := (select array_agg(id order by position) from public.question_options where question_id = q);
  extra jsonb;
  detail_json jsonb;
begin
  insert into public.answers (user_id, question_id, option_id, accepted_option_ids, importance)
  values (bad, q, opts[1], array[opts[1], opts[2]], 'essential');
  insert into public.casier_charges (profile_id, charge_1, charge_2, charge_3, true_index)
  values (bad, 'Vol de lune', 'Excès de charme', 'Retard chronique', 3);
  insert into public.visit_requests (visitor_id, bad_id, guessed_index, casier_snapshot, guess_correct)
  values (visitor, bad, 1, '{}', false);
  insert into public.blocks (blocker_id, blocked_id) values (visitor, bad);
  insert into public.reports (reporter_id, target_user_id, target_type, target_id, category)
  values (visitor, bad, 'profile', bad::text, 'other');
  insert into public.moderation_actions (target_user_id, action, reason) values (bad, 'warn', 'Un rappel');
  update public.profiles set is_paused = true, paused_at = now(), referral_code = 'ABCD1234' where id = bad;
  insert into public.notification_preferences (user_id) values (bad) on conflict do nothing;
  perform pg_temp.as_admin(detail);
  extra := public.admin_member_extra(bad);
  perform pg_temp.as_owner();
  return next is(extra ->> 'birthdate', (select birthdate::text from public.profiles where id = bad), 'the exact date of birth');
  return next is(extra ->> 'ecrou', (select ecrou::text from public.profiles where id = bad), 'the N° d''écrou');
  return next ok(extra ? 'role_changed_at' and extra ->> 'role' = 'bad', 'the role and the date of its last change');
  return next is(extra -> 'answers' -> 0 ->> 'importance', 'essential', 'the Interrogatoire: the importance');
  return next is(jsonb_array_length(extra -> 'answers' -> 0 -> 'accepted'), 2, 'the answers accepted');
  return next ok((extra -> 'answers' -> 0 -> 'question') ? 'fr' and (extra -> 'answers' -> 0 -> 'answer') ? 'fr',
    'the question and the answer given');
  return next is((extra -> 'activity' -> 'received' ->> 'pending')::integer, 1, 'requests received, by status');
  return next is(extra -> 'activity' -> 'last_requests' -> 0 ->> 'direction', 'received', 'the last requests');
  return next is((extra -> 'activity' ->> 'blocks_received')::integer, 1, 'blocks received');
  return next is((extra -> 'activity' ->> 'reports_received')::integer, 1, 'reports received');
  return next is(extra -> 'activity' -> 'sanctions' -> 0 ->> 'action', 'warn', 'the sanctions');
  return next ok((extra -> 'settings' ->> 'paused')::boolean and extra -> 'settings' ->> 'paused_at' is not null,
    'the pause, since when');
  return next is(extra -> 'settings' ->> 'referral_code', 'ABCD1234', 'the referral code');
  return next ok(not ((extra -> 'settings' -> 'notifications') ? 'unsubscribe_token'), 'never the unsubscribe token');
  -- Règle 14: never which charge is true, for any reader.
  return next ok(position('true_index' in extra::text) = 0, 'the extra record never holds true_index');
  perform pg_temp.as_admin(boss);
  detail_json := public.admin_member_detail(bad);
  extra := public.admin_member_extra(bad);
  perform pg_temp.as_owner();
  return next ok(position('true_index' in detail_json::text) = 0 and position('true_index' in extra::text) = 0,
    'not even for the super admin');
  return next is(detail_json -> 'casier', '["Vol de lune", "Excès de charme", "Retard chronique"]'::jsonb,
    'the Casier in its order, nothing marked');
end $$;

select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
