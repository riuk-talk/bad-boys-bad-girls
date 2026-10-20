-- Phase 8b: EXPLAIN ANALYZE of discover_bads (SPEC §18) with 1,000 Bads, LOCAL DATABASE ONLY.
-- Same synthetic members as supabase/tests/phase4_perf.test.sql (helpers copied from it), in one
-- transaction rolled back at the end: nothing persists. auto_explain prints the plan of every
-- statement run inside the function (log_nested_statements) to the client.
-- Run: psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/scripts/perf/explain-discover.sql
begin;

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

do $$ begin perform pg_temp.perf_zone(); perform pg_temp.perf_members(1000, 50); end $$;
analyze public.profiles; analyze public.photos; analyze public.answers; analyze public.profile_tribes;
select set_config('perf.visitor', (select id::text from perf_ids where role = 'visitor' limit 1), true);

load 'auto_explain';
set auto_explain.log_min_duration = 0;
set auto_explain.log_analyze = on;
set auto_explain.log_buffers = on;
set auto_explain.log_nested_statements = on;
set auto_explain.log_level = notice;
set client_min_messages = notice;

select pg_temp.as_user(current_setting('perf.visitor')::uuid);
\echo '== First page, no filter'
select count(*) from public.discover_bads();
\echo '== Filtered: age 25-45, 10 km, recently active'
select count(*) from public.discover_bads(p_age_min => 25, p_age_max => 45, p_max_km => 10,
  p_good_conduct_only => false, p_recently_active => true);
rollback;
