-- Phase 10a (pgTAP): « Vue Greffe », the site seen as a Visitor by an admin (owner's request
-- 2026-11-06). Only an admin with the second factor calls the three functions; a member, an
-- anonymous visitor and an admin at aal1 are refused. Read only: nothing is written about the
-- Bads (no request, no « seen », no notification), only the Greffe's own log of the Fiches
-- opened; the true charge of the Casier is never returned. Every test_* function runs in its own
-- rolled-back transaction (runtests).

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

-- What may never change when the Greffe looks: the relations and traces of the Bads.
create function pg_temp.traces() returns text language sql as $$
  select concat_ws('/',
    (select count(*) from public.visit_requests),
    (select count(*) from public.promenade_picks where seen_at is not null),
    (select count(*) from public.notifications),
    (select count(*) from public.conversations),
    (select count(*) from public.blocks),
    (select count(*) from public.reports),
    (select coalesce(max(last_seen_at)::text, '') from public.profiles))
$$;

----------------------------------------------------------------------------------------------
create function pg_temp.test_admins_only() returns setof text language plpgsql as $$
declare
  b uuid := pg_temp.visible_bad();
  v uuid := pg_temp.new_member('visitor');
  calls text[] := array[
    'select * from public.admin_view_discover()',
    'select * from public.admin_view_promenade(1::smallint)',
    format('select public.admin_view_fiche(%L)', b)];
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
    -- An admin without the second factor (aal1).
    perform pg_temp.as_user(aal1);
    return next matches(coalesce(pg_temp.try(call), 'ok'), '^42501', 'an admin at aal1 is refused: ' || call);
    perform pg_temp.as_owner();
  end loop;
  return next is((select count(*)::int from public.greffe_fiche_views), 0, 'nothing logged for a refused call');
end $$;

create function pg_temp.test_discover_and_promenade() returns setof text language plpgsql as $$
declare
  adm uuid := pg_temp.new_admin();
  b uuid := pg_temp.visible_bad();
  paused uuid := pg_temp.visible_bad();
  v uuid := pg_temp.new_member('visitor');
  w uuid := pg_temp.new_member('visitor');
  z smallint;
  place bigint;
  before text;
begin
  update public.profiles set is_paused = true where id = paused;
  -- A quartier that is NOT open: the Greffe still sees its Bads (no quartier filter).
  select place_id into place from public.profiles where id = b;
  insert into public.launch_zones (slug, name, center_place_id, radius_km, threshold_bads, status)
    values ('greffe-test', 'Quartier test', place, 30, 5, 'waitlist') returning id into z;
  update public.profiles set zone_id = z where id = b;
  insert into public.promenade_picks (visitor_id, bad_id, zone_id, promenade_date, rank, score, visible_from, visible_until)
  values (v, b, z, (now() at time zone 'Europe/Paris')::date, 2, 80, now() - interval '1 hour', now() + interval '1 hour'),
         (w, b, z, (now() at time zone 'Europe/Paris')::date, 1, 90, now() - interval '1 hour', now() + interval '1 hour');
  before := pg_temp.traces();
  perform pg_temp.as_admin(adm);
  return next ok(exists (select 1 from public.admin_view_discover(null, null, 100) d where d.id = b),
    'the Découverte of the Greffe lists a visible Bad, whatever its quartier');
  return next ok(not exists (select 1 from public.admin_view_discover(null, null, 100) d where d.id = paused),
    'but not a Bad a Visitor could not find (paused)');
  return next is((select row(p.best_rank, p.visitors)::text from public.admin_view_promenade(z) p where p.id = b),
    '(1,2)', 'the Promenade of the day of the quartier: once per Bad, its best rank and how many Visitors drew it');
  perform pg_temp.as_owner();
  return next is(pg_temp.traces(), before, 'read only: no request, no « seen », no notification, nothing changed');
end $$;

create function pg_temp.test_fiche_read_only_and_logged() returns setof text language plpgsql as $$
declare
  adm uuid := pg_temp.new_admin();
  b uuid := pg_temp.visible_bad();
  hidden uuid := pg_temp.visible_bad();
  fiche jsonb;
  before text;
begin
  update public.profiles set hidden_reason = 'test' where id = hidden;
  before := pg_temp.traces();
  perform pg_temp.as_admin(adm);
  fiche := public.admin_view_fiche(b);
  return next is(fiche -> 'charges', '["Premier", "Le vrai", "Troisième"]'::jsonb, 'the Casier is there, in its order');
  return next ok(not (fiche::text ~ 'true_index') and fiche ->> 'true_index' is null,
    'the true charge is never returned, not even to the Greffe (règle 14)');
  return next is(jsonb_array_length(fiche -> 'photos'), 3, 'the 3 poses');
  return next ok(fiche -> 'complicity' = 'null'::jsonb and fiche -> 'my_request_status' = 'null'::jsonb
                 and fiche -> 'common_points' = '[]'::jsonb,
    'nothing that depends on a viewer');
  return next matches(coalesce(pg_temp.try(format('select public.admin_view_fiche(%L)', hidden)), 'ok'),
    '^P0002 not_found', 'a Bad a Visitor could not find is not shown');
  perform pg_temp.as_owner();
  return next is(pg_temp.traces(), before, 'read only: nothing written about the Bad');
  return next ok((select count(*) = 1 and bool_and(admin_id = adm and viewed_at is not null)
                  from public.greffe_fiche_views where bad_id = b),
    'the consultation is logged: which admin, which Fiche, when');
  return next matches(coalesce(pg_temp.try(format(
    'update public.greffe_fiche_views set admin_id = %L where bad_id = %L', b, b)), 'ok'),
    '^42501', 'the log is never changed');
  -- Members never read the log.
  perform pg_temp.as_user(b);
  return next matches(coalesce(pg_temp.try('select * from public.greffe_fiche_views'), 'ok'),
    '^42501', 'a member cannot read the log');
  perform pg_temp.as_owner();
  perform pg_temp.as_admin(adm);
  return next matches(coalesce(pg_temp.try('select * from public.greffe_fiche_views'), 'ok'),
    '^42501', 'nor an admin through the API (no grant)');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
-- Decision 10-3: the log is kept 12 months, then erased by the daily clean-up (cleanup_rows).
create function pg_temp.test_log_kept_12_months() returns setof text language plpgsql as $$
declare
  adm uuid := pg_temp.new_admin();
  b uuid := pg_temp.visible_bad();
  r jsonb;
begin
  insert into public.greffe_fiche_views (admin_id, bad_id, viewed_at) values
    (adm, b, now() - interval '12 months' - interval '1 day'),
    (adm, b, now() - interval '12 months' + interval '1 day'),
    (adm, b, now());
  r := public.cleanup_rows();
  return next is((r ->> 'greffe_fiche_views')::integer, 1, 'the clean-up counts what it erased');
  return next is((select count(*)::integer from public.greffe_fiche_views where bad_id = b), 2,
    'kept 12 months, then erased');
  return next ok(not exists (select 1 from public.greffe_fiche_views
                             where bad_id = b and viewed_at < now() - interval '12 months'),
    'nothing older than 12 months is left');
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
