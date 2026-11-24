-- Phase 10f (pgTAP, owner's request 2026-11-17): administration roles. Every admin function asks
-- for its own permission (refused without the box, granted with it), the second factor stays
-- required, the super admin has everything, only it manages the team (team.manage is never a
-- role's), the team's changes are logged; a member account with a role leaves the site as a member
-- and gets its profile back as it was. Every test_* function runs in its own rolled-back
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

create function pg_temp.calls() returns table (call text, permission text) language sql as $$
  select * from (values
    ($c$select * from public.admin_dashboard()$c$, 'dashboard.view'),
    ($c$select * from public.admin_find_members('ab')$c$, 'members.view'),
    ($c$select * from public.admin_search_members('ab')$c$, 'members.view'),
    ($c$select * from public.admin_list_members()$c$, 'members.view'),
    ($c$select * from public.admin_unconfirmed_accounts()$c$, 'members.view'),
    ($c$select * from public.admin_member(gen_random_uuid())$c$, 'members.detail'),
    ($c$select * from public.admin_member_detail(gen_random_uuid())$c$, 'members.detail'),
    ($c$select * from public.admin_view_discover()$c$, 'vue_visiteur.view'),
    ($c$select * from public.admin_view_fiche(gen_random_uuid())$c$, 'vue_visiteur.view'),
    ($c$select * from public.admin_view_promenade(1::smallint)$c$, 'vue_visiteur.view'),
    ($c$select * from public.admin_photo_queue(1)$c$, 'greffe.decide'),
    ($c$select * from public.admin_decide_photo(gen_random_uuid(), false, 'other')$c$, 'greffe.decide'),
    ($c$select * from public.admin_approve_without_cutout(gen_random_uuid(), 'other', 'x', 'a', 'b')$c$, 'greffe.decide'),
    ($c$select * from public.admin_waive_cutout(gen_random_uuid(), 'other', 'x')$c$, 'greffe.decide'),
    ($c$select * from public.admin_photo_batch(1)$c$, 'greffe.decide'),
    ($c$select * from public.admin_photo_cutouts(array[gen_random_uuid()])$c$, 'greffe.decide'),
    ($c$select * from public.admin_photos_to_cut_out(array[gen_random_uuid()])$c$, 'greffe.decide'),
    ($c$select * from public.admin_store_cutout(gen_random_uuid(), 'x/y.webp')$c$, 'greffe.decide'),
    ($c$select * from public.admin_replace_public_photo(gen_random_uuid(), 'a', 'b')$c$, 'greffe.decide'),
    ($c$select * from public.admin_report_queue(1)$c$, 'reports.decide'),
    ($c$select * from public.admin_decide_report(-1, false, 'Motif de test')$c$, 'reports.decide'),
    ($c$select * from public.admin_flag_queue(1)$c$, 'flags.decide'),
    ($c$select * from public.admin_decide_flag(-1, 'clear', null)$c$, 'flags.decide'),
    ($c$select * from public.admin_keywords()$c$, 'keywords.edit'),
    ($c$select * from public.admin_save_keyword('zzz', 'fr', 'other', true, -1)$c$, 'keywords.edit'),
    ($c$select * from public.admin_sanction(gen_random_uuid(), 'warn', 'Motif de test', null)$c$, 'sanctions.apply'),
    ($c$select * from public.admin_birthdate_corrections()$c$, 'birthdate.decide'),
    ($c$select * from public.admin_decide_birthdate_correction(-1, true, null)$c$, 'birthdate.decide'),
    ($c$select * from public.admin_zones()$c$, 'zones.edit'),
    ($c$select * from public.admin_set_zone_status(-1::smallint, 'open')$c$, 'zones.edit'),
    ($c$select * from public.admin_zone_health(1::smallint, current_date, current_date)$c$, 'zones.edit'),
    ($c$select * from public.admin_launch_mode()$c$, 'zones.edit'),
    ($c$select * from public.admin_questions()$c$, 'questions.edit'),
    ($c$select * from public.admin_save_question(-1::smallint, 'a', 'b', true, '[]'::jsonb)$c$, 'questions.edit'),
    ($c$select * from public.admin_tribes()$c$, 'signs.edit'),
    ($c$select * from public.admin_save_tribe('zz', 'a', 'b', 1::smallint, true, -1::smallint)$c$, 'signs.edit'),
    ($c$select * from public.admin_web_vitals(7)$c$, 'performance.view'),
    ($c$select * from public.admin_moderation_log(1)$c$, 'history.view'),
    ($c$select * from public.admin_team_history(1)$c$, 'history.view')
  ) v (call, permission)
$$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_each_permission() returns setof text language plpgsql as $$
declare
  c record;
  everything text[] := (select array_agg(key) from public.admin_permissions where key <> 'team.manage');
  with_it uuid;
  without_it uuid;
begin
  for c in select * from pg_temp.calls() loop
    with_it := pg_temp.staff(array[c.permission]);
    without_it := pg_temp.staff(array_remove(everything, c.permission));
    perform pg_temp.as_admin(without_it);
    return next matches(pg_temp.err(c.call), '^42501 admin_only',
      format('without %s: refused (%s)', c.permission, c.call));
    perform pg_temp.as_owner();
    perform pg_temp.as_admin(with_it);
    return next unalike(pg_temp.err(c.call), '42501 admin_only%',
      format('with %s only: allowed (%s)', c.permission, c.call));
    perform pg_temp.as_owner();
    -- The second factor stays required.
    perform pg_temp.as_user(with_it);
    return next matches(pg_temp.err(c.call), '^42501 admin_only',
      format('with %s but without the second factor: refused', c.permission));
    perform pg_temp.as_owner();
  end loop;
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_combined_permissions() returns setof text language plpgsql as $$
declare
  judge uuid := pg_temp.staff(array['reports.decide', 'flags.decide']);
  target uuid := pg_temp.new_member('bad', true);
  reporter uuid := pg_temp.new_member('visitor', true);
  rep bigint;
  flag bigint;
begin
  insert into public.reports (reporter_id, target_type, target_id, target_user_id, category, comment)
  values (reporter, 'profile', target::text, target, 'other', 'Test') returning id into rep;
  insert into public.flagged_texts (user_id, source, source_id, excerpt, matched_terms)
  values (target, 'bio', target::text, 'texte', '{x}') returning id into flag;
  perform pg_temp.as_admin(judge);
  return next matches(pg_temp.err(format('select public.admin_decide_report(%s, true, %L, %L, %L)', rep, 'Motif retenu', 'warn', 'Motif pour la cible')),
    '^42501 admin_only', 'upholding a report sanctions: sanctions.apply needed too');
  return next matches(pg_temp.err(format('select public.admin_decide_flag(%s, %L, %L)', flag, 'remove', 'Texte effacé')),
    '^42501 admin_only', 'erasing a member''s text: texts.edit needed too');
  return next is(pg_temp.err(format('select public.admin_decide_flag(%s, %L, null)', flag, 'clear')), 'ok',
    '« Rien à signaler » with flags.decide alone');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_super_admin_and_permissions_list() returns setof text language plpgsql as $$
declare
  boss uuid := pg_temp.super_admin();
  watcher uuid := pg_temp.new_user();
  c record;
begin
  insert into public.admin_users (user_id, role_id) values (watcher, 3);
  perform pg_temp.as_admin(boss);
  for c in select * from pg_temp.calls() loop
    return next unalike(pg_temp.err(c.call), '42501 admin_only%', 'the super admin may: ' || c.call);
  end loop;
  return next is(cardinality(public.my_admin_permissions()), 20, 'the super admin has the 20 permissions');
  perform pg_temp.as_owner();
  perform pg_temp.as_admin(watcher);
  return next is(public.my_admin_permissions(),
    array['dashboard.view', 'members.view', 'members.detail', 'vue_visiteur.view', 'history.view', 'vue_bad.view'],
    'Observateur: read only');
  perform pg_temp.as_owner();
  perform pg_temp.as_user(watcher);
  return next is(public.my_admin_permissions(), '{}'::text[], 'nothing before the second factor');
  perform pg_temp.as_owner();
  return next is((select array_agg(permission order by permission) from public.admin_role_permissions where role_id = 2),
    array['birthdate.decide', 'dashboard.view', 'flags.decide', 'greffe.decide', 'keywords.edit', 'members.detail',
          'members.message', 'members.view', 'reports.decide', 'sanctions.apply', 'texts.edit', 'vue_bad.view', 'vue_visiteur.view'],
    'Modérateur as asked');
  return next is((select count(*)::integer from public.admin_role_permissions where role_id = 1), 19,
    'Admin: everything but team.manage');
  return next matches(pg_temp.err('insert into public.admin_role_permissions (role_id, permission) values (1, ''team.manage'')'),
    '^23514', 'team.manage can never be given to a role');
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_team() returns setof text language plpgsql as $$
declare
  boss uuid := pg_temp.super_admin();
  admin_role uuid := pg_temp.new_user();
  coco uuid := pg_temp.new_member('visitor', true);
  coco_mail text;
  coco_pseudo text;
  boss_mail text := (select email from auth.users where id = boss);
  custom smallint;
  -- Only the lines this test writes (the log keeps those of earlier runs: it is append-only).
  log_start bigint := coalesce((select max(id) from public.admin_team_log), 0);
  calls text[] := array[
    'select * from public.admin_roles_list()', 'select * from public.admin_permission_keys()',
    'select * from public.admin_team()', 'select public.admin_grant_role(''x@y.z'', 1::smallint)',
    'select public.admin_revoke_role(gen_random_uuid())',
    'select public.admin_save_role(p_name => ''Nouveau'', p_permissions => ''{}'')',
    'select public.admin_delete_role(99::smallint)'];
  c text;
begin
  insert into public.admin_users (user_id, role_id) values (admin_role, 1);
  select email into coco_mail from auth.users where id = coco;
  select pseudo::text into coco_pseudo from public.profiles where id = coco;
  -- Only the super admin: even the Admin role (every other permission) is refused.
  foreach c in array calls loop
    perform pg_temp.as_admin(admin_role);
    return next matches(pg_temp.err(c), '^42501 admin_only', 'Admin role refused: ' || c);
    perform pg_temp.as_owner();
    perform pg_temp.as_anon();
    return next matches(pg_temp.err(c), '^42501', 'anonymous refused: ' || c);
    perform pg_temp.as_owner();
  end loop;

  perform pg_temp.as_admin(boss);
  return next is(public.admin_grant_role(upper(coco_mail), 3::smallint), coco, 'a role given by exact e-mail (any case)');
  return next matches(pg_temp.err(format('select public.admin_grant_role(%L, 3::smallint)', substr(coco_mail, 2))),
    '^P0002', 'never by a part of the e-mail');
  return next is(public.admin_grant_role(coco_pseudo, 2::smallint), coco, 'changed by exact pseudo');
  perform pg_temp.as_owner();
  return next is((select role_id from public.admin_users where user_id = coco), 2::smallint, 'now Modérateur');
  perform pg_temp.as_admin(boss);
  return next matches(pg_temp.err(format('select public.admin_grant_role(%L, 1::smallint)', boss_mail)),
    '^42501 super_admin_protected', 'the super admin cannot be given a role');
  return next matches(pg_temp.err(format('select public.admin_revoke_role(%L)', boss)),
    '^42501 super_admin_protected', 'nor taken out');
  custom := public.admin_save_role(p_name => 'Lecteur Greffe', p_description => 'Le Greffe seulement',
    p_permissions => array['greffe.decide', 'dashboard.view']);
  return next is((select permissions from public.admin_roles_list() where id = custom),
    array['dashboard.view', 'greffe.decide'], 'a custom role with its boxes');
  return next matches(pg_temp.err(format('select public.admin_save_role(p_role => %s::smallint, p_name => %L, p_permissions => %L)', custom, 'Lecteur Greffe', '{team.manage}')),
    '^42501 team_manage_reserved', 'team.manage cannot be ticked');
  return next matches(pg_temp.err('select public.admin_save_role(p_name => ''Admin'', p_permissions => ''{}'')'),
    '^23505 role_name_taken', 'two roles never share a name');
  perform public.admin_save_role(p_role => custom, p_name => 'Greffier', p_permissions => array['greffe.decide']);
  perform pg_temp.as_owner();
  return next is((select name from public.admin_roles where id = custom), 'Greffier', 'renamed, boxes changed');
  perform pg_temp.as_admin(boss);
  perform public.admin_grant_role(coco_pseudo, custom);
  return next matches(pg_temp.err(format('select public.admin_delete_role(%s::smallint)', custom)),
    '^23503 role_in_use', 'a role still held cannot be deleted');
  perform public.admin_revoke_role(coco);
  perform public.admin_delete_role(custom);
  perform pg_temp.as_owner();
  return next is((select count(*)::integer from public.admin_roles where id = custom), 0, 'an empty role is deleted');
  return next is((select array_agg(action order by id) from public.admin_team_log where id > log_start),
    array['grant', 'change_role', 'role_create', 'role_update', 'change_role', 'revoke', 'role_delete'],
    'every change of the team is logged');
  return next is((select before -> 'permissions' from public.admin_team_log where action = 'role_update' and id > log_start),
    '["dashboard.view", "greffe.decide"]'::jsonb, 'with the state before');
  return next is((select after ->> 'name' from public.admin_team_log where action = 'role_update' and id > log_start), 'Greffier',
    'and after');
  return next ok((select bool_and(actor_id = boss) from public.admin_team_log where id > log_start), 'who did it');
  return next matches(pg_temp.err('delete from public.admin_team_log'), '^42501', 'the log cannot be erased');
  -- Historique reads it.
  perform pg_temp.as_admin(boss);
  return next is((select count(*)::integer from public.admin_team_history(500) h where h.id > log_start), 7, 'Historique shows the team log');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
-- A member account given a role leaves the site as a member, and comes back as it was.
create function pg_temp.test_member_with_a_role() returns setof text language plpgsql as $$
declare
  boss uuid := pg_temp.super_admin();
  coco uuid := pg_temp.new_member('visitor', true);
  bad uuid := pg_temp.new_member('bad', true);
  hidden uuid := pg_temp.new_member('visitor', true);
  req uuid;
  coco_pseudo text := (select pseudo::text from public.profiles where id = coco);
begin
  insert into public.visit_requests (visitor_id, bad_id, guessed_index, casier_snapshot, guess_correct)
  values (coco, bad, 1, '{}'::jsonb, false) returning id into req;
  perform pg_temp.as_admin(boss);
  perform public.admin_grant_role(coco_pseudo, 3::smallint);
  perform pg_temp.as_owner();
  return next is((select hidden_reason from public.profiles where id = coco), 'staff', 'the profile is withdrawn');
  return next ok(not (select public.is_member_active(p) from public.profiles p where p.id = coco),
    'the account is not an active member any more');
  return next is((select status::text || '/' || close_reason::text from public.visit_requests where id = req),
    'closed/staff_role', 'its requests are closed');
  -- The guard: nothing makes it a member again while it has the role.
  update public.profiles set hidden_reason = null where id = coco;
  return next is((select hidden_reason from public.profiles where id = coco), 'staff',
    'not even an update of its profile');
  perform pg_temp.as_user(coco);
  return next matches(pg_temp.err(format('select public.send_visit_request(%L, 1::smallint, null)', bad)), '^42501',
    'it cannot send a request');
  return next matches(pg_temp.err('select * from public.discover_bads()'), '^42501', 'nor open the Découverte');
  perform pg_temp.as_owner();
  -- The role taken back: the profile as it was.
  perform pg_temp.as_admin(boss);
  perform public.admin_revoke_role(coco);
  perform pg_temp.as_owner();
  return next is((select hidden_reason from public.profiles where id = coco), null, 'the role taken back: the profile is back');
  return next ok((select public.is_member_active(p) from public.profiles p where p.id = coco), 'an active member again');
  -- A profile hidden by the moderation stays hidden after the role.
  update public.profiles set hidden_reason = 'moderation' where id = hidden;
  insert into public.admin_users (user_id, role_id) values (hidden, 3);
  return next is((select hidden_reason from public.profiles where id = hidden), 'staff', 'withdrawn while it has a role');
  delete from public.admin_users where user_id = hidden;
  return next is((select hidden_reason from public.profiles where id = hidden), 'moderation',
    'and hidden by the moderation again afterwards, as before');
end $$;

select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
