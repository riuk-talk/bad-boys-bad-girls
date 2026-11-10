-- Phase 10d (pgTAP, owner's feedback 2026-11-10): the unfinished dossier, the search criteria and
-- what an admin can now see.
--  - onboarding_missing() gives exactly what complete_onboarding() refuses on (single source);
--  - the Greffe validating the last pose of a Bad finishes a complete dossier and tells the Bad
--    (« fiche_online »), or tells what is still missing (« dossier_incomplete »);
--  - search_empty_reason(): why a Visitor's list is empty, never revealing a block;
--  - admin_list_members / admin_member_detail / admin_unconfirmed_accounts: admins with the
--    second factor only; the detail never gives the true charge of the Casier (règle 14) and is
--    logged; the unconfirmed accounts give a date and a domain, never the address.
-- Every test_* function runs in its own rolled-back transaction (runtests).

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

-- The detail of the error complete_onboarding raises (the missing items), '' when it succeeds.
create function pg_temp.complete_detail() returns text language plpgsql as $$
declare d text;
begin
  perform public.complete_onboarding();
  return '';
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return d;
end $$;

create function pg_temp.new_admin() returns uuid language plpgsql as $$
declare a uuid := pg_temp.new_member('visitor');
begin
  insert into public.admin_users (user_id) values (a);
  return a;
end $$;

create function pg_temp.consents(p_user uuid, p_types text[]) returns void language plpgsql as $$
declare t text;
begin
  foreach t in array p_types loop
    insert into public.consents (user_id, type, text_version, granted) values (p_user, t::public.consent_type, 'v1', true);
  end loop;
end $$;

create function pg_temp.answer_core(p_user uuid) returns void language sql as $$
  insert into public.answers (user_id, question_id, option_id)
  select p_user, q.id, q.id * 10 + 1 from public.questions q where q.phase = 'core' and q.is_active
$$;

-- The 3 poses, sent cut out (the server's finding on the file, as the upload records it).
create function pg_temp.poses(p_user uuid) returns void language sql as $$
  insert into public.photos (owner_id, position, pending_path)
  select p_user, p, p_user || '/' || p || '.webp' from generate_series(0, 2) p;
  update public.photos set is_cutout = true, needs_cutout = false where owner_id = p_user;
$$;

create function pg_temp.casier(p_user uuid) returns void language sql as $$
  insert into public.casier_charges (profile_id, charge_1, charge_2, charge_3, true_index)
  values (p_user, 'Premier chef', 'Le vrai chef', 'Troisième chef', 2)
$$;

-- A Bad a Visitor could find: active, 3 validated poses, a Casier.
create function pg_temp.visible_bad(p_gender public.gender default 'man',
  p_birthdate date default date '1990-01-01') returns uuid language plpgsql as $$
declare b uuid := pg_temp.new_member('bad', true, p_gender, p_birthdate);
begin
  update public.profiles set last_seen_at = now() where id = b;
  perform pg_temp.poses(b);
  update public.photos set status = 'approved', pending_path = null, is_cutout = true,
    public_path_large = gen_random_uuid() || '.webp', public_path_small = gen_random_uuid() || '-s.webp'
  where owner_id = b;
  perform pg_temp.casier(b);
  delete from public.notifications where user_id = b;
  return b;
end $$;

-- The Greffe validates one pose (as an admin with the second factor).
create function pg_temp.approve(p_admin uuid, p_owner uuid, p_position integer) returns text
language plpgsql as $$
declare ph uuid := (select id from public.photos where owner_id = p_owner and position = p_position);
declare r text;
begin
  perform pg_temp.as_admin(p_admin);
  r := pg_temp.try(format('select public.admin_decide_photo(%L, true, null, %L, %L)', ph,
    gen_random_uuid() || '.webp', gen_random_uuid() || '-s.webp'));
  perform pg_temp.as_owner();
  return r;
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_rights() returns setof text language plpgsql as $$
declare
  v uuid := pg_temp.new_member('visitor');
  b uuid := pg_temp.visible_bad();
  aal1 uuid := pg_temp.new_member('visitor');
  calls text[] := array[
    'select * from public.admin_list_members()',
    format('select public.admin_member_detail(%L)', b),
    'select * from public.admin_unconfirmed_accounts()'];
  call text;
begin
  insert into public.admin_users (user_id) values (aal1);
  foreach call in array calls loop
    perform pg_temp.as_anon();
    return next matches(coalesce(pg_temp.try(call), 'ok'), '^42501', 'anonymous refused: ' || call);
    perform pg_temp.as_owner();
    perform pg_temp.as_user(v);
    return next matches(coalesce(pg_temp.try(call), 'ok'), '^42501', 'a member refused: ' || call);
    perform pg_temp.as_owner();
    perform pg_temp.as_user(aal1);
    return next matches(coalesce(pg_temp.try(call), 'ok'), '^42501', 'an admin at aal1 refused: ' || call);
    perform pg_temp.as_owner();
  end loop;
  perform pg_temp.as_anon();
  return next matches(coalesce(pg_temp.try('select public.onboarding_missing()'), 'ok'), '^42501',
    'anonymous cannot ask what a dossier lacks');
  return next matches(coalesce(pg_temp.try('select public.search_empty_reason()'), 'ok'), '^42501',
    'anonymous cannot ask why a list is empty');
  perform pg_temp.as_owner();
  perform pg_temp.as_user(b);
  return next matches(coalesce(pg_temp.try('select public.search_empty_reason()'), 'ok'), '^42501',
    'a Bad has no Découverte to explain');
  perform pg_temp.as_owner();
  return next is((select count(*)::integer from public.greffe_fiche_views where bad_id = b), 0,
    'a refused call logs nothing');
end $$;

----------------------------------------------------------------------------------------------
-- complete_onboarding refuses exactly on what onboarding_missing lists, at every stage.
create function pg_temp.test_missing_is_complete_onboarding() returns setof text language plpgsql as $$
declare
  b uuid := pg_temp.new_member('bad', false);
  v uuid := pg_temp.new_member('visitor', false);
  bare uuid := pg_temp.new_user();
  m text[];
  stage text;
  u uuid;
begin
  perform pg_temp.as_user(bare);
  return next is(public.onboarding_missing(),
    array['birthdate', 'identity', 'role', 'seeking', 'consents', 'consent_art9', 'photo', 'core_answers'],
    'no profile yet: everything is missing');
  return next matches(coalesce(pg_temp.try('select public.complete_onboarding()'), 'ok'), '^P0002',
    'and complete_onboarding has no profile to finish');
  perform pg_temp.as_owner();

  foreach u in array array[b, v] loop
    foreach stage in array array['start', 'consents', 'art9', 'photos', 'answers', 'casier'] loop
      case stage
        when 'consents' then perform pg_temp.consents(u, array['terms', 'privacy', 'age_18']);
        when 'art9' then perform pg_temp.consents(u, array['art9_seeking']);
        when 'photos' then
          if u = b then perform pg_temp.poses(u);
          else insert into public.photos (owner_id, position, pending_path) values (u, 0, u || '/0.webp');
          end if;
        when 'answers' then perform pg_temp.answer_core(u);
        when 'casier' then if u = b then perform pg_temp.casier(u); end if;
        else null;
      end case;
      perform pg_temp.as_user(u);
      m := public.onboarding_missing();
      return next is(pg_temp.complete_detail(), array_to_string(m, ','),
        format('%s, stage %s: complete_onboarding refuses on exactly %s',
               case when u = b then 'Bad' else 'Visitor' end, stage, coalesce(array_to_string(m, ','), '')));
      perform pg_temp.as_owner();
    end loop;
  end loop;
  return next ok((select onboarding_completed_at is not null from public.profiles where id = b),
    'the Bad is finished once nothing is missing');
  return next ok((select onboarding_completed_at is not null from public.profiles where id = v),
    'the Visitor too');
  -- The consents read the latest answer of each type: a withdrawn art. 9 consent is missing again.
  insert into public.consents (user_id, type, text_version, granted, created_at)
    values (b, 'art9_seeking', 'v1', false, now() + interval '1 second');
  perform pg_temp.as_user(b);
  return next is(public.onboarding_missing(), array['consent_art9'], 'a withdrawn consent is missing again');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
-- The Greffe validates the last pose of a Bad.
create function pg_temp.test_last_pose() returns setof text language plpgsql as $$
declare
  adm uuid := pg_temp.new_admin();
  full_bad uuid := pg_temp.new_member('bad', false);
  no_casier uuid := pg_temp.new_member('bad', false);
  done_bad uuid := pg_temp.new_member('bad', true);
  v uuid := pg_temp.new_member('visitor', false);
  u uuid;
begin
  foreach u in array array[full_bad, no_casier, done_bad] loop
    perform pg_temp.consents(u, array['terms', 'privacy', 'age_18', 'art9_seeking']);
    perform pg_temp.answer_core(u);
    perform pg_temp.poses(u);
  end loop;
  perform pg_temp.casier(full_bad);
  perform pg_temp.casier(done_bad);
  perform pg_temp.consents(v, array['terms', 'privacy', 'age_18', 'art9_seeking']);
  insert into public.photos (owner_id, position, pending_path) values (v, 0, v || '/0.webp');

  return next is(pg_temp.approve(adm, full_bad, 0), null, 'the face is validated');
  return next is(pg_temp.approve(adm, full_bad, 1), null, 'the left profile is validated');
  return next is((select count(*)::integer from public.notifications
                  where user_id = full_bad and type in ('fiche_online', 'dossier_incomplete')), 0,
    'two poses out of three: no notice yet');
  return next ok((select onboarding_completed_at is null from public.profiles where id = full_bad),
    'and the dossier is not finished');
  return next is(pg_temp.approve(adm, full_bad, 2), null, 'the right profile is validated');
  return next ok((select onboarding_completed_at is not null and onboarding_step = 8
                  from public.profiles where id = full_bad),
    'the last pose finishes a dossier that lacks nothing else');
  return next is((select array_agg(type::text) from public.notifications
                  where user_id = full_bad and type in ('fiche_online', 'dossier_incomplete')),
    array['fiche_online'], 'the Bad is told « Ta Fiche est en ligne », once');
  return next is((select array_agg(kind::text) from public.email_outbox
                  where user_id = full_bad and kind in ('fiche_online', 'dossier_incomplete')),
    array['fiche_online'], 'by e-mail too');

  perform pg_temp.approve(adm, no_casier, 0);
  perform pg_temp.approve(adm, no_casier, 1);
  perform pg_temp.approve(adm, no_casier, 2);
  return next ok((select onboarding_completed_at is null from public.profiles where id = no_casier),
    'something else missing: the dossier stays unfinished');
  return next is((select payload from public.notifications where user_id = no_casier and type = 'dossier_incomplete'),
    '{"missing": ["casier"]}'::jsonb, 'the notice says what is missing');
  return next is((select payload from public.email_outbox where user_id = no_casier and kind = 'dossier_incomplete'),
    '{"missing": ["casier"]}'::jsonb, 'and so does the e-mail');
  return next is((select count(*)::integer from public.notifications where user_id = no_casier and type = 'fiche_online'),
    0, 'never « en ligne » with something missing');

  perform pg_temp.approve(adm, done_bad, 0);
  perform pg_temp.approve(adm, done_bad, 1);
  perform pg_temp.approve(adm, done_bad, 2);
  return next is((select count(*)::integer from public.notifications where user_id = done_bad and type = 'fiche_online'),
    1, 'a Bad already finished is told its Fiche is online when the last pose is validated');

  perform pg_temp.approve(adm, v, 0);
  return next is((select count(*)::integer from public.notifications
                  where user_id = v and type in ('fiche_online', 'dossier_incomplete')), 0,
    'a Visitor''s photo: the Permis, not these notices');
  return next ok((select onboarding_completed_at is null from public.profiles where id = v),
    'and a Visitor''s dossier is never finished by the Greffe');
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_search_empty_reason() returns setof text language plpgsql as $$
declare
  -- Ages no other test member has: 61 for the Visitor, 63 for the Bad.
  v uuid := pg_temp.new_member('visitor', true, 'woman', (current_date - interval '61 years 2 months')::date);
  b uuid := pg_temp.visible_bad('man', (current_date - interval '63 years 2 months')::date);
begin
  update public.app_settings set launch_mode = 'open' where id;
  update public.profiles set seeking_genders = '{man}', seek_age_min = 62, seek_age_max = 64 where id = v;
  update public.profiles set seeking_genders = '{woman}', seek_age_min = 60, seek_age_max = 62 where id = b;
  perform pg_temp.as_user(v);
  return next is(public.search_empty_reason(), null, 'a Bad fits both ways: no reason to give');
  perform pg_temp.as_owner();
  update public.profiles set seek_age_min = 18, seek_age_max = 30 where id = b;
  perform pg_temp.as_user(v);
  return next is(public.search_empty_reason(), 'no_bad_accepts', 'the Visitor fits the criteria of no Bad');
  perform pg_temp.as_owner();
  update public.profiles set seek_age_min = 60, seek_age_max = 62 where id = b;
  update public.profiles set seek_age_min = 62, seek_age_max = 62 where id = v;
  perform pg_temp.as_user(v);
  return next is(public.search_empty_reason(), 'no_bad_matches', 'no Bad fits the Visitor''s criteria');
  perform pg_temp.as_owner();
  update public.profiles set seek_age_min = 62, seek_age_max = 64 where id = v;
  insert into public.blocks (blocker_id, blocked_id) values (b, v);
  perform pg_temp.as_user(v);
  return next is(public.search_empty_reason(), 'no_bad_matches',
    'a Bad that blocked the Visitor counts as absent (the block is never revealed)');
  perform pg_temp.as_owner();
  update public.app_settings set launch_mode = 'zones' where id;
  update public.profiles set zone_id = null where id = v;
  perform pg_temp.as_user(v);
  return next is(public.search_empty_reason(), 'zone_closed', 'the quartier is not open');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_member_detail() returns setof text language plpgsql as $$
declare
  adm uuid := pg_temp.new_admin();
  b uuid := pg_temp.visible_bad();
  paused uuid := pg_temp.visible_bad();
  no_casier uuid := pg_temp.new_member('bad', true);
  unfinished uuid := pg_temp.new_member('bad', false);
  bare uuid := pg_temp.new_user();
  d jsonb;
  u uuid;
begin
  update public.app_settings set launch_mode = 'open' where id;
  update public.profiles set is_paused = true where id = paused;
  update public.profiles set last_seen_at = now() where id in (no_casier, unfinished);
  insert into public.profile_tribes (profile_id, tribe_id) select b, id from public.tribes order by sort limit 1;
  perform pg_temp.as_admin(adm);
  d := public.admin_member_detail(b);
  perform pg_temp.as_owner();
  return next is(d -> 'casier', '["Premier chef", "Le vrai chef", "Troisième chef"]'::jsonb,
    'the 3 charges as the Visitors read them');
  return next ok(d::text !~* 'true_index' and not (d ? 'true_index'), 'never which one is true (règle 14)');
  return next is(d -> 'hidden_reasons', '[]'::jsonb, 'a visible Bad: no reason');
  return next is(d ->> 'answers', (select count(*)::text from public.answers where user_id = b), 'the number of answers');
  return next is(jsonb_array_length(d -> 'photos'), 3, 'the 3 poses with their status');
  return next is(jsonb_array_length(d -> 'tribes'), 1, 'the signes distinctifs');
  return next is((select count(*)::integer from public.greffe_fiche_views
                  where bad_id = b and admin_id = adm and context = 'member'), 1, 'the opening is logged');
  -- discover_hidden_reasons() is is_bad_visible(), condition by condition.
  foreach u in array array[b, paused, no_casier, unfinished] loop
    perform pg_temp.as_admin(adm);
    d := public.admin_member_detail(u);
    perform pg_temp.as_owner();
    return next is(jsonb_array_length(d -> 'hidden_reasons') = 0,
      (select public.is_bad_visible(p) from public.profiles p where p.id = u),
      'the reasons are empty exactly when the Bad is visible');
    return next is(d -> 'missing', to_jsonb(private.onboarding_missing_for(u)), 'what the dossier lacks');
  end loop;
  perform pg_temp.as_admin(adm);
  return next ok(public.admin_member_detail(paused) -> 'hidden_reasons' ? 'paused', 'a paused Bad: « paused »');
  return next ok(public.admin_member_detail(no_casier) -> 'hidden_reasons' ? 'no_casier', 'no Casier: « no_casier »');
  return next ok(public.admin_member_detail(unfinished) -> 'hidden_reasons' ? 'dossier_incomplete',
    'unfinished: « dossier_incomplete »');
  d := public.admin_member_detail(bare);
  return next is(d ->> 'has_profile', 'false', 'an account without a profile yet has a record too');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_list_and_dashboard() returns setof text language plpgsql as $$
declare
  adm uuid := pg_temp.new_admin();
  b uuid := pg_temp.visible_bad();
  blk uuid := pg_temp.visible_bad();
  v uuid := pg_temp.new_member('visitor', false);
  bare uuid := pg_temp.new_user();
  unconfirmed uuid := pg_temp.new_user(null, false);
  seed uuid := pg_temp.new_member('bad', true);
  d0 jsonb; d1 jsonb;
begin
  update public.profiles set is_seed = true where id = seed;
  perform pg_temp.as_admin(adm);
  d0 := public.admin_dashboard();
  perform pg_temp.as_owner();
  update public.profiles set onboarding_completed_at = null where id = blk;
  perform pg_temp.as_admin(adm);
  d1 := public.admin_dashboard();
  return next is((d1 ->> 'dossiers_blocked')::int - (d0 ->> 'dossiers_blocked')::int, 1,
    'a Bad with its 3 poses validated but an unfinished dossier is a blocked dossier');
  return next is((d1 ->> 'bads_three_photos')::int, (d0 ->> 'bads_three_photos')::int,
    'still counted among the Bads with 3 validated photos');
  return next is((d1 ->> 'bads_complete')::int - (d0 ->> 'bads_complete')::int, -1,
    'not among the finished dossiers');
  return next ok(exists (select 1 from public.admin_list_members(p_blocked => true) m where m.user_id = blk),
    'the blocked filter lists it');
  return next ok(not exists (select 1 from public.admin_list_members(p_blocked => true) m where m.user_id = b),
    'and not a finished Bad');
  return next ok(exists (select 1 from public.admin_list_members(p_role => 'visitor', p_complete => false) m
                         where m.user_id = v), 'filters role and unfinished');
  return next ok(not exists (select 1 from public.admin_list_members(p_role => 'bad') m where m.user_id = v),
    'a Visitor is not in the Bads');
  return next ok(exists (select 1 from public.admin_list_members(p_state => 'not_started') m where m.user_id = bare),
    'a confirmed account without a profile yet is listed, « not_started »');
  return next ok(not exists (select 1 from public.admin_list_members() m where m.user_id in (unconfirmed, seed)),
    'neither an unconfirmed account nor a seed profile');
  return next ok((select bool_and(m.total >= 4) from public.admin_list_members() m), 'the total comes with each row');
  return next is((select count(*)::integer from public.admin_list_members(p_page => 1000)), 0, 'past the last page: nothing');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_unconfirmed_accounts() returns setof text language plpgsql as $$
declare
  adm uuid := pg_temp.new_admin();
  typo uuid := pg_temp.new_user('lune.typo@gmail.comj', false);
  fresh uuid := pg_temp.new_user('fresh.typo@hotmial.com', false);
begin
  update auth.users set created_at = now() - interval '3 days' where id = typo;
  update auth.users set created_at = now() - interval '1 day' where id = fresh;
  perform pg_temp.as_admin(adm);
  return next ok(exists (select 1 from public.admin_unconfirmed_accounts() a
                         where a.domain = 'gmail.comj' and a.created_at = now() - interval '3 days'),
    'unconfirmed for more than 48 hours: its date and its domain');
  return next ok(not exists (select 1 from public.admin_unconfirmed_accounts() a where a.domain = 'hotmial.com'),
    'not before 48 hours');
  return next ok(not exists (select 1 from public.admin_unconfirmed_accounts() a where a::text ~ 'lune'),
    'never the address itself');
  perform pg_temp.as_owner();
  return next is((select proargnames from pg_proc where proname = 'admin_unconfirmed_accounts'),
    array['created_at', 'domain'], 'the function returns a date and a domain, nothing else');
  perform pg_temp.as_admin(adm);
  perform pg_temp.as_owner();
end $$;

select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
