-- Development seed (SPEC §19): fictitious members for development and load tests ONLY.
-- Never run in production. Two guards:
--   1. the session must opt in:      set app.allow_dev_seed = 'true';
--   2. refused when the database already holds more than 20 real finished Fiches
--      (a sign of a production database).
-- Seeded rows have is_seed = true and are excluded from every statistic.
-- Usage (SQL editor / connector):  set app.allow_dev_seed = 'true';  then run this file.
-- Parameters: change seed_count to generate more (Phase 4 uses 5000).
do $$
declare
  seed_count integer := 200;
  genders public.gender[] := array['man', 'woman', 'woman', 'man', 'non_binary']::public.gender[];
  zone_places bigint[];
  uid uuid;
  i integer;
begin
  if current_setting('app.allow_dev_seed', true) is distinct from 'true' then
    raise exception 'Refused: set app.allow_dev_seed = ''true'' in this session first (dev only).';
  end if;
  if (select count(*) from public.profiles where not is_seed and onboarding_completed_at is not null) > 20 then
    raise exception 'Refused: this database holds real members (production?).';
  end if;
  raise notice 'Seeding % fictitious members (dev only).', seed_count;

  select array_agg(id) into zone_places from public.places
  where official_code like '83%' or official_code like '06%';
  if zone_places is null then raise exception 'Import the Var and Alpes-Maritimes communes first.'; end if;

  for i in 1..seed_count loop
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      'seed-' || i || '-' || substr(uid::text, 1, 8) || '@seed.invalid', '', now(), '{"seed":true}', '{}',
      now() - (random() * interval '120 days'), now());
    insert into public.profiles (id, pseudo, birthdate, gender, seeking_genders, seek_age_min, seek_age_max,
      place_id, bio, onboarding_step, onboarding_completed_at, is_seed, last_seen_at)
    values (uid, 'Seed ' || i, (current_date - (18 + floor(random() * 40))::int * interval '1 year'
        - floor(random() * 360)::int * interval '1 day')::date,
      genders[1 + floor(random() * array_length(genders, 1))::int],
      case floor(random() * 3)::int
        when 0 then array['woman']::public.gender[]
        when 1 then array['man']::public.gender[]
        else array['man', 'woman']::public.gender[]
      end,
      18, 99, zone_places[1 + floor(random() * array_length(zone_places, 1))::int],
      'Fiche de démonstration générée pour le développement.', 4, now(), true,
      now() - (random() * interval '30 days'));
  end loop;
end;
$$;
