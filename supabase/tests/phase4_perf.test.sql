-- Phase 4 performance (pgTAP): the Découverte and the Promenade on a full zone of synthetic members.
-- The base has no seed profiles, and both functions exclude is_seed on purpose: the members are
-- created here as ordinary members, inside each test's rolled-back transaction (runtests), so
-- nothing persists. Every member seeks both genders and every age: the worst case for the number
-- of pairs. Answers vary (skipped questions, several accepted options); 20 % of the Bads are above
-- half their cap.
-- Run: `supabase test db`, or paste this file into the SQL editor / Supabase connector.
-- The sizes are set at the bottom.

----------------------------------------------------------------------------------------------
-- Helpers
----------------------------------------------------------------------------------------------
-- A zone (open) far out in the Atlantic, 25 places within ~15 km of its centre.
create function pg_temp.perf_zone() returns smallint language plpgsql as $$
declare centre bigint; z smallint;
begin
  insert into public.places (official_code, name, lat, lng)
  select 'P' || substr(md5(random()::text), 1, 8), 'Lieu perf ' || i,
    46.21 + ((i % 5) - 2) * 0.05, -8.13 + ((i / 5) - 2) * 0.07
  from generate_series(0, 24) i;
  select id into centre from public.places where name = 'Lieu perf 12';
  insert into public.launch_zones (slug, name, center_place_id, radius_km, status, timezone)
    values ('perf-' || substr(md5(random()::text), 1, 8), 'Zone perf', centre, 30, 'open', 'Europe/Paris')
    returning id into z;
  return z;
end $$;

-- n Bads and n Visitors, complete, seen within 30 days, account older than 7 days.
-- E-mails, pseudos and the zone slug are unique per run: a run cut off by the client can still be
-- running on the server, and the next one would otherwise wait on its unique keys.
create function pg_temp.perf_members(p_bads integer, p_visitors integer) returns void language plpgsql as $$
declare run text := substr(md5(random()::text), 1, 6);
begin
  create temporary table perf_ids on commit drop as
  select gen_random_uuid() id, i, case when i <= p_bads then 'bad' else 'visitor' end::public.member_role role
  from generate_series(1, p_bads + p_visitors) i;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
    'perf' || i || '-' || run || '@test.local', '', now(), '{}', '{}', now(), now()
  from perf_ids;

  insert into public.profiles (id, pseudo, birthdate, gender, seeking_genders, place_id, role, visit_motive)
  select p.id, 'perf' || translate(i::text || run, '0123456789', 'ghijklmnop'),
    date '1976-01-01' + (abs(hashtext(p.id::text)) % 9000), case when i % 2 = 0 then 'woman' else 'man' end::public.gender,
    '{man,woman}', (select pl.id from public.places pl where pl.name = 'Lieu perf ' || (i % 25)), p.role,
    case when p.role = 'visitor' then 'Motif de test' end
  from perf_ids p;
  update public.profiles pr set onboarding_completed_at = now(), created_at = now() - interval '10 days',
    last_seen_at = now() - (abs(hashtext(pr.id::text || 's')) % 30) * interval '1 day',
    pending_requests_count = case when p.role = 'bad' and p.i % 5 = 0 then 10 else 0 end
  from perf_ids p where pr.id = p.id;

  insert into public.photos (owner_id, position, pending_path)
  select p.id, pos, p.id || '/' || gen_random_uuid() || '.webp'
  from perf_ids p cross join generate_series(0, 2) pos
  where p.role = 'bad' or pos = 0;
  update public.photos ph set status = 'approved', pending_path = null,
    public_path_large = gen_random_uuid() || '.webp', public_path_small = gen_random_uuid() || '-s.webp'
  from perf_ids p where ph.owner_id = p.id;

  insert into public.casier_charges (profile_id, charge_1, charge_2, charge_3, true_index)
  select id, 'Chef un', 'Chef deux', 'Chef trois', 1 + i % 3 from perf_ids where role = 'bad';

  insert into public.profile_tribes (profile_id, tribe_id)
  select p.id, t.id from perf_ids p
  join (select id, row_number() over (order by id) - 1 rn, count(*) over () n from public.tribes) t
    on t.rn in (p.i % t.n, (p.i * 7 + 3) % t.n);

  -- Answers to the active questions: about 1 in 7 skipped, 1 member in 13 with 3 answers only (fewer
  -- than 5 in common: complicity unknown); 20 % accept only the same option, 20 % two options.
  insert into public.answers (user_id, question_id, option_id, accepted_option_ids, importance)
  select p.id, o.question_id, o.id,
    case abs(hashtext(p.id::text || o.question_id || 'a')) % 5
      when 0 then array[o.id]
      when 1 then array[o.id, (select min(x.id) from public.question_options x where x.question_id = o.question_id)]
    end,
    (array['low', 'important', 'essential']::public.importance[])[1 + abs(hashtext(p.id::text || o.question_id || 'i')) % 3]
  from perf_ids p
  cross join public.questions q
  join (select question_id, id, row_number() over (partition by question_id order by id) rn,
               count(*) over (partition by question_id) n from public.question_options) o
    on o.question_id = q.id and o.rn = 1 + abs(hashtext(p.id::text || q.id)) % o.n
  where q.is_active and abs(hashtext(p.id::text || q.id || 'skip')) % 7 <> 0
    and (p.i % 13 <> 0 or q.id % 7 = 0);
end $$;

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Milliseconds taken by a statement (run as the current role).
create function pg_temp.ms(p_sql text) returns numeric language plpgsql as $$
declare t0 timestamptz := clock_timestamp();
begin
  execute p_sql;
  return round(extract(epoch from clock_timestamp() - t0)::numeric * 1000, 1);
end $$;

----------------------------------------------------------------------------------------------
-- La Découverte: one page for a Visitor, with 1,000 Bads in the zone, under 200 ms
----------------------------------------------------------------------------------------------
create function pg_temp.test_perf_discover() returns setof text language plpgsql as $$
declare
  n_bads integer := current_setting('perf.bads')::integer;
  v uuid; t0 timestamptz; setup numeric; times numeric[] := '{}'; filtered numeric; tribe numeric; found integer;
  page uuid[]; seen uuid[] := '{}'; last_key bigint; last_id uuid; pages integer := 0;
begin
  t0 := clock_timestamp();
  perform pg_temp.perf_zone();
  perform pg_temp.perf_members(n_bads, 50);
  analyze public.profiles; analyze public.photos; analyze public.answers; analyze public.profile_tribes;
  setup := round(extract(epoch from clock_timestamp() - t0)::numeric, 1);
  select id into v from perf_ids where role = 'visitor' limit 1;
  -- Some Bads the Visitor must not see, for the equivalence check below.
  update public.profiles set is_paused = true where id in (select id from perf_ids where role = 'bad' and i % 31 = 1);
  update public.profiles set banned_at = now() where id in (select id from perf_ids where role = 'bad' and i % 37 = 2);
  update public.profiles set seek_age_min = 60 where id in (select id from perf_ids where role = 'bad' and i % 11 = 3);
  update public.profiles set seeking_genders = '{non_binary}' where id in (select id from perf_ids where role = 'bad' and i % 13 = 4);
  update public.photos set status = 'rejected' where position = 1 and owner_id in (select id from perf_ids where role = 'bad' and i % 29 = 5);
  insert into public.blocks (blocker_id, blocked_id) select id, v from perf_ids where role = 'bad' and i % 97 = 6;
  insert into public.blocks (blocker_id, blocked_id) select v, id from perf_ids where role = 'bad' and i % 89 = 7;

  perform pg_temp.as_user(v);
  select count(*) into found from public.discover_bads();
  for i in 1..5 loop times := times || pg_temp.ms('select count(*) from public.discover_bads()'); end loop;
  filtered := pg_temp.ms('select count(*) from public.discover_bads(p_age_min => 25, p_age_max => 45, p_max_km => 10, p_good_conduct_only => false, p_recently_active => true)');
  tribe := pg_temp.ms('select count(*) from public.discover_bads(p_tribe_ids => array[1, 2, 3]::smallint[])');
  -- Every page, following the cursor: exactly the Bads can_view_bad allows, each once.
  loop
    select array_agg(d.id order by d.sort_key desc, d.id desc),
        (array_agg(d.sort_key order by d.sort_key, d.id))[1], (array_agg(d.id order by d.sort_key, d.id))[1]
      into page, last_key, last_id
    from public.discover_bads(p_cursor_key => last_key, p_cursor_id => last_id, p_limit => 48) d;
    exit when page is null;
    seen := seen || page;
    pages := pages + 1;
    exit when pages > 100;
  end loop;
  perform pg_temp.as_owner();
  return next is(cardinality(seen), (select count(distinct x)::integer from unnest(seen) x), 'no Bad twice across pages');
  return next ok((select coalesce(array_agg(x order by x), '{}') from unnest(seen) x)
    = (select coalesce(array_agg(p.id order by p.id), '{}') from public.profiles p where p.role = 'bad' and public.can_view_bad(v, p.id)),
    'the Découverte returns exactly the Bads can_view_bad allows');

  return next diag(format('setup %s s for %s Bads; one page (%s rows), 5 runs (ms): %s; filters age+10 km+active: %s ms; tribes: %s ms; %s Bads visible over %s pages',
    setup, n_bads, found, array_to_string(times, ', '), filtered, tribe, cardinality(seen), pages));
  return next ok(cardinality(seen) between n_bads / 2 and n_bads - 50, 'the check is not trivial: many seen, some excluded');
  return next is(found, 24, 'a full page of 24 Bads');
  return next cmp_ok((select max(x) from unnest(times) x), '<', 200::numeric, format('discover_bads under 200 ms with %s Bads', n_bads));
  return next cmp_ok(greatest(filtered, tribe), '<', 200::numeric, 'with filters too');
end $$;

----------------------------------------------------------------------------------------------
-- La Promenade: the nightly build for a zone, and the attention shared out
----------------------------------------------------------------------------------------------
create function pg_temp.test_perf_promenade() returns setof text language plpgsql as $$
declare
  n_bads integer := current_setting('perf.bads')::integer;
  n_visitors integer := current_setting('perf.visitors')::integer;
  z smallint; t0 timestamptz; setup numeric; build numeric; built integer;
  busy numeric; calm numeric; served integer;
begin
  t0 := clock_timestamp();
  z := pg_temp.perf_zone();
  perform pg_temp.perf_members(n_bads, n_visitors);
  analyze public.profiles; analyze public.photos; analyze public.answers; analyze public.profile_tribes;
  setup := round(extract(epoch from clock_timestamp() - t0)::numeric, 1);

  t0 := clock_timestamp();
  built := public.build_daily_promenade(z, current_date);
  build := round(extract(epoch from clock_timestamp() - t0)::numeric, 1);

  select avg(coalesce(n, 0)) filter (where p.pending_requests_count * 2 > p.requests_cap),
         avg(coalesce(n, 0)) filter (where p.pending_requests_count * 2 <= p.requests_cap)
    into busy, calm
  from public.profiles p join perf_ids i on i.id = p.id and i.role = 'bad'
  left join (select bad_id, count(*) n from public.promenade_picks where promenade_date = current_date group by bad_id) c
    on c.bad_id = p.id;
  select count(distinct visitor_id) into served from public.promenade_picks where promenade_date = current_date;

  return next diag(format('setup %s s; build %s s for %s Visitors × %s Bads: %s picks, %s Visitors served; appearances per Bad: above half the cap %s, others %s',
    setup, build, n_visitors, n_bads, built, served, round(busy, 2), round(calm, 2)));
  return next cmp_ok(build, '<', 300::numeric, format('Promenade built in under 5 minutes for %s Visitors', n_visitors));
  return next is(served, n_visitors, 'every Visitor gets a Promenade');
  return next cmp_ok(busy, '<', calm, 'a Bad above half their cap appears less often');
end $$;

----------------------------------------------------------------------------------------------
-- La Promenade: the faster builder gives exactly the picks of the Phase 4a one
----------------------------------------------------------------------------------------------
-- The Phase 4a builder (20261005173248), kept here as the reference the faster one must match.
create function pg_temp.build_original(p_zone smallint, p_date date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  tz text;
  vis_from timestamptz;
  max_per_bad integer := (select promenade_max_appearances_per_day from public.app_settings);
  round_no integer := 0;
  inserted integer := 0;
begin
  select timezone into tz from public.launch_zones where id = p_zone;
  if tz is null then return 0; end if;
  vis_from := (p_date + time '21:00') at time zone tz;

  -- One temporary table per transaction (the job may build several zones in a row): rows are
  -- tagged with their zone instead of being removed.
  create temporary table if not exists original_pairs (
    zone smallint, visitor_id uuid, bad_id uuid, score integer, taken boolean
  ) on commit drop;
  insert into original_pairs (zone, visitor_id, bad_id, score, taken)
  with visitors as (
    select v.* from public.profiles v
    where v.zone_id = p_zone and v.role = 'visitor' and public.is_member_active(v) and not v.is_seed
  ),
  bads as (
    select b.* from public.profiles b
    where public.is_bad_visible(b) and b.requests_open and not b.is_seed
  ),
  pairs as (
    select v.id visitor_id, b.id bad_id, b.pending_requests_count, b.requests_cap, b.last_seen_at
    from visitors v join bads b on public.criteria_match(v, b) and (b.zone_id = p_zone or
      exists (select 1 from public.app_settings s where s.launch_mode = 'open'))
    where not public.is_blocked_between(v.id, b.id)
      and not exists (select 1 from public.visit_requests r where r.visitor_id = v.id and r.bad_id = b.id)
      and not exists (select 1 from public.promenade_picks pp where pp.visitor_id = v.id and pp.bad_id = b.id
                      and pp.promenade_date > p_date - 14)
  ),
  sums as (
    select p.visitor_id, p.bad_id,
      public.complicity_from_sums(
        sum(public.importance_weight(va.importance)) filter (where va.accepted_option_ids is null or ba.option_id = any (va.accepted_option_ids)),
        sum(public.importance_weight(va.importance)),
        sum(public.importance_weight(ba.importance)) filter (where ba.accepted_option_ids is null or va.option_id = any (ba.accepted_option_ids)),
        sum(public.importance_weight(ba.importance)),
        count(*)::integer,
        coalesce(bool_or(
          (va.importance = 'essential' and not (va.accepted_option_ids is null or ba.option_id = any (va.accepted_option_ids)))
          or (ba.importance = 'essential' and not (ba.accepted_option_ids is null or va.option_id = any (ba.accepted_option_ids)))), false)) score
    from pairs p
    join public.answers va on va.user_id = p.visitor_id
    join public.answers ba on ba.user_id = p.bad_id and ba.question_id = va.question_id
    join public.questions qu on qu.id = va.question_id and qu.is_active
    group by p.visitor_id, p.bad_id
  )
  select p_zone, p.visitor_id, p.bad_id,
    -- score = complicity (0 if unknown) + activity bonus (0–20), × 0.5 above half of the cap.
    ((coalesce(s.score, 0) + greatest(0, 20 - (extract(epoch from now() - p.last_seen_at) / 86400)::integer))
      * (case when p.pending_requests_count * 2 > p.requests_cap then 0.5 else 1 end))::integer as score,
    false as taken
  from pairs p left join sums s on s.visitor_id = p.visitor_id and s.bad_id = p.bad_id;

  -- Rounds: each Visitor proposes their best free candidate; each Bad keeps at most its remaining
  -- capacity (best scores first); the others try again with their next candidate.
  loop
    round_no := round_no + 1;
    with proposals as (
      select distinct on (pp.visitor_id) pp.visitor_id, pp.bad_id, pp.score
      from original_pairs pp
      where pp.zone = p_zone and not pp.taken
        and (select count(*) from public.promenade_picks x where x.visitor_id = pp.visitor_id and x.promenade_date = p_date) < 5
      order by pp.visitor_id, pp.score desc, pp.bad_id
    ),
    ranked as (
      select pr.*, row_number() over (partition by pr.bad_id order by pr.score desc, pr.visitor_id) as nth,
        (select count(*) from public.promenade_picks x where x.bad_id = pr.bad_id and x.promenade_date = p_date) as used
      from proposals pr
    ),
    kept as (
      insert into public.promenade_picks (visitor_id, bad_id, zone_id, promenade_date, rank, score, visible_from, visible_until)
      select r.visitor_id, r.bad_id, p_zone, p_date,
        (select count(*) from public.promenade_picks x where x.visitor_id = r.visitor_id and x.promenade_date = p_date) + 1,
        least(r.score, 32767), vis_from, vis_from + interval '1 day'
      from ranked r where r.used + r.nth <= max_per_bad
      returning visitor_id, bad_id
    )
    update original_pairs pp set taken = true
    from proposals pr
    where pp.zone = p_zone and pp.visitor_id = pr.visitor_id and pp.bad_id = pr.bad_id;
    -- Bads that are full are no longer proposed.
    update original_pairs pp set taken = true
    where pp.zone = p_zone and not pp.taken and (select count(*) from public.promenade_picks x
                            where x.bad_id = pp.bad_id and x.promenade_date = p_date) >= max_per_bad;
    exit when not exists (
      select 1 from original_pairs pp where pp.zone = p_zone and not pp.taken
        and (select count(*) from public.promenade_picks x where x.visitor_id = pp.visitor_id and x.promenade_date = p_date) < 5)
      or round_no >= 60;
  end loop;
  select count(*) into inserted from public.promenade_picks where zone_id = p_zone and promenade_date = p_date;
  return inserted;
end;
$$;

create function pg_temp.test_perf_promenade_same_as_4a() returns setof text language plpgsql as $$
declare z smallint; a integer; b integer;
begin
  z := pg_temp.perf_zone();
  perform pg_temp.perf_members(80, 80);
  analyze public.profiles; analyze public.answers;
  insert into public.blocks (blocker_id, blocked_id)
    select b.id, v.id from perf_ids b join perf_ids v on v.role = 'visitor' and v.i = b.i + 80
    where b.role = 'bad' and b.i % 9 = 0;
  a := pg_temp.build_original(z, current_date);
  b := public.build_daily_promenade(z, current_date + 30);
  return next ok(a > 0, format('%s picks', a));
  return next is(
    (select array_agg(row(visitor_id, bad_id, rank, score)::text order by visitor_id, bad_id)
     from public.promenade_picks where promenade_date = current_date),
    (select array_agg(row(visitor_id, bad_id, rank, score)::text order by visitor_id, bad_id)
     from public.promenade_picks where promenade_date = current_date + 30),
    'same picks, same ranks, same scores as the Phase 4a builder');
end $$;

----------------------------------------------------------------------------------------------
-- La Promenade saturated: 5 Visitors per Bad (as 5,000 Visitors × 1,000 Bads), so that Bads fill
-- up, rounds run long and Visitors walk far down their lists; the cap is never exceeded.
----------------------------------------------------------------------------------------------
create function pg_temp.test_perf_promenade_saturated() returns setof text language plpgsql as $$
declare
  n_bads integer := current_setting('perf.saturated_bads')::integer;
  z smallint; t0 timestamptz; build numeric; built integer; served integer; max_shown integer;
begin
  z := pg_temp.perf_zone();
  perform pg_temp.perf_members(n_bads, n_bads * 5);
  analyze public.profiles; analyze public.photos; analyze public.answers;
  t0 := clock_timestamp();
  built := public.build_daily_promenade(z, current_date);
  build := round(extract(epoch from clock_timestamp() - t0)::numeric, 1);
  select count(distinct visitor_id) into served from public.promenade_picks where promenade_date = current_date;
  select max(n) into max_shown from (select count(*) n from public.promenade_picks
    where promenade_date = current_date group by bad_id) t;
  return next diag(format('build %s s for %s Visitors × %s Bads: %s picks, %s Visitors served',
    build, n_bads * 5, n_bads, built, served));
  return next cmp_ok(build, '<', 300::numeric, 'built in under 5 minutes');
  return next is(max_shown, (select promenade_max_appearances_per_day from public.app_settings),
    'Bads are filled up to the daily cap, never beyond');
end $$;

----------------------------------------------------------------------------------------------
-- Sizes. Creating members goes through the production triggers (about 25 ms each: keywords,
-- N° d'écrou, zone), and the Supabase connector stops a call after 60 s: run one test per call
-- there (regex below), e.g. '^test_perf_discover$'. Measured on 2026-10-06 (see PROGRESS.md):
-- Découverte 62 ms for 1,000 Bads; Promenade 6.9 s for 600 Visitors × 1,000 Bads, 2.9 s
-- saturated (1,000 × 200). 5,000 Visitors × 1,000 Bads is extrapolated (≈ 1 min), not measured.
select set_config('perf.bads', '1000', false), set_config('perf.visitors', '600', false),
  set_config('perf.saturated_bads', '200', false);
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_perf_');
