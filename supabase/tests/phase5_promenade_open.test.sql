-- Phase 5 (pgTAP): la Promenade in open mode (launch_mode = 'open', SPEC §2, §12). Every test_*
-- function runs in its own rolled-back transaction (runtests). Helpers as in phase5c_parloir; the
-- test place (47.5, 3.5) is outside every quartier.

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

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

create function pg_temp.mode(p_mode public.launch_mode) returns void language sql as $$
  update public.app_settings set launch_mode = p_mode where id
$$;

create function pg_temp.picks(p_visitor uuid) returns integer language sql stable as $$
  select count(*)::integer from public.promenade_picks where visitor_id = p_visitor
$$;

----------------------------------------------------------------------------------------------
-- Open mode: the members outside every quartier get their Promenade at 21:00
----------------------------------------------------------------------------------------------
create function pg_temp.test_promenade_open_outside() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  toulon smallint := (select id from public.launch_zones where slug = 'toulon');
  b uuid; v uuid; vt uuid; j record;
begin
  perform pg_temp.mode('open');
  b := pg_temp.bad('b@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  return next ok((select zone_id is null from public.profiles where id = v), 'the Visitor is outside every quartier');
  -- Every quartier built, as the hourly job does: nothing for the Visitor outside them.
  perform public.build_daily_promenade(z.id, current_date) from public.launch_zones z;
  return next is(pg_temp.picks(v), 0, 'the quartiers'' Promenades do not include them');
  return next ok(public.build_daily_promenade(null, current_date) >= 1, 'the Promenade outside the quartiers is built');
  return next is(pg_temp.picks(v), 1, 'the Visitor outside every quartier gets the Bad');
  select * into j from public.promenade_picks where visitor_id = v;
  return next ok(j.zone_id is null and j.bad_id = b
    and j.visible_from = (current_date + time '21:00') at time zone 'Europe/Paris', 'at 21:00, time of France');
  return next is(public.build_daily_promenade(null, current_date), 1, 'built once (same picks)');
  update public.promenade_picks set visible_from = now() - interval '1 minute' where visitor_id = v;
  perform pg_temp.as_user(v);
  return next is((select count(*)::integer from public.get_my_promenade()), 1, 'shown in « La Promenade »');
  perform pg_temp.as_owner();
  -- A Visitor of Toulon still gets their Promenade in Toulon, with the same Bad.
  if toulon is not null then
    vt := pg_temp.visitor('vt@test.local', (select center_place_id from public.launch_zones where id = toulon));
    perform public.build_daily_promenade(toulon, current_date + 1);
    return next is((select count(*)::integer from public.promenade_picks where visitor_id = vt and zone_id = toulon), 1,
      'a Visitor of a quartier keeps the Promenade of the quartier');
  else
    return next pass('no Toulon zone in this base');
  end if;
end $$;

create function pg_temp.test_promenade_zones_mode_unchanged() returns setof text language plpgsql as $$
declare
  ville bigint := pg_temp.new_place();
  b uuid; v uuid;
begin
  perform pg_temp.mode('zones');
  b := pg_temp.bad('b@test.local', ville);
  v := pg_temp.visitor('v@test.local', ville);
  return next is(public.build_daily_promenade(null, current_date), 0, 'quartier mode: no Promenade outside the quartiers');
  return next is(pg_temp.picks(v), 0, 'nothing for the Visitor outside every quartier');
end $$;

create function pg_temp.test_promenade_job_rights() returns setof text language plpgsql as $$
begin
  return next ok(not has_function_privilege('authenticated', 'public.build_daily_promenade(smallint, date)', 'execute')
    and not has_function_privilege('authenticated', 'public.run_promenades_due()', 'execute'),
    'the Promenade is built by the job only');
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
