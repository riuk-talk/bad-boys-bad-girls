-- Phase 10g (pgTAP, owner's request 2026-11-22): the Messagerie du Greffe. One thread per member,
-- written by the team (members.message, second factor), answered by its member while open, read by
-- no one else; messages never edited nor deleted; images of the thread's own folder only, readable
-- by its readers; a retouched photo replaces a pose only after the member's « Accepter »; a message
-- of the team can be reported (super admin's queue); retention; export. Every test_* function runs
-- in its own rolled-back transaction.

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

----------------------------------------------------------------------------------------------
create function pg_temp.test_rights() returns setof text language plpgsql as $$
declare
  team uuid := pg_temp.staff(array['members.message']);
  observer uuid := pg_temp.staff(array['members.view', 'members.detail']);
  member uuid := pg_temp.new_member('bad', true);
  other uuid := pg_temp.new_member('visitor', true);
  t uuid := pg_temp.thread(team, member);
begin
  return next is((select array_agg(r.role_id order by r.role_id) from public.admin_role_permissions r
                  where r.permission = 'members.message' and r.role_id <= 3), array[1, 2]::smallint[],
    'members.message: ticked for Admin and Modérateur, not for Observateur');
  perform pg_temp.as_anon();
  return next matches(pg_temp.err('select * from public.admin_messagerie_threads()'), '^42501', 'anonymous: no list');
  return next matches(pg_temp.err('select count(*) from public.greffe_messages'), '^42501', 'anonymous: no table');
  perform pg_temp.as_owner();
  perform pg_temp.as_user(team);
  return next matches(pg_temp.err(format('select public.admin_messagerie_open(%L)', other)), '^42501 admin_only',
    'the team without the second factor: refused');
  perform pg_temp.as_owner();
  perform pg_temp.as_admin(observer);
  return next matches(pg_temp.err(format('select public.admin_messagerie_open(%L)', other)), '^42501 admin_only',
    'a role without members.message cannot open a thread');
  return next matches(pg_temp.err(format('select public.admin_messagerie_thread(%L)', t)), '^42501 admin_only',
    'nor read one');
  return next is((select count(*)::integer from public.greffe_messages), 0, 'nor see its messages');
  perform pg_temp.as_owner();
  perform pg_temp.as_user(member);
  return next matches(pg_temp.err(format('select public.admin_messagerie_open(%L)', member)), '^42501',
    'a member cannot open a thread');
  return next matches(pg_temp.err(format('insert into public.greffe_threads (member_id, opened_by) values (%L, %L)', member, member)),
    '^42501', 'nor write one in the table');
  return next matches(pg_temp.err(format('insert into public.greffe_messages (thread_id, author_id, side, body) values (%L, %L, ''member'', ''x'')', t, member)),
    '^42501', 'nor a message');
  return next is((select count(*)::integer from public.greffe_messages), 1, 'the member reads their own thread');
  perform pg_temp.as_owner();
  perform pg_temp.as_user(other);
  return next is((select count(*)::integer from public.greffe_messages), 0, 'another member reads nothing of it');
  return next is((select count(*)::integer from public.greffe_threads), 0, 'nor the thread');
  return next matches(pg_temp.err(format('select public.greffe_messages_since(%L, 0)', t)), '^P0002', 'nor by the function');
  return next matches(pg_temp.err(format('select public.greffe_send(%L, ''intrus'')', t)), '^P0002', 'and cannot write in it');
  return next is(public.greffe_my_thread(), null, 'their own Courrier is empty (no thread yet)');
  return next ok(not private.can_use_typing_channel('greffe-typing:' || t), '« … écrit »: not for another member');
  perform pg_temp.as_owner();
  perform pg_temp.as_user(member);
  return next ok(private.can_use_typing_channel('greffe-typing:' || t), '« … écrit »: the member of the thread');
  perform pg_temp.as_owner();
  perform pg_temp.as_admin(team);
  return next ok(private.can_use_typing_channel('greffe-typing:' || t), '« … écrit »: the team');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_conversation() returns setof text language plpgsql as $$
declare
  team uuid := pg_temp.staff(array['members.message']);
  boss uuid := pg_temp.super_admin();
  member uuid := pg_temp.new_member('bad', true);
  t uuid;
  again uuid;
  mine jsonb;
  reply bigint;
begin
  perform pg_temp.as_admin(team);
  perform public.greffe_set_team_name('Sam');
  t := public.admin_messagerie_open(member);
  again := public.admin_messagerie_open(member);
  return next is(again, t, 'one thread per member');
  perform public.greffe_send(t, 'Ta pose de profil est floue.');
  perform pg_temp.as_owner();
  return next is((select count(*)::integer from public.notifications where user_id = member and type = 'greffe_message'), 1,
    'the member is told (push, e-mail)');
  return next is((select author_id from public.greffe_messages where thread_id = t), team, 'tied to its real author');
  perform pg_temp.as_user(member);
  mine := public.greffe_my_thread();
  return next is(mine -> 'messages' -> 0 ->> 'label', 'Le Greffe · Sam', 'shown « Le Greffe » and the team name');
  return next ok((mine -> 'messages' -> 0 -> 'author_id') = 'null'::jsonb, 'never the author''s account');
  return next is(public.greffe_my_unread(), 1, 'unread by the member');
  perform public.greffe_mark_read(t, (mine -> 'messages' -> 0 ->> 'id')::bigint);
  return next is(public.greffe_my_unread(), 0, 'read');
  reply := public.greffe_send(t, 'Je la refais ce soir.');
  return next matches(pg_temp.err(format('select public.greffe_send(%L, ''x'', ''[]'', true)', t)), '^42501',
    'a member never writes a moderation decision');
  return next matches(pg_temp.err(format('select public.greffe_send(%L, %L)', t, repeat('a', 2001))), '^22001',
    'at most 2,000 characters');
  return next matches(pg_temp.err(format('select public.greffe_send(%L, ''   '')', t)), '^22023', 'never empty');
  perform pg_temp.as_owner();
  perform pg_temp.as_admin(team);
  return next is(public.admin_messagerie_unread(), 1, 'the menu counts the thread to answer');
  return next is((select x.unread from public.admin_messagerie_threads('waiting') x where x.thread_id = t), 1,
    'listed « waiting for an answer », unread');
  return next is((select count(*)::integer from public.admin_messagerie_threads('open', 'refais') x), 1, 'found by its text');
  return next is((select count(*)::integer from public.admin_messagerie_threads('open', 'zzz-nothing') x), 0, 'and not otherwise');
  perform public.admin_messagerie_thread(t);
  perform public.greffe_mark_read(t, reply);
  return next is(public.admin_messagerie_unread(), 0, 'read by the team');
  perform pg_temp.as_owner();
  return next is((select count(*)::integer from public.greffe_fiche_views where admin_id = team and bad_id = member
                  and context = 'messagerie'), 1, 'each reading by the team is logged');
  return next is((select team_read_id from public.greffe_threads where id = t), reply, '« Lu » for the member');
  -- The super admin reads every thread, logged too.
  perform pg_temp.as_admin(boss);
  perform public.admin_messagerie_thread(t);
  perform pg_temp.as_owner();
  return next is((select count(*)::integer from public.greffe_fiche_views where admin_id = boss and context = 'messagerie'), 1,
    'the super admin reads it, logged');
  -- Archived: the member can no longer answer; « Écrire » reopens it.
  perform pg_temp.as_admin(team);
  perform public.admin_messagerie_archive(t, true);
  return next is((select count(*)::integer from public.admin_messagerie_threads('archived') x where x.thread_id = t), 1, 'archived');
  perform pg_temp.as_owner();
  perform pg_temp.as_user(member);
  return next matches(pg_temp.err(format('select public.greffe_send(%L, ''encore'')', t)), '^23514 thread_closed',
    'the member answers only an open thread');
  perform pg_temp.as_owner();
  perform pg_temp.as_admin(team);
  return next is(public.admin_messagerie_open(member), t, 'reopened, not doubled');
  perform pg_temp.as_owner();
  -- Never edited nor deleted, by anyone (the owner of the database included).
  return next matches(pg_temp.err(format('update public.greffe_messages set body = ''autre'' where thread_id = %L', t)),
    '^42501 greffe_message_immutable', 'a message is never edited');
  return next matches(pg_temp.err(format('delete from public.greffe_messages where thread_id = %L', t)),
    '^42501 greffe_message_immutable', 'nor deleted');
  perform pg_temp.as_service();
  return next matches(pg_temp.err(format('update public.greffe_messages set body = ''autre'' where thread_id = %L', t)),
    '^42501', 'not even with the secret key');
  perform pg_temp.as_owner();
  perform pg_temp.as_user(member);
  return next matches(pg_temp.err(format('delete from public.greffe_messages where thread_id = %L', t)), '^42501',
    'nor by the member');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_unreachable() returns setof text language plpgsql as $$
declare
  team uuid := pg_temp.staff(array['members.message']);
  member uuid := pg_temp.new_member('visitor', true);
  t uuid := pg_temp.thread(team, member);
begin
  update public.profiles set suspended_until = now() + interval '3 days' where id = member;
  perform pg_temp.as_admin(team);
  return next matches(pg_temp.err(format('select public.greffe_send(%L, ''Un mot'')', t)), '^23514 member_unreachable',
    'a suspended member receives nothing');
  return next is(pg_temp.err(format('select public.greffe_send(%L, ''Décision de modération'', ''[]'', true)', t)), 'ok',
    'but a moderation decision');
  perform pg_temp.as_owner();
  update public.profiles set suspended_until = null, banned_at = now() where id = member;
  perform pg_temp.as_admin(team);
  return next matches(pg_temp.err(format('select public.greffe_send(%L, ''Un mot'')', t)), '^23514 member_unreachable',
    'nor a banned one');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_files() returns setof text language plpgsql as $$
declare
  team uuid := pg_temp.staff(array['members.message']);
  member uuid := pg_temp.new_member('bad', true);
  other uuid := pg_temp.new_member('bad', true);
  t uuid := pg_temp.thread(team, member);
  good text := pg_temp.file(member);
  foreign_file text := pg_temp.file(other);
  six jsonb;
begin
  select jsonb_agg(jsonb_build_object('path', pg_temp.file(member), 'width', 800, 'height', 600)) into six
  from generate_series(1, 6);
  perform pg_temp.as_user(member);
  return next matches(pg_temp.err(format('select public.greffe_send(%L, null, %L)', t,
    jsonb_build_array(jsonb_build_object('path', member || '/' || gen_random_uuid() || '.webp', 'width', 10, 'height', 10)))),
    '^22023 invalid_file', 'an image not stored: refused');
  return next matches(pg_temp.err(format('select public.greffe_send(%L, null, %L)', t,
    jsonb_build_array(jsonb_build_object('path', foreign_file, 'width', 10, 'height', 10)))),
    '^22023 invalid_file', 'an image of another member''s folder: refused');
  return next matches(pg_temp.err(format('select public.greffe_send(%L, null, %L)', t, six)), '^22023 too_many_files',
    'at most 5 images a message');
  return next is(pg_temp.err(format('select public.greffe_send(%L, ''Voilà'', %L)', t,
    jsonb_build_array(jsonb_build_object('path', good, 'width', 800, 'height', 600)))), 'ok', 'an image of their folder');
  return next matches(pg_temp.err(format('select public.greffe_send(%L, null, %L)', t,
    jsonb_build_array(jsonb_build_object('path', good, 'width', 800, 'height', 600)))), '^22023 invalid_file',
    'never twice');
  return next is((select count(*)::integer from storage.objects where bucket_id = 'greffe-mail' and name = good), 1,
    'the member reads the file of their thread');
  perform pg_temp.as_owner();
  perform pg_temp.as_user(other);
  return next is((select count(*)::integer from storage.objects where bucket_id = 'greffe-mail' and name = good), 0,
    'another member does not');
  perform pg_temp.as_owner();
  perform pg_temp.as_admin(team);
  return next is((select count(*)::integer from storage.objects where bucket_id = 'greffe-mail' and name = good), 1,
    'the team does');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_photo_proposal() returns setof text language plpgsql as $$
declare
  team uuid := pg_temp.staff(array['members.message']);
  member uuid := pg_temp.new_member('bad', true);
  other uuid := pg_temp.new_member('bad', true);
  t uuid := pg_temp.thread(team, member);
  large text;
  proposal uuid;
  refused uuid;
  old jsonb;
begin
  large := pg_temp.file(member, 'proposal-');
  insert into storage.objects (bucket_id, name) values ('greffe-mail', regexp_replace(large, '\.webp$', '-s.webp'));
  perform pg_temp.as_admin(team);
  proposal := public.greffe_propose_photo(t, 1::smallint, large, regexp_replace(large, '\.webp$', '-s.webp'), 900, 1200,
    'Ta pose de profil, recadrée.');
  return next matches(pg_temp.err(format('select public.greffe_decide_photo_proposal(%L, true)', proposal)), '^P0002',
    'the team cannot accept it in the member''s stead');
  perform pg_temp.as_owner();
  perform pg_temp.as_service();
  return next matches(pg_temp.err(format('select public.greffe_apply_photo_proposal(%L, %L, %L)', proposal,
    gen_random_uuid() || '.webp', 'x')), '^42501 not_accepted', 'never applied without the member''s « Accepter »');
  perform pg_temp.as_owner();
  return next matches(pg_temp.err(format('update public.greffe_photo_proposals set status = ''accepted'' where id = %L', proposal)),
    '^42501 member_decision_required', 'nor accepted by a direct write');
  perform pg_temp.as_user(other);
  return next matches(pg_temp.err(format('select public.greffe_decide_photo_proposal(%L, true)', proposal)), '^P0002',
    'nor by another member');
  perform pg_temp.as_owner();
  perform pg_temp.as_user(member);
  return next matches(pg_temp.err(format('select public.greffe_apply_photo_proposal(%L, %L, %L)', proposal, 'a', 'b')),
    '^42501', 'a member cannot apply it themself (the server does, after the files)');
  return next is(public.greffe_decide_photo_proposal(proposal, true), 'accepted', 'the member accepts');
  perform pg_temp.as_owner();
  perform pg_temp.as_service();
  large := gen_random_uuid()::text;
  old := public.greffe_apply_photo_proposal(proposal, large || '.webp', large || '-s.webp');
  perform pg_temp.as_owner();
  return next is((select status::text || '/' || reviewed_by::text || '/' || public_path_large from public.photos
                  where owner_id = member and position = 1), 'approved/' || team || '/' || large || '.webp',
    'the pose is replaced, validated at once, by its proposer');
  return next is((select count(*)::integer from public.moderation_actions where target_user_id = member
                  and action = 'photo_proposal_accept' and admin_id = team), 1, 'logged');
  return next matches(pg_temp.err(format('select public.greffe_apply_photo_proposal(%L, %L, %L)', proposal,
    gen_random_uuid() || '.webp', 'x')), '^42501', 'applied once');
  -- Refused: nothing changes.
  large := pg_temp.file(member, 'proposal-');
  insert into storage.objects (bucket_id, name) values ('greffe-mail', regexp_replace(large, '\.webp$', '-s.webp'));
  perform pg_temp.as_admin(team);
  refused := public.greffe_propose_photo(t, 2::smallint, large, regexp_replace(large, '\.webp$', '-s.webp'), 900, 1200);
  perform pg_temp.as_owner();
  perform pg_temp.as_user(member);
  return next is(public.greffe_decide_photo_proposal(refused, false), 'refused', 'or refuses');
  perform pg_temp.as_owner();
  return next ok(not exists (select 1 from public.photos where owner_id = member and position = 2), 'and the pose stays as it was');
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_report() returns setof text language plpgsql as $$
declare
  team uuid := pg_temp.staff(array['members.message', 'reports.decide']);
  boss uuid := pg_temp.super_admin();
  member uuid := pg_temp.new_member('bad', true);
  other uuid := pg_temp.new_member('bad', true);
  t uuid := pg_temp.thread(team, member);
  msg bigint := (select id from public.greffe_messages where thread_id = t);
  own bigint;
  report bigint;
begin
  perform pg_temp.as_user(other);
  return next matches(pg_temp.err(format('select public.greffe_report_message(%s, ''harassment'')', msg)), '^P0002',
    'another member cannot report it');
  perform pg_temp.as_owner();
  perform pg_temp.as_user(member);
  own := public.greffe_send(t, 'Ma réponse');
  return next matches(pg_temp.err(format('select public.greffe_report_message(%s, ''harassment'')', own)), '^P0002',
    'nor can one report their own message');
  report := public.greffe_report_message(msg, 'harassment', 'Ton déplacé');
  perform pg_temp.as_owner();
  return next is((select target_type::text || '/' || target_id from public.reports where id = report),
    'greffe_message/' || msg, 'a message of the team, reported by its member');
  perform pg_temp.as_admin(team);
  return next ok(not exists (select 1 from public.admin_report_queue() q where q.report_id = report),
    'not in the queue of the team');
  perform pg_temp.as_owner();
  perform pg_temp.as_admin(boss);
  return next is((select q.content from public.admin_report_queue() q where q.report_id = report), 'Bonjour, ici le Greffe.',
    'in the super admin''s, with the text');
  return next is(pg_temp.err(format('select public.admin_decide_report(%s, true, ''Retenu, rappel à l''''équipe'')', report)),
    'ok', 'decided by the super admin, without a sanction of a member');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_retention_export() returns setof text language plpgsql as $$
declare
  team uuid := pg_temp.staff(array['members.message']);
  member uuid := pg_temp.new_member('bad', true);
  t uuid := pg_temp.thread(team, member);
  path text := pg_temp.file(member);
  old_msg bigint;
  attachment uuid;
  data jsonb;
begin
  insert into public.greffe_messages (thread_id, author_id, side, author_label, body, created_at)
  values (t, team, 'team', 'Le Greffe', 'Un vieux message', now() - interval '13 months') returning id into old_msg;
  insert into public.greffe_attachments (message_id, thread_id, path, width, height, created_at)
  values (old_msg, t, path, 10, 10, now() - interval '13 months') returning id into attachment;
  perform pg_temp.as_service();
  return next ok(exists (select 1 from public.cleanup_greffe_files_due() d where d.id = attachment),
    'an image of 12 months is due for removal');
  perform pg_temp.as_owner();
  perform private.greffe_retention();
  return next ok(exists (select 1 from public.greffe_messages where id = old_msg), 'its text waits for the file to go');
  perform pg_temp.as_service();
  perform public.cleanup_greffe_files_done(array[attachment], '{}');
  perform pg_temp.as_owner();
  perform private.greffe_retention();
  return next ok(not exists (select 1 from public.greffe_messages where id = old_msg), 'then goes, at 12 months');
  return next is((select count(*)::integer from public.greffe_messages where thread_id = t), 1, 'the recent one stays');
  -- Archived for more than 30 days: the images are due.
  path := pg_temp.file(member);
  perform pg_temp.as_admin(team);
  perform public.greffe_send(t, null, jsonb_build_array(jsonb_build_object('path', path, 'width', 10, 'height', 10)));
  perform public.admin_messagerie_archive(t, true);
  perform pg_temp.as_owner();
  update public.greffe_threads set archived_at = now() - interval '31 days' where id = t;
  perform pg_temp.as_service();
  return next ok(exists (select 1 from public.cleanup_greffe_files_due() d where path = any (d.paths)),
    'images 30 days after the archiving');
  perform pg_temp.as_owner();
  perform pg_temp.as_user(member);
  data := public.export_my_data();
  return next is(jsonb_array_length(data -> 'courrier_du_greffe'), 2, 'the Courrier du Greffe in the export');
  perform pg_temp.as_owner();
  delete from auth.users where id = member;
  return next ok(not exists (select 1 from public.greffe_threads where id = t), 'gone with the account');
end $$;

select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
