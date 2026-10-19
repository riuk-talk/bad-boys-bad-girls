-- Phase 7a (pgTAP): la modération (SPEC §10 DSA, §14, §15). Every test_* function runs in its own
-- rolled-back transaction (runtests), so nothing persists. Helpers as in phase6_parloir, plus the
-- admin accounts and the second factor (aal2).

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

create function pg_temp.new_place() returns bigint language sql as $$
  insert into public.places (official_code, name, lat, lng)
  values ('T' || substr(md5(random()::text), 1, 8), 'Ville test', 47.5, 3.5) returning id
$$;

create function pg_temp.new_member(p_email text, p_gender public.gender, p_place bigint,
  p_role public.member_role) returns uuid language plpgsql as $$
declare uid uuid := pg_temp.new_user(p_email);
begin
  insert into public.profiles (id, pseudo, birthdate, gender, seeking_genders, place_id, role, visit_motive)
  values (uid, 'm' || translate(substr(replace(uid::text, '-', ''), 1, 12), '0123456789', 'ghijklmnop'),
    date '1990-01-01', p_gender, '{man,woman}', p_place, p_role,
    case when p_role = 'visitor' then 'Motif de test' end);
  update public.profiles set onboarding_completed_at = now(), last_seen_at = now(),
    created_at = now() - interval '10 days' where id = uid;
  return uid;
end $$;

create function pg_temp.approve_photo(p_owner uuid, p_position integer) returns void language sql as $$
  insert into public.photos (owner_id, position, pending_path)
  values (p_owner, p_position, p_owner || '/' || gen_random_uuid() || '.webp');
  update public.photos set status = 'approved', pending_path = null,
    public_path_large = gen_random_uuid() || '.webp', public_path_small = gen_random_uuid() || '-s.webp'
  where owner_id = p_owner and position = p_position;
$$;

create function pg_temp.bad(p_email text, p_place bigint) returns uuid language plpgsql as $$
declare b uuid := pg_temp.new_member(p_email, 'woman', p_place, 'bad');
begin
  perform pg_temp.approve_photo(b, 0);
  perform pg_temp.approve_photo(b, 1);
  perform pg_temp.approve_photo(b, 2);
  insert into public.casier_charges (profile_id, charge_1, charge_2, charge_3, true_index)
  values (b, 'Chef UN a traversé la Manche en kayak', 'Chef DEUX a dormi dans un phare breton',
    'Chef TROIS a volé une cloche de vache', 2);
  return b;
end $$;

create function pg_temp.visitor(p_email text, p_place bigint) returns uuid language plpgsql as $$
declare v uuid := pg_temp.new_member(p_email, 'man', p_place, 'visitor');
begin
  perform pg_temp.approve_photo(v, 0);
  return v;
end $$;

create function pg_temp.as_user(p_uid uuid, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, true);
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

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  return coalesce(pg_temp.try(p_sql), 'ok');
end $$;

create function pg_temp.request(p_visitor uuid, p_bad uuid) returns uuid language plpgsql as $$
declare r uuid;
begin
  perform pg_temp.as_user(p_visitor);
  r := public.send_visit_request(p_bad, 1::smallint, null);
  perform pg_temp.as_owner();
  return r;
end $$;

-- A slot start n hours from now, on the hour.
create function pg_temp.h(p_hours integer) returns timestamptz language sql stable as $$
  select date_trunc('hour', now()) + p_hours * interval '1 hour'
$$;

create function pg_temp.slots_sql(p_request uuid, variadic p_hours integer[]) returns text language sql stable as $$
  select format('select public.accept_visit_request(%L, %L::timestamptz[])', p_request,
    (select array_agg(pg_temp.h(x)) from unnest(p_hours) x))
$$;

create function pg_temp.accept(p_bad uuid, p_request uuid, variadic p_hours integer[]) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(p_bad);
  perform public.accept_visit_request(p_request, (select array_agg(pg_temp.h(x)) from unnest(p_hours) x));
  perform pg_temp.as_owner();
end $$;

-- Test helper read as the owner (members have no right on visit_slots, by design).
create function pg_temp.slot_at(p_request uuid, p_hours integer) returns uuid language sql stable security definer as $$
  select id from public.visit_slots where request_id = p_request and starts_at = pg_temp.h(p_hours)
  order by round desc limit 1
$$;

create function pg_temp.choose(p_visitor uuid, p_slot uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp.as_user(p_visitor);
  v := public.choose_slot(p_slot);
  perform pg_temp.as_owner();
  return v;
end $$;

create function pg_temp.notified(p_user uuid, p_type text) returns integer language sql stable as $$
  select count(*)::integer from public.notifications where user_id = p_user and type::text = p_type
$$;

create function pg_temp.open() returns void language sql as $$
  update public.app_settings set launch_mode = 'open' where id
$$;


-- A request with a note, accepted, a slot chosen, then moved to « now » and started by the job.
create function pg_temp.live_visit(p_bad uuid, p_visitor uuid) returns uuid language plpgsql as $$
declare req uuid; visit uuid;
begin
  perform pg_temp.as_user(p_visitor);
  req := public.send_visit_request(p_bad, 1::smallint, 'Couche-tard aussi.');
  perform pg_temp.as_owner();
  perform pg_temp.accept(p_bad, req, 6, 7);
  visit := pg_temp.choose(p_visitor, pg_temp.slot_at(req, 6));
  update public.visits set starts_at = now() - interval '1 minute', ends_at = now() + interval '29 minutes' where id = visit;
  perform public.run_parloir_ticks();
  return visit;
end $$;

create function pg_temp.join(p_user uuid, p_visit uuid) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  perform pg_temp.as_user(p_user);
  j := public.join_visit(p_visit);
  perform pg_temp.as_owner();
  return j;
end $$;

create function pg_temp.say(p_user uuid, p_conversation uuid, p_body text) returns text language plpgsql as $$
declare e text;
begin
  perform pg_temp.as_user(p_user);
  e := pg_temp.err(format('select public.send_message(%L, %L)', p_conversation, p_body));
  perform pg_temp.as_owner();
  return e;
end $$;

create function pg_temp.conv(p_visit uuid) returns uuid language sql stable security definer as $$
  select conversation_id from public.visits where id = p_visit
$$;

-- The visit is over (both were there): ends_at moved to the past, then the job.
create function pg_temp.finish(p_visit uuid) returns void language plpgsql as $$
begin
  update public.visits set starts_at = now() - interval '31 minutes', ends_at = now() - interval '1 minute' where id = p_visit;
  perform public.run_parloir_ticks();
end $$;

create function pg_temp.choose_end(p_user uuid, p_visit uuid, p_prolong boolean) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  perform pg_temp.as_user(p_user);
  j := public.choose_visit_end(p_visit, p_prolong);
  perform pg_temp.as_owner();
  return j;
end $$;

-- A couple with the Permis permanent: the visit held, both prolong; returns the conversation.
create function pg_temp.released(p_bad uuid, p_visitor uuid) returns uuid language plpgsql as $$
declare visit uuid;
begin
  visit := pg_temp.live_visit(p_bad, p_visitor);
  perform pg_temp.join(p_visitor, visit);
  perform pg_temp.join(p_bad, visit);
  perform pg_temp.finish(visit);
  perform pg_temp.choose_end(p_visitor, visit, true);
  perform pg_temp.choose_end(p_bad, visit, true);
  return pg_temp.conv(visit);
end $$;


create function pg_temp.last_message(p_conversation uuid) returns bigint language sql stable security definer as $$
  select coalesce(max(id), 0) from public.messages where conversation_id = p_conversation
$$;

create function pg_temp.new_admin(p_email text) returns uuid language plpgsql as $$
declare uid uuid := pg_temp.new_user(p_email);
begin
  insert into public.admin_users (user_id, note) values (uid, 'test');
  return uid;
end $$;

-- Granted by the database owner in person (Phase 5a-ter).
create function pg_temp.new_super_admin() returns uuid language plpgsql as $$
declare uid uuid := pg_temp.new_user('super@test.local');
begin
  perform set_config('application_name', 'pgtap', true);
  insert into public.super_admins (user_id, note) values (uid, 'test');
  return uid;
end $$;

-- A statement run by a signed-in account with the second factor: 'ok' or the error.
create function pg_temp.as_admin(p_admin uuid, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
declare e text;
begin
  perform pg_temp.as_user(p_admin, p_aal);
  e := pg_temp.err(p_sql);
  perform pg_temp.as_owner();
  return e;
end $$;

create function pg_temp.report_as(p_user uuid, p_type text, p_target text, p_category text) returns bigint language plpgsql as $$
declare r bigint;
begin
  perform pg_temp.as_user(p_user);
  r := public.report(p_type::public.report_target, p_target, p_category::public.report_category, 'Commentaire de test');
  perform pg_temp.as_owner();
  return r;
end $$;

create function pg_temp.decisions(p_user uuid) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  perform pg_temp.as_user(p_user);
  j := public.get_my_decisions();
  perform pg_temp.as_owner();
  return j;
end $$;

create function pg_temp.sanction_of(p_user uuid) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  perform pg_temp.as_user(p_user);
  j := public.get_my_sanction();
  perform pg_temp.as_owner();
  return j;
end $$;

create function pg_temp.decide_sql(p_report bigint, p_upheld boolean, p_reporter text, p_action text default null,
  p_target text default null, p_days integer default null) returns text language sql stable as $$
  select format('select public.admin_decide_report(%s, %L, %L, %L::public.moderation_action_type, %L, %L::integer)',
    p_report, p_upheld, p_reporter, p_action, p_target, p_days)
$$;

----------------------------------------------------------------------------------------------
-- Admins only, with the second factor
----------------------------------------------------------------------------------------------
create function pg_temp.test_admin_only() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); m uuid; adm uuid; q text;
begin
  m := pg_temp.visitor('member@test.local', pl);
  adm := pg_temp.new_admin('admin@test.local');
  foreach q in array array[
    'select * from public.admin_report_queue()',
    'select * from public.admin_flag_queue()',
    'select * from public.admin_find_members(''abc'')',
    format('select public.admin_member(%L)', m),
    format('select public.admin_sanction(%L, ''warn'', ''Un motif assez long'')', m),
    'select public.admin_decide_report(1, false, ''Un motif assez long'')',
    'select public.admin_decide_flag(1, ''clear'')',
    'select * from public.admin_moderation_log()'] loop
    return next is(pg_temp.as_admin(m, q), '42501 admin_only', 'a member is refused: ' || left(q, 40));
    return next is(pg_temp.as_admin(adm, q, 'aal1'), '42501 admin_only', 'an admin without the second factor is refused: ' || left(q, 40));
  end loop;
  return next is(pg_temp.as_admin(adm, 'select * from public.admin_report_queue()'), 'ok', 'an admin with aal2 reads the queue');
  return next ok(not has_function_privilege('anon', 'public.admin_sanction(uuid, public.moderation_action_type, text, integer)', 'execute'),
    'nothing for anon');
  return next ok(not has_function_privilege('authenticated',
    'private.apply_sanction(uuid, public.moderation_action_type, text, integer, bigint, bigint)', 'execute'),
    'the internal helpers are not callable');
  return next is(pg_temp.as_admin(m, 'select count(*) from public.moderation_actions'), '42501 permission denied for table moderation_actions',
    'members cannot read the decisions directly');
end $$;

----------------------------------------------------------------------------------------------
-- A report upheld: suspension, motives for each side, nothing more
----------------------------------------------------------------------------------------------
create function pg_temp.test_report_upheld_suspension() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); b uuid; v uuid; adm uuid; req uuid; rep bigint; d jsonb; vp text;
begin
  perform pg_temp.open();
  b := pg_temp.bad('bad@test.local', pl);
  v := pg_temp.visitor('visitor@test.local', pl);
  adm := pg_temp.new_admin('admin@test.local');
  update public.profiles set is_reglo = true where id = b;
  req := pg_temp.request(v, b);
  rep := pg_temp.report_as(v, 'profile', b::text, 'harassment');

  perform pg_temp.as_user(adm, 'aal2');
  return next ok(exists (select 1 from public.admin_report_queue() q where q.report_id = rep
                         and q.target_user_id = b and q.reporter_pseudo is not null and q.target_open_reports = 1),
    'the report is in the queue');
  perform pg_temp.as_owner();
  return next is(pg_temp.as_admin(adm, pg_temp.decide_sql(rep, true, 'Merci, ton signalement est retenu.',
    'suspend', 'Propos insultants envoyés à un membre.', 3)), 'ok', 'upheld with a suspension of 3 days');

  return next ok((select status = 'upheld' and decision_reason = 'Merci, ton signalement est retenu.' and decided_by = adm
                  from public.reports where id = rep), 'the report is upheld with the motive for the reporter');
  return next ok((select suspended_until between now() + interval '71 hours' and now() + interval '73 hours' and not is_reglo
                  from public.profiles where id = b), 'suspended 3 days, Bonne conduite withdrawn');
  return next ok((select status = 'closed' and close_reason = 'moderation' from public.visit_requests where id = req),
    'the open case is closed');
  return next is(pg_temp.notified(v, 'report_decided'), 1, 'the reporter is told');
  return next is(pg_temp.notified(v, 'request_dismissed'), 1, 'the Visitor of the closed case is told neutrally');
  return next is(pg_temp.notified(b, 'sanction'), 1, 'the member concerned is told');
  return next ok(exists (select 1 from public.moderation_actions where report_id = rep and action = 'suspend'
                         and target_user_id = b and ends_at > now()), 'the decision is recorded');
  return next ok(not public.can_view_bad(v, b), 'a suspended Bad is visible to nobody');

  d := pg_temp.decisions(v);
  return next is(d -> 'reports' -> 0 ->> 'status', 'upheld', 'the reporter sees the outcome');
  return next is(d -> 'reports' -> 0 ->> 'reason', 'Merci, ton signalement est retenu.', 'and the motive written for them');
  return next ok(position('Propos insultants' in d::text) = 0 and position('suspend' in d::text) = 0,
    'never the motive nor the sanction of the other');
  d := pg_temp.decisions(b);
  select pseudo::text into vp from public.profiles where id = v;
  return next is(d -> 'decisions' -> 0 ->> 'action', 'suspend', 'the member concerned sees the decision');
  return next is(d -> 'decisions' -> 0 ->> 'reason', 'Propos insultants envoyés à un membre.', 'and its motive');
  return next ok(position(v::text in d::text) = 0 and position(vp in d::text) = 0 and position('Merci' in d::text) = 0,
    'never who reported');
  return next is(pg_temp.sanction_of(b) ->> 'state', 'suspended', 'the suspension in force is known to the member');
  return next is(pg_temp.as_admin(adm, pg_temp.decide_sql(rep, false, 'Encore une fois ce motif.')), '23514 already_decided',
    'one decision per report');
end $$;

----------------------------------------------------------------------------------------------
-- Motives and actions checked
----------------------------------------------------------------------------------------------
create function pg_temp.test_decision_rules() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); b uuid; v uuid; adm uuid; rep bigint;
begin
  perform pg_temp.open();
  b := pg_temp.bad('bad@test.local', pl);
  v := pg_temp.visitor('visitor@test.local', pl);
  adm := pg_temp.new_admin('admin@test.local');
  rep := pg_temp.report_as(v, 'casier', b::text, 'other');
  return next is(pg_temp.as_admin(adm, pg_temp.decide_sql(rep, false, 'court')), '22023 reason_required', 'a motive is required');
  return next is(pg_temp.as_admin(adm, pg_temp.decide_sql(rep, true, 'Signalement retenu, merci.')), '22023 invalid_action',
    'upheld needs a sanction');
  return next is(pg_temp.as_admin(adm, pg_temp.decide_sql(rep, true, 'Signalement retenu, merci.', 'unban', 'Motif pour la cible.')),
    '22023 invalid_action', 'not any action');
  return next is(pg_temp.as_admin(adm, pg_temp.decide_sql(rep, true, 'Signalement retenu, merci.', 'warn')),
    '22023 reason_required', 'upheld needs a motive for the member concerned');
  return next is(pg_temp.as_admin(adm, pg_temp.decide_sql(rep, false, 'Rien de contraire à la Charte.', 'warn', 'Motif pour la cible.')),
    '22023 invalid_action', 'rejected means no sanction');
  return next is(pg_temp.as_admin(adm, format('select public.admin_sanction(%L, ''suspend'', ''Un motif assez long'', 0)', b)),
    '22023 invalid_days', 'a suspension lasts at least a day');
  return next is(pg_temp.as_admin(adm, format('select public.admin_sanction(%L, ''suspend'', ''Un motif assez long'', 91)', b)),
    '22023 invalid_days', 'and at most 90 days');
  return next is(pg_temp.as_admin(adm, pg_temp.decide_sql(rep, false, 'Rien de contraire à la Charte.')), 'ok', 'rejected');
  return next ok((select status = 'rejected' from public.reports where id = rep), 'the report is rejected');
  return next is(pg_temp.notified(v, 'report_decided'), 1, 'the reporter is told');
  return next is(pg_temp.notified(b, 'sanction'), 0, 'the member concerned is not');
  return next ok((select suspended_until is null and banned_at is null and hidden_reason is null from public.profiles where id = b),
    'and nothing changes for them');
end $$;

----------------------------------------------------------------------------------------------
-- The ban: e-mail fingerprint, Auth account banned, sessions revoked; lifted by the super admin
----------------------------------------------------------------------------------------------
create function pg_temp.test_ban_and_unban() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); v uuid; adm uuid; sa uuid;
  ban text := 'select public.admin_sanction(%L, ''ban'', ''Arnaque avérée envers plusieurs membres.'')';
begin
  v := pg_temp.visitor('ban-me@test.local', pl);
  adm := pg_temp.new_admin('admin@test.local');
  sa := pg_temp.new_super_admin();
  insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), v, now(), now());
  return next is(pg_temp.as_admin(adm, format(ban, v)), 'ok', 'banned');
  return next ok((select banned_at is not null from public.profiles where id = v), 'the profile is banned');
  return next ok(exists (select 1 from public.banned_email_hashes where hash = public.ban_email_hash('ban-me@test.local')
                         and expires_at > now() + interval '11 months'), 'the e-mail fingerprint is kept (12 months)');
  return next ok((select banned_until > now() + interval '50 years' from auth.users where id = v), 'the Auth account is banned');
  return next ok(not exists (select 1 from auth.sessions where user_id = v), 'the sessions are revoked');
  return next ok(public.hook_before_user_created('{"user": {"email": " Ban-Me@test.local"}}') ? 'error',
    'the same e-mail cannot sign up again');
  return next is((select count(*)::integer from public.email_outbox where user_id = v and kind = 'moderation_decision'), 1,
    'the exposé des motifs leaves by e-mail too');
  return next is(pg_temp.sanction_of(v) ->> 'reason', 'Arnaque avérée envers plusieurs membres.', 'with its motive');
  return next is(pg_temp.as_admin(adm, format(ban, v)), '23514 already_banned', 'once');
  return next is(pg_temp.as_admin(adm, format('select public.admin_sanction(%L, ''unban'', ''Erreur de modération.'')', v)),
    '42501 super_admin_only', 'an admin cannot lift a ban');
  return next is(pg_temp.as_admin(sa, format('select public.admin_sanction(%L, ''unban'', ''Erreur de modération.'')', v)),
    'ok', 'the super admin can');
  return next ok((select p.banned_at is null and u.banned_until is null from public.profiles p join auth.users u on u.id = p.id
                  where p.id = v), 'the ban is lifted');
  return next is(public.hook_before_user_created('{"user": {"email": "ban-me@test.local"}}'), '{}'::jsonb,
    'the fingerprint is gone');
end $$;

----------------------------------------------------------------------------------------------
-- Nobody sanctions themself; an admin only by the super admin; the super admin by nobody
----------------------------------------------------------------------------------------------
create function pg_temp.test_protections() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); adm uuid; a2 uuid; sa uuid; v uuid;
  warn text := 'select public.admin_sanction(%L, ''warn'', ''Un motif assez long'')';
begin
  adm := pg_temp.new_admin('admin@test.local');
  a2 := pg_temp.visitor('admin2@test.local', pl);
  insert into public.admin_users (user_id, note) values (a2, 'test');
  sa := pg_temp.new_super_admin();
  v := pg_temp.visitor('visitor@test.local', pl);
  return next is(pg_temp.as_admin(a2, format(warn, a2)), '42501 self_sanction', 'nobody sanctions themself');
  return next is(pg_temp.as_admin(adm, format(warn, a2)), '42501 admin_protected', 'an admin cannot sanction an admin');
  return next is(pg_temp.as_admin(sa, format(warn, a2)), 'ok', 'the super admin can');
  return next is(pg_temp.as_admin(adm, format('select public.admin_sanction(%L, ''ban'', ''Un motif assez long'')', sa)),
    'P0002 not_found', 'the super admin has no profile: nothing to sanction');
  return next is(pg_temp.as_admin(adm, format(warn, v)), 'ok', 'a warning');
  return next is(pg_temp.err(format('update public.moderation_actions set reason = ''x'' where target_user_id = %L', v)),
    '42501 append_only', 'a decision is never rewritten');
  return next is(pg_temp.err(format('delete from public.moderation_actions where target_user_id = %L', v)),
    '42501 append_only', 'nor erased');
end $$;

----------------------------------------------------------------------------------------------
-- « Mineur »: the automatic hiding is lifted when every « mineur » report is rejected
----------------------------------------------------------------------------------------------
create function pg_temp.test_minor_hiding() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); b uuid; r1 uuid; r2 uuid; adm uuid; rep1 bigint; rep2 bigint;
begin
  perform pg_temp.open();
  b := pg_temp.bad('bad@test.local', pl);
  r1 := pg_temp.visitor('r1@test.local', pl);
  r2 := pg_temp.visitor('r2@test.local', pl);
  adm := pg_temp.new_admin('admin@test.local');
  rep1 := pg_temp.report_as(r1, 'profile', b::text, 'minor');
  rep2 := pg_temp.report_as(r2, 'profile', b::text, 'minor');
  return next is((select hidden_reason from public.profiles where id = b), 'minor_report', 'hidden after 2 reports');
  return next is(pg_temp.sanction_of(b) ->> 'state', 'review', 'the member knows the Fiche is under review');
  perform pg_temp.as_user(adm, 'aal2');
  return next is((select q.category::text from public.admin_report_queue() q limit 1), 'minor', '« mineur » first');
  perform pg_temp.as_owner();
  perform pg_temp.as_admin(adm, pg_temp.decide_sql(rep1, false, 'Pièce d''identité vérifiée, majeur.'));
  return next is((select hidden_reason from public.profiles where id = b), 'minor_report', 'still hidden while one is open');
  perform pg_temp.as_admin(adm, pg_temp.decide_sql(rep2, false, 'Pièce d''identité vérifiée, majeur.'));
  return next ok((select hidden_reason is null from public.profiles where id = b), 'visible again once all are rejected');
  return next ok(pg_temp.sanction_of(b) is null, 'nothing in force');
end $$;

----------------------------------------------------------------------------------------------
-- Flagged texts: cleared, upheld or removed
----------------------------------------------------------------------------------------------
create function pg_temp.test_flags() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); b uuid; v uuid; adm uuid; f bigint; conv uuid; req uuid; mid bigint;
  motive text := 'Ce texte enfreint la Charte.';
begin
  perform pg_temp.open();
  insert into public.moderation_keywords (term, lang, category) values ('arnaquezmoi', 'fr', 'scam');
  b := pg_temp.bad('bad@test.local', pl);
  v := pg_temp.visitor('visitor@test.local', pl);
  adm := pg_temp.new_admin('admin@test.local');

  update public.profiles set bio = 'Je dis arnaquezmoi souvent' where id = b;
  select id into f from public.flagged_texts where user_id = b and source = 'bio';
  perform pg_temp.as_user(adm, 'aal2');
  return next ok((select q.removable from public.admin_flag_queue() q where q.flag_id = f), 'a bio can be removed');
  perform pg_temp.as_owner();
  return next is(pg_temp.as_admin(adm, format('select public.admin_decide_flag(%s, ''remove'', ''bof'')', f)),
    '22023 reason_required', 'removing needs a motive');
  return next is(pg_temp.as_admin(adm, format('select public.admin_decide_flag(%s, ''remove'', %L)', f, motive)), 'ok', 'removed');
  return next ok((select bio is null from public.profiles where id = b), 'the bio is erased');
  return next ok((select status = 'upheld' and decision_reason = motive from public.flagged_texts where id = f), 'the flag is upheld');
  return next ok(exists (select 1 from public.moderation_actions where flag_id = f and action = 'text_remove'), 'recorded');
  return next is(pg_temp.notified(b, 'sanction'), 1, 'the member is told');

  insert into public.flagged_texts (user_id, source, source_id, excerpt, matched_terms)
  values (b, 'pseudo', b::text, 'pseudo', '{x}') returning id into f;
  return next is(pg_temp.as_admin(adm, format('select public.admin_decide_flag(%s, ''remove'', %L)', f, motive)),
    '23514 not_removable', 'a pseudo is not erased by the Greffe');
  return next is(pg_temp.as_admin(adm, format('select public.admin_decide_flag(%s, ''uphold'', %L)', f, motive)), 'ok', 'it is upheld');
  insert into public.flagged_texts (user_id, source, source_id, excerpt, matched_terms)
  values (b, 'casier', b::text || ':1', 'casier', '{x}') returning id into f;
  return next is(pg_temp.as_admin(adm, format('select public.admin_decide_flag(%s, ''clear'')', f)), 'ok', 'cleared');
  return next ok((select status = 'rejected' from public.flagged_texts where id = f)
                 and exists (select 1 from public.moderation_actions where flag_id = f and action = 'text_clear'),
    'cleared and recorded');
  return next is(pg_temp.notified(b, 'sanction'), 1, 'a cleared flag tells nobody');

  -- A message and the note of the request.
  conv := pg_temp.released(b, v);
  return next is(pg_temp.say(v, conv, 'Bonjour arnaquezmoi'), 'ok', 'a flagged message is sent');
  select id into f from public.flagged_texts where user_id = v and source = 'message';
  mid := pg_temp.last_message(conv);
  perform pg_temp.as_admin(adm, format('select public.admin_decide_flag(%s, ''remove'', %L)', f, motive));
  perform pg_temp.as_user(b);
  return next ok((select m.body is null from public.get_messages(conv) m where m.id = mid), 'the message reads as removed');
  perform pg_temp.as_owner();
  select request_id into req from public.conversations where id = conv;
  insert into public.flagged_texts (user_id, source, source_id, excerpt, matched_terms)
  values (v, 'visit_request', req::text, 'note', '{x}') returning id into f;
  perform pg_temp.as_admin(adm, format('select public.admin_decide_flag(%s, ''remove'', %L)', f, motive));
  return next ok((select note is null from public.visit_requests where id = req), 'the note is erased');
  return next ok(not exists (select 1 from public.messages where conversation_id = conv and system_payload ->> 'type' = 'note'),
    'from the Parloir too');
  return next is(pg_temp.as_admin(adm, format('select public.admin_decide_flag(%s, ''clear'')', f)), '23514 already_decided',
    'one decision per flag');
end $$;

----------------------------------------------------------------------------------------------
-- Search and member record
----------------------------------------------------------------------------------------------
create function pg_temp.test_find_and_record() returns setof text language plpgsql as $$
declare pl bigint := pg_temp.new_place(); b uuid; adm uuid; ps text; ec text; j jsonb;
begin
  b := pg_temp.bad('find-me@test.local', pl);
  adm := pg_temp.new_admin('admin@test.local');
  select pseudo::text, ecrou::text into ps, ec from public.profiles where id = b;
  perform pg_temp.as_user(adm, 'aal2');
  return next ok(exists (select 1 from public.admin_find_members(left(ps, 5)) f where f.user_id = b), 'by the start of the pseudo');
  return next ok(not exists (select 1 from public.admin_find_members(ec) f), 'never by the N° d''écrou');
  return next ok(exists (select 1 from public.admin_find_members('FIND-ME@test.local') f where f.user_id = b), 'by the exact e-mail');
  return next ok(not exists (select 1 from public.admin_find_members('find-me@') f), 'never by a part of the e-mail');
  return next ok(not exists (select 1 from public.admin_find_members('%%') f), 'wildcards are literal');
  perform public.admin_sanction(b, 'warn', 'Premier avertissement.');
  j := public.admin_member(b);
  perform pg_temp.as_owner();
  return next is(j -> 'actions' -> 0 ->> 'action', 'warn', 'the record lists the decisions');
  return next ok(position('find-me' in j::text) = 0 and position(ec in j::text) = 0, 'never the e-mail nor the N° d''écrou');
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
