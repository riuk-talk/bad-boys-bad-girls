-- Phase 10c (pgTAP): the navigation of /admin (owner's request 2026-11-07). Three read-only
-- functions for an admin with the second factor: admin_counts() (numbers only), admin_dashboard()
-- (real figures and the 10 oldest items waiting) and admin_search_members(q) (pseudo or N° d'écrou
-- by part, e-mail exact only). A member, an anonymous visitor and an admin at aal1 are refused;
-- nothing is written. Every test_* function runs in its own rolled-back transaction (runtests).

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

create function pg_temp.new_admin() returns uuid language plpgsql as $$
declare a uuid := pg_temp.new_member('visitor');
begin
  insert into public.admin_users (user_id) values (a);
  return a;
end $$;

-- A Bad a Visitor could find: active, 3 validated poses, a Casier (true line = 2).
create function pg_temp.visible_bad() returns uuid language plpgsql as $$
declare b uuid := pg_temp.new_member('bad');
begin
  update public.profiles set last_seen_at = now() where id = b;
  -- Inserted pending (a trigger sees to it), then validated as cut out.
  insert into public.photos (owner_id, position, pending_path)
  select b, p, b || '/' || p || '.webp' from generate_series(0, 2) p;
  update public.photos set status = 'approved', pending_path = null, is_cutout = true,
    public_path_large = gen_random_uuid() || '.webp', public_path_small = gen_random_uuid() || '-s.webp'
  where owner_id = b;
  insert into public.casier_charges (profile_id, charge_1, charge_2, charge_3, true_index)
  values (b, 'Premier', 'Le vrai', 'Troisième', 2);
  return b;
end $$;

-- Everything an admin function could write: none of these counts may move.
create function pg_temp.writes() returns text language sql as $$
  select concat_ws('/',
    (select count(*) from public.photos where status = 'pending'),
    (select count(*) from public.reports where status = 'open'),
    (select count(*) from public.flagged_texts where status = 'open'),
    (select count(*) from public.moderation_actions),
    (select count(*) from public.greffe_fiche_views),
    (select count(*) from public.notifications),
    (select count(*) from public.email_outbox),
    (select count(*) from public.push_outbox),
    (select coalesce(max(updated_at)::text, '') from public.profiles),
    (select coalesce(max(last_seen_at)::text, '') from public.profiles))
$$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_admins_only() returns setof text language plpgsql as $$
declare
  b uuid := pg_temp.visible_bad();
  v uuid := pg_temp.new_member('visitor');
  calls text[] := array[
    'select * from public.admin_counts()',
    'select public.admin_dashboard()',
    'select * from public.admin_search_members(''ab'')'];
  call text;
  aal1 uuid := pg_temp.new_member('visitor');
begin
  insert into public.admin_users (user_id) values (aal1);
  foreach call in array calls loop
    perform pg_temp.as_user(v);
    return next matches(coalesce(pg_temp.try(call), 'ok'), '^42501', 'a Visitor is refused: ' || call);
    perform pg_temp.as_owner();
    perform pg_temp.as_user(b);
    return next matches(coalesce(pg_temp.try(call), 'ok'), '^42501', 'a Bad is refused: ' || call);
    perform pg_temp.as_owner();
    perform pg_temp.as_anon();
    return next matches(coalesce(pg_temp.try(call), 'ok'), '^42501', 'an anonymous visitor is refused: ' || call);
    perform pg_temp.as_owner();
    perform pg_temp.as_user(aal1);
    return next matches(coalesce(pg_temp.try(call), 'ok'), '^42501', 'an admin at aal1 is refused: ' || call);
    perform pg_temp.as_owner();
  end loop;
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_counts_and_dashboard() returns setof text language plpgsql as $$
declare
  adm uuid := pg_temp.new_admin();
  b uuid;
  v uuid := pg_temp.new_member('visitor');
  seed uuid;
  c0 record; c1 record;
  d0 jsonb; d1 jsonb;
  before text;
  todo jsonb;
begin
  perform pg_temp.as_admin(adm);
  select * into c0 from public.admin_counts();
  d0 := public.admin_dashboard();
  perform pg_temp.as_owner();

  b := pg_temp.visible_bad();
  -- A seed profile (development data) is never counted.
  seed := pg_temp.new_member('bad');
  update public.profiles set is_seed = true where id = seed;
  -- Waiting: one photo at the Greffe, one open report, one open flagged text (oldest first).
  insert into public.photos (owner_id, position, pending_path) values (v, 0, v || '/0.webp');
  update public.photos set created_at = now() - interval '3 hours' where owner_id = v;
  insert into public.reports (reporter_id, target_user_id, target_type, target_id, category, created_at)
  values (v, b, 'profile', b::text, 'scam', now() - interval '2 hours');
  insert into public.flagged_texts (user_id, source, source_id, excerpt, matched_terms, created_at)
  values (b, 'pseudo', b::text, 'pseudo', '{x}', now() - interval '1 hour');

  before := pg_temp.writes();
  perform pg_temp.as_admin(adm);
  select * into c1 from public.admin_counts();
  d1 := public.admin_dashboard();
  perform pg_temp.as_owner();

  return next is(c1.photos_pending - c0.photos_pending, 1, 'the photo waiting at the Greffe is counted');
  return next is(c1.reports_open - c0.reports_open, 1, 'the open report is counted');
  return next is(c1.flags_open - c0.flags_open, 1, 'the open flagged text is counted');
  return next is((d1 ->> 'bads_registered')::int - (d0 ->> 'bads_registered')::int, 1,
    'one Bad more, the seed profile left out');
  return next is((d1 ->> 'bads_complete')::int - (d0 ->> 'bads_complete')::int, 1, 'and its Fiche is complete');
  return next is((d1 ->> 'bads_visible')::int - (d0 ->> 'bads_visible')::int, 0,
    'not visible: its quartier is not open');
  return next is((d1 ->> 'visitors_registered')::int - (d0 ->> 'visitors_registered')::int, 0,
    'the Visitor was already there');
  return next is((d1 ->> 'photos_pending')::int, c1.photos_pending, 'the dashboard shows the same counters');
  return next is((d1 ->> 'zones_open')::int + (d1 ->> 'zones_waitlist')::int,
    (select count(*)::int from public.launch_zones), 'every quartier is open or waiting');
  return next is((d1 ->> 'emails_app_quota')::int,
    (select (email_daily_quota - email_auth_reserve)::int from public.app_settings where id), 'the e-mail quota of the app');
  return next ok(d1 ? 'emails_sent_today' and d1 ? 'push_queued', 'e-mails of the day and notifications waiting');
  todo := d1 -> 'todo';
  return next ok(jsonb_array_length(todo) between 3 and 10, 'at most 10 items to deal with');
  return next ok((select bool_and((e ->> 'created_at')::timestamptz >= (todo -> 0 ->> 'created_at')::timestamptz)
                  from jsonb_array_elements(todo) e), 'the oldest first');
  return next ok(exists (select 1 from jsonb_array_elements(todo) e where e ->> 'kind' = 'photo')
             and exists (select 1 from jsonb_array_elements(todo) e where e ->> 'kind' = 'report')
             and exists (select 1 from jsonb_array_elements(todo) e where e ->> 'kind' = 'flag'),
    'photos, reports and flagged texts');
  return next ok(not (d1::text ~ 'true_index') and not (d1::text ~ '@'),
    'no true charge and no e-mail in the dashboard');
  return next is(pg_temp.writes(), before, 'read only: nothing written');
end $$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_search() returns setof text language plpgsql as $$
declare
  adm uuid := pg_temp.new_admin();
  b uuid := pg_temp.visible_bad();
  v uuid := pg_temp.new_member('visitor');
  e text;
  p text;
  before text;
  found integer;
begin
  update auth.users set email = 'lune.cachee@example.com' where id = v;
  update public.profiles set pseudo = 'Gitanelle' where id = v;
  e := (select ecrou from public.profiles where id = b);
  p := (select pseudo from public.profiles where id = b);
  before := pg_temp.writes();
  perform pg_temp.as_admin(adm);
  return next ok(exists (select 1 from public.admin_search_members('itanel') where user_id = v),
    'a part of a pseudo finds the account');
  return next ok(exists (select 1 from public.admin_search_members(substr(e, 2, 4)) where user_id = b),
    'a part of a N° d''écrou finds the Bad');
  return next ok(exists (select 1 from public.admin_search_members('LUNE.cachee@example.com') where user_id = v),
    'the exact e-mail finds the account (any case)');
  return next is((select count(*)::int from public.admin_search_members('lune.cachee@example')), 0,
    'a part of an e-mail finds nothing');
  return next is((select count(*)::int from public.admin_search_members('@example.com')), 0,
    'nor the domain alone');
  return next is((select count(*)::int from public.admin_search_members('lune.cachee')), 0,
    'nor the part before the @');
  return next is((select count(*)::int from public.admin_search_members('a')), 0, 'one character: nothing');
  return next is((select count(*)::int from public.admin_search_members('%')), 0,
    'the wildcards are taken as text');
  return next ok((select count(*) <= 20 from public.admin_search_members('ab')), 'at most 20 results');
  select count(*) into found from public.admin_search_members(p) where user_id = b;
  return next is(found, 1, 'the exact pseudo, once');
  perform pg_temp.as_owner();
  return next is(
    (select array_agg(a order by a) from unnest((select proargnames from pg_proc
      where proname = 'admin_search_members')) a),
    array['created_at', 'p_query', 'pseudo', 'role', 'state', 'user_id'],
    'what the Membres list shows: never the N° d''écrou, the e-mail or the true charge');
  return next is(pg_temp.writes(), before, 'read only: nothing written');
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
