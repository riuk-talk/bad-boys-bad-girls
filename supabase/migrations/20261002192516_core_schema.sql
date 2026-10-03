-- Phase 2 core schema: reference data, accounts, Fiche, photos, zones, consents, moderation basics.
-- See docs/SCHEMA.md. Security model: RLS on every table, deny by default; other members never
-- read these tables directly (security definer functions only); protected profile columns are
-- not writable by the user (column privileges).

------------------------------------------------------------------------------------------------
-- 0. Secure defaults: nothing new is reachable by anon/authenticated unless granted explicitly.
------------------------------------------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

------------------------------------------------------------------------------------------------
-- 1. Types
------------------------------------------------------------------------------------------------
create type public.gender as enum ('man', 'woman', 'non_binary', 'other');
create type public.moderation_status as enum ('pending', 'approved', 'rejected');
create type public.zone_status as enum ('waitlist', 'open');
create type public.launch_mode as enum ('zones', 'open');
create type public.consent_type as enum ('terms', 'privacy', 'age_18', 'art9_seeking');
create type public.report_category as enum (
  'fake_profile', 'minor', 'harassment', 'sexual_content', 'violence_threat', 'scam', 'other'
);
create type public.report_status as enum ('open', 'upheld', 'rejected');
create type public.flag_source as enum (
  'pseudo', 'bio', 'casier', 'tribe_detail', 'plea', 'message', 'date_venue'
);
create type public.email_kind as enum (
  'plea_digest', 'date_accepted', 'zone_opened', 'profile_dormant', 'weekly_digest',
  'moderation_decision', 'onboarding_reminder', 'admin_photos_pending'
);

------------------------------------------------------------------------------------------------
-- 2. Pure helpers (immutable, no table access)
------------------------------------------------------------------------------------------------
create function public.immutable_unaccent(value text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, value)
$$;

-- Lowercase, no accents, no punctuation, single spaces (anti-scam comparisons, keyword matching).
create function public.normalize_text(value text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(
    regexp_replace(lower(public.immutable_unaccent(coalesce(value, ''))), '[^a-z0-9 ]+', ' ', 'g'),
    '\s+', ' ', 'g'))
$$;

-- Masks e-mails, links, phone numbers and @handles with a language-neutral token (SPEC §10).
-- Mirror: lib/masking.ts (parity fixture: tests/fixtures/masking-cases.json).
create function public.mask_contacts(value text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          coalesce(value, ''),
          '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[•••]', 'g'),
        '(https?://|www\.)[^[:space:]]+', '[•••]', 'gi'),
      '\m[A-Za-z0-9-]+\.(com|fr|net|org|io|me|be|ch|ly|gg|app|link|co|eu|info|biz)\M(/[^[:space:]]*)?', '[•••]', 'gi'),
    '(\+|00)?[0-9]([ .()-]?[0-9]){8,14}', '[•••]', 'g')
$$;

create function public.has_contacts(value text)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select public.mask_contacts(value) <> coalesce(value, '')
    or coalesce(value, '') ~ '@[A-Za-z0-9_.]{3,}'
$$;

-- Age in full years, at a given date.
create function public.age_years(birthdate date, at date default current_date)
returns integer language sql stable parallel safe set search_path = '' as $$
  select extract(year from age(at, birthdate))::integer
$$;

-- 8-character referral code, unambiguous alphabet.
create function public.new_referral_code()
returns text language sql volatile set search_path = '' as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 31), 1), '')
  from extensions.gen_random_bytes(8) as b, generate_series(0, 7) as i
$$;

------------------------------------------------------------------------------------------------
-- 3. Reference data
------------------------------------------------------------------------------------------------
create table public.places (
  id bigint generated always as identity primary key,
  country_code char(2) not null default 'FR',
  official_code text not null,
  name text not null,
  name_search text generated always as (public.normalize_text(name)) stored,
  postal_codes text[] not null default '{}',
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  population integer,
  unique (country_code, official_code)
);
create index places_name_search_trgm on public.places using gin (name_search extensions.gin_trgm_ops);
create index places_earth on public.places using gist (extensions.ll_to_earth(lat, lng));

create table public.launch_zones (
  id smallint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  center_place_id bigint not null references public.places (id),
  radius_km smallint not null check (radius_km between 5 and 200),
  timezone text not null default 'Europe/Paris',
  status public.zone_status not null default 'waitlist',
  threshold_profiles integer not null default 150 check (threshold_profiles > 0),
  threshold_women_pct smallint not null default 40 check (threshold_women_pct between 0 and 100),
  auto_open boolean not null default false,
  opened_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.app_settings (
  id boolean primary key default true check (id),
  launch_mode public.launch_mode not null default 'zones',
  ban_hash_retention_months smallint not null default 12,
  email_daily_quota smallint not null default 300,
  email_auth_reserve smallint not null default 100,
  hearing_max_appearances_per_day smallint not null default 10,
  storage_alert_mb integer not null default 700,
  egress_alert_gb numeric not null default 3.5,
  updated_at timestamptz not null default now()
);
insert into public.app_settings default values;

create table public.tribes (
  id smallint generated always as identity primary key,
  slug text not null unique,
  label jsonb not null check (label ? 'fr' and label ? 'en'),
  sort smallint not null default 0,
  is_active boolean not null default true
);
insert into public.tribes (slug, label, sort) values
  ('biker', '{"fr":"Biker","en":"Biker"}', 1),
  ('tattooed', '{"fr":"Tatoué·e","en":"Tattooed"}', 2),
  ('night-owl', '{"fr":"Noctambule","en":"Night owl"}', 3),
  ('rocker', '{"fr":"Rockeur·se","en":"Rocker"}', 4),
  ('rap', '{"fr":"Rap dans le sang","en":"Rap in my blood"}', 5),
  ('street', '{"fr":"Street","en":"Street"}', 6),
  ('daredevil', '{"fr":"Tête brûlée","en":"Daredevil"}', 7),
  ('party', '{"fr":"Fêtard·e","en":"Party animal"}', 8),
  ('traveller', '{"fr":"Voyageur·se","en":"Traveller"}', 9),
  ('extreme-sports', '{"fr":"Sport extrême","en":"Extreme sports"}', 10),
  ('gamer', '{"fr":"Gamer","en":"Gamer"}', 11),
  ('straight-talker', '{"fr":"Franc-parler","en":"Straight talker"}', 12);

create table public.moderation_keywords (
  id integer generated always as identity primary key,
  term text not null,
  lang char(2) not null check (lang in ('fr', 'en')),
  category public.report_category not null,
  is_active boolean not null default true,
  unique (lang, term)
);

------------------------------------------------------------------------------------------------
-- 4. Accounts and the Fiche
------------------------------------------------------------------------------------------------
create table public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  pseudo extensions.citext unique check (char_length(pseudo::text) between 3 and 20),
  birthdate date,
  gender public.gender,
  seeking_genders public.gender[] not null default '{}',
  seek_age_min smallint not null default 18,
  seek_age_max smallint not null default 99,
  place_id bigint references public.places (id),
  lat double precision,
  lng double precision,
  zone_id smallint references public.launch_zones (id) on delete set null,
  bio varchar(500),
  onboarding_step smallint not null default 0 check (onboarding_step between 0 and 6),
  onboarding_completed_at timestamptz,
  moderation_status public.moderation_status not null default 'pending',
  is_reglo boolean not null default false,
  hidden_reason text,
  suspended_until timestamptz,
  banned_at timestamptz,
  is_paused boolean not null default false,
  paused_at timestamptz,
  pleas_cap smallint not null default 15 check (pleas_cap between 5 and 50),
  pleas_closed_manual boolean not null default false,
  pending_pleas_count integer not null default 0,
  pleas_open boolean not null default true,
  last_seen_at timestamptz,
  dormant_since timestamptz,
  casier_updated_at timestamptz,
  referral_code text not null unique default public.new_referral_code(),
  referred_by uuid references public.profiles (id) on delete set null,
  consecutive_dismissals smallint not null default 0,
  is_seed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (seek_age_min between 18 and 99 and seek_age_max between 18 and 99 and seek_age_min <= seek_age_max),
  check (pseudo is null or pseudo::text ~ '^[[:alnum:]_. -]+$'),
  check (onboarding_completed_at is null or (
    pseudo is not null and birthdate is not null and gender is not null
    and cardinality(seeking_genders) > 0 and place_id is not null))
);
create index profiles_discovery on public.profiles (zone_id, moderation_status, is_paused)
  where onboarding_completed_at is not null and banned_at is null and hidden_reason is null;
create index profiles_last_seen on public.profiles (last_seen_at desc);
create index profiles_earth on public.profiles using gist (extensions.ll_to_earth(lat, lng))
  where lat is not null;
create index profiles_referred_by on public.profiles (referred_by) where referred_by is not null;
create index profiles_place on public.profiles (place_id);

create table public.profile_tribes (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  tribe_id smallint not null references public.tribes (id),
  detail varchar(60),
  primary key (profile_id, tribe_id)
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  position smallint not null check (position between 0 and 5),
  status public.moderation_status not null default 'pending',
  pending_path text,
  public_path_large text,
  public_path_small text,
  width smallint,
  height smallint,
  rejection_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint photos_owner_position unique (owner_id, position) deferrable initially deferred,
  check (pending_path is null or pending_path like owner_id::text || '/%')
);
create index photos_queue on public.photos (status, created_at);

create table public.consents (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  type public.consent_type not null,
  text_version text not null,
  granted boolean not null,
  ip_truncated inet,
  created_at timestamptz not null default now()
);
create index consents_user_type on public.consents (user_id, type, created_at desc);

create table public.banned_email_hashes (
  hash bytea primary key,
  banned_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  email_plea_digest boolean not null default true,
  email_date_accepted boolean not null default true,
  email_zone_opened boolean not null default true,
  email_dormant boolean not null default true,
  email_weekly boolean not null default false,
  unsubscribe_token uuid not null unique default gen_random_uuid()
);

create table public.flagged_texts (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete cascade,
  source public.flag_source not null,
  source_id text,
  excerpt text not null,
  matched_terms text[] not null,
  status public.report_status not null default 'open',
  created_at timestamptz not null default now()
);
create index flagged_texts_queue on public.flagged_texts (status, created_at);

create table public.email_outbox (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete cascade,
  kind public.email_kind not null,
  payload jsonb not null default '{}',
  priority smallint not null default 50,
  not_before date not null default current_date,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  attempts smallint not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index email_outbox_queue on public.email_outbox (status, not_before, priority);
create unique index email_outbox_one_per_day on public.email_outbox (user_id, kind, not_before)
  where kind in ('plea_digest', 'admin_photos_pending');
create unique index email_outbox_one_reminder on public.email_outbox (user_id)
  where kind = 'onboarding_reminder';

------------------------------------------------------------------------------------------------
-- 5. Functions reading tables
------------------------------------------------------------------------------------------------
create function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users where user_id = (select auth.uid()))
$$;

create function public.flag_keywords(p_user uuid, p_source public.flag_source, p_source_id text, p_text text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  normalized text := ' ' || public.normalize_text(p_text) || ' ';
  terms text[];
begin
  if p_text is null or btrim(p_text) = '' then return; end if;
  select array_agg(term) into terms
  from public.moderation_keywords
  where is_active and position(' ' || public.normalize_text(term) || ' ' in normalized) > 0;
  if terms is not null then
    insert into public.flagged_texts (user_id, source, source_id, excerpt, matched_terms)
    values (p_user, p_source, p_source_id, left(p_text, 500), terms);
  end if;
end;
$$;

-- Zone of a coordinate: nearest zone whose radius contains it (PHASE0 R17).
create function public.zone_for(p_lat double precision, p_lng double precision)
returns smallint language sql stable security definer set search_path = '' as $$
  select z.id
  from public.launch_zones z
  join public.places c on c.id = z.center_place_id
  where p_lat is not null
    and extensions.earth_distance(extensions.ll_to_earth(c.lat, c.lng), extensions.ll_to_earth(p_lat, p_lng))
        <= z.radius_km * 1000
  order by extensions.earth_distance(extensions.ll_to_earth(c.lat, c.lng), extensions.ll_to_earth(p_lat, p_lng))
  limit 1
$$;

-- B1: recompute every member's zone in one statement (after a zone is created/moved/resized).
create function public.recompute_profile_zones()
returns integer language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  with target as (
    select p.id, public.zone_for(p.lat, p.lng) as zone_id from public.profiles p
  )
  update public.profiles p set zone_id = t.zone_id
  from target t
  where p.id = t.id and p.zone_id is distinct from t.zone_id;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

create function public.launch_zones_recompute()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.recompute_profile_zones();
  return null;
end;
$$;
create trigger launch_zones_recompute
  after insert or delete or update of center_place_id, radius_km on public.launch_zones
  for each statement execute function public.launch_zones_recompute();

------------------------------------------------------------------------------------------------
-- 6. Profile triggers
------------------------------------------------------------------------------------------------
create function public.profiles_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.birthdate is not null then
    if public.age_years(new.birthdate) < 18 then
      raise exception 'underage' using errcode = '23514', hint = 'birthdate';
    end if;
    if public.age_years(new.birthdate) > 110 then
      raise exception 'invalid_birthdate' using errcode = '23514', hint = 'birthdate';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if old.onboarding_completed_at is not null and new.birthdate is distinct from old.birthdate then
      raise exception 'birthdate_locked' using errcode = '42501', hint = 'birthdate';
    end if;
    if new.is_paused and not old.is_paused then new.paused_at := now(); end if;
    if not new.is_paused then new.paused_at := null; end if;
  end if;

  if new.pseudo is not null and public.has_contacts(new.pseudo::text) then
    raise exception 'pseudo_contains_contacts' using errcode = '23514', hint = 'pseudo';
  end if;

  if new.bio is not null then
    new.bio := public.mask_contacts(new.bio);
  end if;

  if tg_op = 'INSERT' or new.place_id is distinct from old.place_id then
    select pl.lat, pl.lng into new.lat, new.lng from public.places pl where pl.id = new.place_id;
    new.zone_id := public.zone_for(new.lat, new.lng);
  end if;

  new.pleas_open := not new.pleas_closed_manual and new.pending_pleas_count < new.pleas_cap;
  new.updated_at := now();
  return new;
end;
$$;
create trigger profiles_before_write
  before insert or update on public.profiles
  for each row execute function public.profiles_before_write();

create function public.profiles_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notification_preferences (user_id) values (new.id) on conflict do nothing;
  end if;
  if new.pseudo is distinct from (case when tg_op = 'UPDATE' then old.pseudo end) then
    perform public.flag_keywords(new.id, 'pseudo', new.id::text, new.pseudo::text);
  end if;
  if new.bio is distinct from (case when tg_op = 'UPDATE' then old.bio end) then
    perform public.flag_keywords(new.id, 'bio', new.id::text, new.bio);
  end if;
  return null;
end;
$$;
create trigger profiles_after_write
  after insert or update of pseudo, bio on public.profiles
  for each row execute function public.profiles_after_write();

create function public.profile_tribes_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and (select count(*) from public.profile_tribes where profile_id = new.profile_id) >= 5 then
    raise exception 'too_many_tribes' using errcode = '23514';
  end if;
  if new.detail is not null then
    new.detail := nullif(btrim(public.mask_contacts(new.detail)), '');
    perform public.flag_keywords(new.profile_id, 'tribe_detail', new.tribe_id::text, new.detail);
  end if;
  return new;
end;
$$;
create trigger profile_tribes_before_write
  before insert or update on public.profile_tribes
  for each row execute function public.profile_tribes_before_write();

create function public.photos_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.photos where owner_id = new.owner_id) >= 6 then
    raise exception 'too_many_photos' using errcode = '23514';
  end if;
  -- Status and publication fields are never chosen by the client.
  new.status := 'pending';
  new.public_path_large := null;
  new.public_path_small := null;
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.rejection_reason := null;
  return new;
end;
$$;
create trigger photos_before_insert
  before insert on public.photos
  for each row execute function public.photos_before_insert();

-- One grouped "photos pending" e-mail per admin per day (sent in Phase 6, SPEC §11).
create function public.photos_notify_admins()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.email_outbox (user_id, kind, priority)
  select a.user_id, 'admin_photos_pending', 20
  from public.admin_users a
  join public.profiles p on p.id = a.user_id
  on conflict do nothing;
  return null;
end;
$$;
create trigger photos_notify_admins
  after insert on public.photos
  for each statement execute function public.photos_notify_admins();

create function public.append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'append_only' using errcode = '42501';
end;
$$;
create trigger consents_append_only
  before update on public.consents
  for each row execute function public.append_only();

------------------------------------------------------------------------------------------------
-- 7. Functions callable by members
------------------------------------------------------------------------------------------------
-- Finishes onboarding steps 1–4 (Phase 2). Phase 3 adds the Casier and the 10 core questions.
create function public.complete_onboarding()
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  missing text[] := '{}';
begin
  select * into me from public.profiles where id = (select auth.uid()) for update;
  if not found then raise exception 'no_profile' using errcode = 'P0002'; end if;
  if me.onboarding_completed_at is not null then return; end if;
  if me.birthdate is null then missing := missing || 'birthdate'; end if;
  if me.pseudo is null or me.gender is null or me.place_id is null then missing := missing || 'identity'; end if;
  if cardinality(me.seeking_genders) = 0 then missing := missing || 'seeking'; end if;
  if exists (
    select 1 from unnest(array['terms', 'privacy', 'age_18', 'art9_seeking']::public.consent_type[]) t
    where not coalesce((select c.granted from public.consents c
                        where c.user_id = me.id and c.type = t
                        order by c.created_at desc limit 1), false)
  ) then missing := missing || 'consents'; end if;
  if not exists (select 1 from public.photos where owner_id = me.id and position = 0) then
    missing := missing || 'photo';
  end if;
  if cardinality(missing) > 0 then
    raise exception 'onboarding_incomplete' using errcode = '23514', detail = array_to_string(missing, ',');
  end if;
  update public.profiles set onboarding_completed_at = now(), onboarding_step = 6 where id = me.id;
end;
$$;

-- Records who brought this member in. Once, before onboarding ends, never oneself (SPEC §3).
create function public.claim_referral(p_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare referrer uuid;
begin
  select id into referrer from public.profiles where referral_code = upper(btrim(p_code));
  if referrer is null or referrer = (select auth.uid()) then return false; end if;
  update public.profiles set referred_by = referrer
  where id = (select auth.uid()) and referred_by is null and onboarding_completed_at is null;
  return found;
end;
$$;

create function public.referral_count()
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.profiles
  where referred_by = (select auth.uid()) and onboarding_completed_at is not null
$$;

-- "Fiche complète" = onboarding finished + main photo approved (decision Phase 0 n° 7).
create function public.is_complete_fiche(p public.profiles)
returns boolean language sql stable security definer set search_path = '' as $$
  select p.onboarding_completed_at is not null and p.banned_at is null and not p.is_seed
    and exists (select 1 from public.photos ph where ph.owner_id = p.id and ph.position = 0 and ph.status = 'approved')
$$;

-- Progress gauge of the caller's zone ("Ta ville ouvre bientôt", SPEC §3).
create function public.zone_progress()
returns table (
  zone_id smallint, zone_name text, status public.zone_status, launch_mode public.launch_mode,
  complete_profiles integer, threshold_profiles integer, women_pct integer, threshold_women_pct smallint
) language sql stable security definer set search_path = '' as $$
  select z.id, z.name, z.status, s.launch_mode,
    (select count(*)::integer from public.profiles p where p.zone_id = z.id and public.is_complete_fiche(p)),
    z.threshold_profiles,
    (select coalesce(round(100.0 * count(*) filter (where p.gender = 'woman') / nullif(count(*), 0)), 0)::integer
       from public.profiles p where p.zone_id = z.id and public.is_complete_fiche(p)),
    z.threshold_women_pct
  from public.profiles me
  join public.launch_zones z on z.id = me.zone_id
  cross join public.app_settings s
  where me.id = (select auth.uid())
$$;

-- City autocomplete (authenticated only; places are reference data).
create function public.search_places(p_query text, p_limit integer default 8)
returns table (id bigint, name text, postal_codes text[], official_code text)
language sql stable security definer set search_path = '' as $$
  select pl.id, pl.name, pl.postal_codes, pl.official_code
  from public.places pl
  where pl.name_search like public.normalize_text(p_query) || '%'
     or pl.postal_codes @> array[btrim(p_query)]
  order by pl.population desc nulls last, pl.name
  limit least(greatest(p_limit, 1), 20)
$$;

------------------------------------------------------------------------------------------------
-- 8. Auth hook "Before User Created" (B4): refuses e-mails of banned members.
------------------------------------------------------------------------------------------------
create function public.ban_email_hash(p_email text)
returns bytea language sql stable security definer set search_path = '' as $$
  select extensions.hmac(
    lower(btrim(p_email)),
    (select decrypted_secret from vault.decrypted_secrets where name = 'ban_email_pepper'),
    'sha256')
$$;

create function public.hook_before_user_created(event jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare email text := event -> 'user' ->> 'email';
begin
  if email is not null and exists (
    select 1 from public.banned_email_hashes b
    where b.hash = public.ban_email_hash(email) and b.expires_at > now()
  ) then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'email_banned'));
  end if;
  return '{}'::jsonb;
end;
$$;

-- Pepper generated inside the database: its value never appears in a file or a log.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'ban_email_pepper') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'ban_email_pepper',
      'HMAC pepper for banned e-mail fingerprints');
  end if;
end;
$$;

------------------------------------------------------------------------------------------------
-- 9. Row Level Security and grants
------------------------------------------------------------------------------------------------
alter table public.places enable row level security;
alter table public.launch_zones enable row level security;
alter table public.app_settings enable row level security;
alter table public.tribes enable row level security;
alter table public.moderation_keywords enable row level security;
alter table public.admin_users enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_tribes enable row level security;
alter table public.photos enable row level security;
alter table public.consents enable row level security;
alter table public.banned_email_hashes enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.flagged_texts enable row level security;
alter table public.email_outbox enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- Reference data: read-only for members.
grant select on public.places, public.launch_zones, public.tribes to authenticated;
create policy "places readable by members" on public.places for select to authenticated using (true);
create policy "zones readable by members" on public.launch_zones for select to authenticated using (true);
create policy "active tribes readable by members" on public.tribes for select to authenticated using (is_active);

-- Profiles: owner only; protected columns are not in the column grants.
grant select on public.profiles to authenticated;
grant insert (id, pseudo, birthdate, gender, seeking_genders, seek_age_min, seek_age_max, place_id, bio, onboarding_step)
  on public.profiles to authenticated;
grant update (pseudo, birthdate, gender, seeking_genders, seek_age_min, seek_age_max, place_id, bio,
  onboarding_step, is_paused, pleas_cap, pleas_closed_manual)
  on public.profiles to authenticated;
create policy "own profile readable" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "own profile insertable" on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy "own profile updatable" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

grant select, insert, update, delete on public.profile_tribes to authenticated;
create policy "own tribes" on public.profile_tribes for all to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

grant select, delete on public.photos to authenticated;
grant insert (owner_id, position, pending_path, width, height) on public.photos to authenticated;
create policy "own photos readable" on public.photos for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "own photos insertable" on public.photos for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "own photos deletable" on public.photos for delete to authenticated
  using (owner_id = (select auth.uid()));

grant select on public.consents to authenticated;
create policy "own consents readable" on public.consents for select to authenticated
  using (user_id = (select auth.uid()));

grant select, update (email_plea_digest, email_date_accepted, email_zone_opened, email_dormant, email_weekly)
  on public.notification_preferences to authenticated;
create policy "own preferences readable" on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own preferences updatable" on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- admin_users, app_settings, moderation_keywords, banned_email_hashes, flagged_texts,
-- email_outbox: RLS enabled, no policy, no grant → unreachable through the API.

-- Pure helpers used by defaults, generated columns and checks evaluated as the caller.
grant execute on function public.immutable_unaccent(text), public.normalize_text(text),
  public.mask_contacts(text), public.has_contacts(text), public.age_years(date, date),
  public.new_referral_code() to authenticated;

grant execute on function public.complete_onboarding() to authenticated;
grant execute on function public.claim_referral(text) to authenticated;
grant execute on function public.referral_count() to authenticated;
grant execute on function public.zone_progress() to authenticated;
grant execute on function public.search_places(text, integer) to authenticated;
grant execute on function public.is_admin() to authenticated;

-- Auth hook: only the auth service may call it.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
