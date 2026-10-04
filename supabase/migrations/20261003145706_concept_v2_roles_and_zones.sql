-- Concept v2 (SPEC v7, SCHEMA v2 §6), part 2: roles, Permis de visite, "Bads first" thresholds.
-- Additive part only (renames, new columns and functions); objects that must be dropped and
-- recreated are in part 3. The dev database has no member: renames lose nothing.

------------------------------------------------------------------------------------------------
-- 1. Profiles: role, Motif de visite, plea columns renamed after visit requests
------------------------------------------------------------------------------------------------
alter table public.profiles rename column pleas_cap to requests_cap;
alter table public.profiles rename column pleas_closed_manual to requests_closed_manual;
alter table public.profiles rename column pending_pleas_count to pending_requests_count;
alter table public.profiles rename column pleas_open to requests_open;
alter table public.profiles rename constraint profiles_pleas_cap_check to profiles_requests_cap_check;

alter table public.profiles
  add column role public.member_role,
  add column role_changed_at timestamptz,
  add column visit_motive varchar(280)
    constraint profiles_visit_motive_check check (visit_motive is null or btrim(visit_motive) <> '');

alter table public.profiles rename constraint profiles_check1 to profiles_completion_check;
alter table public.profiles add constraint profiles_completion_role_check check (
  onboarding_completed_at is null
  or (role is not null and (role <> 'visitor' or visit_motive is not null)));


-- "role" is protected: no column grant, written only by set_onboarding_role() (and change_role(), Phase 4).
grant update (visit_motive) on public.profiles to authenticated;

create or replace function public.profiles_before_write()
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
  if new.visit_motive is not null then
    new.visit_motive := public.mask_contacts(new.visit_motive);
  end if;

  if tg_op = 'INSERT' or new.place_id is distinct from old.place_id then
    select pl.lat, pl.lng into new.lat, new.lng from public.places pl where pl.id = new.place_id;
    new.zone_id := public.zone_for(new.lat, new.lng);
  end if;

  new.requests_open := not new.requests_closed_manual and new.pending_requests_count < new.requests_cap;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.profiles_after_write()
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
  if new.visit_motive is distinct from (case when tg_op = 'UPDATE' then old.visit_motive end) then
    perform public.flag_keywords(new.id, 'visit_motive', new.id::text, new.visit_motive);
  end if;
  return null;
end;
$$;

------------------------------------------------------------------------------------------------
-- 2. Photos: the Permis de visite shows a single photo (SPEC §5 bis)
------------------------------------------------------------------------------------------------
create or replace function public.photos_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.photos where owner_id = new.owner_id) >= 6 then
    raise exception 'too_many_photos' using errcode = '23514';
  end if;
  if new.position > 0
     and exists (select 1 from public.profiles where id = new.owner_id and role = 'visitor') then
    raise exception 'visitor_single_photo' using errcode = '23514';
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

------------------------------------------------------------------------------------------------
-- 3. Settings and zones ("les Bads d'abord", SPEC §3)
------------------------------------------------------------------------------------------------
alter table public.app_settings
  rename column hearing_max_appearances_per_day to promenade_max_appearances_per_day;
alter table public.app_settings
  add column zone_bad_active_days smallint not null default 30 check (zone_bad_active_days between 1 and 365);

alter table public.launch_zones
  add column threshold_bads integer not null default 50 check (threshold_bads > 0),
  add column threshold_men_pct smallint not null default 20 check (threshold_men_pct between 0 and 100),
  add column ready_at timestamptz;

alter table public.notification_preferences rename column email_plea_digest to email_request_digest;
alter table public.notification_preferences
  add column email_visit_reminder boolean not null default false,
  add column email_permit_granted boolean not null default true,
  add column push_requests boolean not null default true,
  add column push_visits boolean not null default true,
  add column push_messages boolean not null default true,
  add column push_promenade boolean not null default true,
  add column push_prompt_declined_at timestamptz;
grant update (email_visit_reminder, email_permit_granted, push_requests, push_visits, push_messages,
  push_promenade, push_prompt_declined_at) on public.notification_preferences to authenticated;

------------------------------------------------------------------------------------------------
-- 4. Functions
------------------------------------------------------------------------------------------------
-- Onboarding step 3 ("Ton rôle"). Only before the end of the onboarding; later: change_role().
create function public.set_onboarding_role(p_role public.member_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_role is null then raise exception 'role_required' using errcode = '22004'; end if;
  update public.profiles
  set role = p_role, onboarding_step = greatest(onboarding_step, 3)
  where id = (select auth.uid()) and onboarding_completed_at is null;
  if not found then raise exception 'role_locked' using errcode = '42501'; end if;
end;
$$;

-- Common steps + role-specific ones. Phase 3 adds the Casier (Bad) and the 10 core answers (both).
create or replace function public.complete_onboarding()
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  missing text[] := '{}';
begin
  select * into me from public.profiles where id = (select auth.uid()) for update;
  if not found then raise exception 'no_profile' using errcode = 'P0002'; end if;
  if me.onboarding_completed_at is not null then return; end if;
  if me.birthdate is null then missing := missing || 'birthdate'::text; end if;
  if me.pseudo is null or me.gender is null or me.place_id is null then missing := missing || 'identity'::text; end if;
  if me.role is null then missing := missing || 'role'::text; end if;
  if cardinality(me.seeking_genders) = 0 then missing := missing || 'seeking'::text; end if;
  if exists (
    select 1 from unnest(array['terms', 'privacy', 'age_18', 'art9_seeking']::public.consent_type[]) t
    where not coalesce((select c.granted from public.consents c
                        where c.user_id = me.id and c.type = t
                        order by c.created_at desc limit 1), false)
  ) then missing := missing || 'consents'::text; end if;
  if not exists (select 1 from public.photos where owner_id = me.id and position = 0) then
    missing := missing || 'photo'::text;
  end if;
  if me.role = 'visitor' and me.visit_motive is null then missing := missing || 'visit_motive'::text; end if;
  if cardinality(missing) > 0 then
    raise exception 'onboarding_incomplete' using errcode = '23514', detail = array_to_string(missing, ',');
  end if;
  update public.profiles set onboarding_completed_at = now(), onboarding_step = 7 where id = me.id;
end;
$$;

-- Last activity, at most one write per hour (SCHEMA §3.1). Needed now: only recently active Bads
-- count towards opening a zone. Phase 7 adds the activity_days rows (retention).
create function public.touch_activity()
returns void language sql security definer set search_path = '' as $$
  update public.profiles set last_seen_at = now()
  where id = (select auth.uid()) and (last_seen_at is null or last_seen_at < now() - interval '1 hour')
$$;

-- A Bad counted for opening a zone (SPEC §3). Phase 3 adds "Casier filled in".
create function public.counts_for_zone(p public.profiles)
returns boolean language sql stable security definer set search_path = '' as $$
  select p.role = 'bad' and p.onboarding_completed_at is not null
    and p.banned_at is null and p.hidden_reason is null
    and (p.suspended_until is null or p.suspended_until <= now())
    and not p.is_paused and not p.is_seed
    and p.last_seen_at >= now() - make_interval(days => (select s.zone_bad_active_days from public.app_settings s))
    and exists (select 1 from public.photos ph
                where ph.owner_id = p.id and ph.position = 0 and ph.status = 'approved')
$$;

revoke execute on function public.set_onboarding_role(public.member_role), public.touch_activity(),
  public.counts_for_zone(public.profiles) from public, anon;
grant execute on function public.set_onboarding_role(public.member_role) to authenticated;
grant execute on function public.touch_activity() to authenticated;
