-- Phase 7b: le pilotage (SPEC §3, §15). Quartiers and their thresholds, Signes distinctifs,
-- moderation keywords, questions of the Interrogatoire, and the health dashboard of a quartier,
-- computed from our own tables only (no third-party tool), seed accounts left out. Every function
-- checks is_admin() (second factor, aal2) first. Days of activity are kept for retention (J7, J30).

------------------------------------------------------------------------------------------------
-- 1. Days of activity (retention): one row per member and per day (Paris), nothing else
------------------------------------------------------------------------------------------------
create table public.activity_days (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  primary key (user_id, day)
);
alter table public.activity_days enable row level security;
revoke all on public.activity_days from public, anon, authenticated;

-- Last activity, at most one write per hour, and the day of activity with it.
create or replace function public.touch_activity()
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  update public.profiles set last_seen_at = now()
  where id = me and (last_seen_at is null or last_seen_at < now() - interval '1 hour');
  if found then
    insert into public.activity_days (user_id, day)
    values (me, (now() at time zone 'Europe/Paris')::date)
    on conflict do nothing;
  end if;
end;
$$;

------------------------------------------------------------------------------------------------
-- 2. Quartiers
------------------------------------------------------------------------------------------------
-- Gauge of one quartier (same counting as zone_progress, SPEC §3).
create function private.zone_gauge(p_zone smallint)
returns jsonb language sql stable set search_path = '' as $$
  with z as (
    select z.*, ceil(z.threshold_bads * z.threshold_women_pct / 100.0)::integer as min_girls,
      ceil(z.threshold_bads * z.threshold_men_pct / 100.0)::integer as min_boys
    from public.launch_zones z where z.id = p_zone
  ), bads as (
    select count(*)::integer as total,
      (count(*) filter (where p.gender = 'woman'))::integer as girls,
      (count(*) filter (where p.gender = 'man'))::integer as boys
    from public.profiles p where p.zone_id = p_zone and public.counts_for_zone(p)
  ), visitors as (
    select count(*)::integer as waiting
    from public.profiles p
    where p.zone_id = p_zone and p.role = 'visitor' and p.onboarding_completed_at is not null
      and p.banned_at is null and p.hidden_reason is null and not p.is_seed
      and exists (select 1 from public.photos ph where ph.owner_id = p.id and ph.position = 0 and ph.status = 'approved')
  )
  select jsonb_build_object('bads', bads.total, 'threshold_bads', z.threshold_bads,
    'bad_girls', bads.girls, 'min_bad_girls', z.min_girls, 'bad_boys', bads.boys, 'min_bad_boys', z.min_boys,
    'visitors_waiting', visitors.waiting,
    'ready', bads.total >= z.threshold_bads and bads.girls >= z.min_girls and bads.boys >= z.min_boys)
  from z, bads, visitors
$$;
revoke execute on function private.zone_gauge(smallint) from public, anon, authenticated, service_role;

create function public.admin_zones()
returns table (zone_id smallint, slug text, name text, center_place_id bigint, center_name text,
  radius_km smallint, timezone text, status public.zone_status, threshold_bads integer,
  threshold_women_pct smallint, threshold_men_pct smallint, auto_open boolean, ready_at timestamptz,
  opened_at timestamptz, gauge jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select z.id, z.slug, z.name, z.center_place_id, pl.name, z.radius_km, z.timezone, z.status,
      z.threshold_bads, z.threshold_women_pct, z.threshold_men_pct, z.auto_open, z.ready_at, z.opened_at,
      private.zone_gauge(z.id)
    from public.launch_zones z join public.places pl on pl.id = z.center_place_id
    order by z.name;
end;
$$;

-- Creates (p_zone null) or changes a quartier. Its members' zone is recomputed by the trigger when
-- the centre or the radius changes. The status is changed by admin_set_zone_status only.
create function public.admin_save_zone(p_slug text, p_name text, p_center_place bigint,
  p_radius_km smallint, p_timezone text, p_threshold_bads integer, p_women_pct smallint,
  p_men_pct smallint, p_auto_open boolean, p_zone smallint default null)
returns smallint language plpgsql security definer set search_path = '' as $$
declare saved smallint; zone_name text := btrim(coalesce(p_name, ''));
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if char_length(zone_name) not between 2 and 60 then raise exception 'invalid_name' using errcode = '22023'; end if;
  if p_slug is null or p_slug !~ '^[a-z0-9-]{2,40}$' then raise exception 'invalid_slug' using errcode = '22023'; end if;
  if not exists (select 1 from public.places where id = p_center_place) then
    raise exception 'invalid_place' using errcode = '22023';
  end if;
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;
  if p_radius_km is null or p_radius_km not between 5 and 200
     or p_threshold_bads is null or p_threshold_bads not between 1 and 100000
     or p_women_pct is null or p_women_pct not between 0 and 100
     or p_men_pct is null or p_men_pct not between 0 and 100 or p_women_pct + p_men_pct > 100 then
    raise exception 'invalid_thresholds' using errcode = '22023';
  end if;
  if p_zone is null then
    insert into public.launch_zones (slug, name, center_place_id, radius_km, timezone, threshold_bads,
      threshold_women_pct, threshold_men_pct, auto_open)
    values (p_slug, zone_name, p_center_place, p_radius_km, p_timezone, p_threshold_bads, p_women_pct, p_men_pct,
      coalesce(p_auto_open, false))
    returning id into saved;
  else
    update public.launch_zones
    set slug = p_slug, name = zone_name, center_place_id = p_center_place, radius_km = p_radius_km,
        timezone = p_timezone, threshold_bads = p_threshold_bads, threshold_women_pct = p_women_pct,
        threshold_men_pct = p_men_pct, auto_open = coalesce(p_auto_open, false)
    where id = p_zone
    returning id into saved;
    if saved is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  return saved;
exception when unique_violation then
  raise exception 'slug_taken' using errcode = '23505';
end;
$$;

-- Opens a quartier to visits (its members are told: notification, and e-mail sent in Phase 7e) or
-- puts it back on the waiting list. An open quartier never closes by itself (SPEC §3).
create function public.admin_set_zone_status(p_zone smallint, p_status public.zone_status)
returns void language plpgsql security definer set search_path = '' as $$
declare z public.launch_zones;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into z from public.launch_zones where id = p_zone for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if z.status = p_status then raise exception 'same_status' using errcode = '23514'; end if;
  update public.launch_zones
  set status = p_status, opened_at = case when p_status = 'open' then now() else opened_at end
  where id = p_zone;
  if p_status = 'open' then
    insert into public.notifications (user_id, type, payload)
    select p.id, 'zone_opened', jsonb_build_object('zone_id', p_zone)
    from public.profiles p
    where p.zone_id = p_zone and p.onboarding_completed_at is not null and p.banned_at is null and not p.is_seed;
    insert into public.email_outbox (user_id, kind, payload, priority)
    select p.id, 'zone_opened', jsonb_build_object('zone_id', p_zone), 40
    from public.profiles p
    where p.zone_id = p_zone and p.onboarding_completed_at is not null and p.banned_at is null and not p.is_seed;
  end if;
end;
$$;

create function public.admin_launch_mode()
returns public.launch_mode language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return (select s.launch_mode from public.app_settings s where s.id);
end;
$$;

-- The global mode (SPEC §3: « open » switches the quartier mechanism off). Super admin only.
create function public.admin_set_launch_mode(p_mode public.launch_mode)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if not exists (select 1 from public.super_admins where user_id = (select auth.uid())) then
    raise exception 'super_admin_only' using errcode = '42501';
  end if;
  update public.app_settings set launch_mode = p_mode, updated_at = now() where id;
end;
$$;

------------------------------------------------------------------------------------------------
-- 3. Signes distinctifs, keywords, questions
------------------------------------------------------------------------------------------------
create function public.admin_tribes()
returns table (tribe_id smallint, slug text, label_fr text, label_en text, sort smallint, is_active boolean, members integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select t.id, t.slug, t.label ->> 'fr', t.label ->> 'en', t.sort, t.is_active,
      (select count(*)::integer from public.profile_tribes pt where pt.tribe_id = t.id)
    from public.tribes t order by t.sort, t.id;
end;
$$;

-- A Signe is never removed (members keep it): it is deactivated.
create function public.admin_save_tribe(p_slug text, p_label_fr text, p_label_en text,
  p_sort smallint, p_active boolean, p_tribe smallint default null)
returns smallint language plpgsql security definer set search_path = '' as $$
declare saved smallint; fr text := btrim(coalesce(p_label_fr, '')); en text := btrim(coalesce(p_label_en, ''));
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if p_slug is null or p_slug !~ '^[a-z0-9-]{2,40}$' then raise exception 'invalid_slug' using errcode = '22023'; end if;
  if char_length(fr) not between 2 and 40 or char_length(en) not between 2 and 40 then
    raise exception 'invalid_label' using errcode = '22023';
  end if;
  if p_tribe is null then
    insert into public.tribes (slug, label, sort, is_active)
    values (p_slug, jsonb_build_object('fr', fr, 'en', en), coalesce(p_sort, 0), coalesce(p_active, true))
    returning id into saved;
  else
    update public.tribes set slug = p_slug, label = jsonb_build_object('fr', fr, 'en', en),
      sort = coalesce(p_sort, 0), is_active = coalesce(p_active, true)
    where id = p_tribe returning id into saved;
    if saved is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  return saved;
exception when unique_violation then
  raise exception 'slug_taken' using errcode = '23505';
end;
$$;

create function public.admin_keywords()
returns table (keyword_id integer, term text, lang char(2), category public.report_category, is_active boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query select k.id, k.term, k.lang, k.category, k.is_active from public.moderation_keywords k
    order by k.lang, k.term;
end;
$$;

-- A keyword is deactivated, never removed (flagged texts keep the words they matched).
create function public.admin_save_keyword(p_term text, p_lang text,
  p_category public.report_category, p_active boolean, p_keyword integer default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare saved integer; t text := lower(btrim(coalesce(p_term, '')));
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if char_length(t) not between 2 and 60 then raise exception 'invalid_term' using errcode = '22023'; end if;
  if p_lang is null or p_lang not in ('fr', 'en') or p_category is null then
    raise exception 'invalid_keyword' using errcode = '22023';
  end if;
  if p_keyword is null then
    insert into public.moderation_keywords (term, lang, category, is_active)
    values (t, p_lang, p_category, coalesce(p_active, true)) returning id into saved;
  else
    update public.moderation_keywords set term = t, lang = p_lang, category = p_category,
      is_active = coalesce(p_active, true)
    where id = p_keyword returning id into saved;
    if saved is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  end if;
  return saved;
exception when unique_violation then
  raise exception 'keyword_taken' using errcode = '23505';
end;
$$;

create function public.admin_questions()
returns table (question_id smallint, sort_position smallint, phase public.question_phase, label_fr text,
  label_en text, is_active boolean, options jsonb, answers integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select q.id, q.position, q.phase, q.label ->> 'fr', q.label ->> 'en', q.is_active,
      coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'fr', o.label ->> 'fr', 'en', o.label ->> 'en')
                order by o.position) from public.question_options o where o.question_id = q.id), '[]'),
      (select count(*)::integer from public.answers a where a.question_id = q.id)
    from public.questions q order by q.position;
end;
$$;

-- Wording only (a typo, a translation): the answers keep their meaning, so no question or option
-- is added or removed here. Only an « extra » question can be deactivated: the 10 core questions
-- are required by the onboarding and by the indice de complicité.
create function public.admin_save_question(p_question smallint, p_label_fr text, p_label_en text,
  p_active boolean, p_options jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare q public.questions; o jsonb;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into q from public.questions where id = p_question for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if char_length(btrim(coalesce(p_label_fr, ''))) not between 5 and 200
     or char_length(btrim(coalesce(p_label_en, ''))) not between 5 and 200 then
    raise exception 'invalid_label' using errcode = '22023';
  end if;
  if q.phase = 'core' and not coalesce(p_active, true) then
    raise exception 'core_question' using errcode = '23514';
  end if;
  if p_options is null or jsonb_typeof(p_options) <> 'array'
     or jsonb_array_length(p_options) <> (select count(*) from public.question_options where question_id = q.id) then
    raise exception 'invalid_options' using errcode = '22023';
  end if;
  for o in select * from jsonb_array_elements(p_options) loop
    if char_length(btrim(coalesce(o ->> 'fr', ''))) not between 1 and 120
       or char_length(btrim(coalesce(o ->> 'en', ''))) not between 1 and 120
       or not exists (select 1 from public.question_options x where x.question_id = q.id and x.id::text = o ->> 'id') then
      raise exception 'invalid_options' using errcode = '22023';
    end if;
    update public.question_options
    set label = jsonb_build_object('fr', btrim(o ->> 'fr'), 'en', btrim(o ->> 'en'))
    where question_id = q.id and id::text = o ->> 'id';
  end loop;
  update public.questions
  set label = jsonb_build_object('fr', btrim(p_label_fr), 'en', btrim(p_label_en)), is_active = coalesce(p_active, true)
  where id = q.id;
end;
$$;

------------------------------------------------------------------------------------------------
-- 4. Tableau de santé d'un quartier (SPEC §15), over a period of days (Paris), seeds left out
------------------------------------------------------------------------------------------------
create function public.admin_zone_health(p_zone smallint, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  since timestamptz;
  until timestamptz;
  days integer;
  result jsonb;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if not exists (select 1 from public.launch_zones where id = p_zone) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  since := p_from::timestamp at time zone 'Europe/Paris';
  until := (p_to + 1)::timestamp at time zone 'Europe/Paris';
  days := p_to - p_from + 1;

  with members as (
    select p.* from public.profiles p where p.zone_id = p_zone and not p.is_seed
  ), requests as (
    select r.*, exists (select 1 from public.visit_slots s where s.request_id = r.id) as accepted
    from public.visit_requests r join members v on v.id = r.visitor_id
    where r.created_at >= since and r.created_at < until
  ), decided as (
    select * from requests where accepted or close_reason = 'dismissed_by_bad'
  ), started as (
    select x.* from public.visits x join members v on v.id = x.visitor_id
    where x.starts_at >= since and x.starts_at < until and x.status in ('ended', 'no_show')
  ), dates as (
    select d.* from public.date_proposals d
    join public.conversations c on c.id = d.conversation_id
    join members v on v.id = c.visitor_id
    where d.created_at >= since and d.created_at < until
  ), served as (
    select pp.visitor_id, pp.promenade_date, count(*) as picks
    from public.promenade_picks pp join members v on v.id = pp.visitor_id
    where pp.promenade_date between p_from and p_to
    group by pp.visitor_id, pp.promenade_date
  ), cohort as (
    select m.id, m.role, m.created_at from members m
    where m.onboarding_completed_at is not null and m.created_at >= since and m.created_at < until
  ), zone_reports as (
    select r.* from public.reports r join members t on t.id = r.target_user_id
    where r.created_at >= since and r.created_at < until
  ), zone_photos as (
    select ph.* from public.photos ph join members o on o.id = ph.owner_id
    where ph.reviewed_at >= since and ph.reviewed_at < until
  ), pushes as (
    select o.status from public.push_outbox o join members m on m.id = o.user_id
    where o.created_at >= since and o.created_at < until and o.status in ('sent', 'failed')
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'days', days),
    'gauge', private.zone_gauge(p_zone),
    'members', jsonb_build_object(
      'signed_up', (select count(*) from members m where m.created_at >= since and m.created_at < until),
      'by_role_gender', coalesce((select jsonb_object_agg(k, n) from (
          select coalesce(m.role::text, 'none') || ':' || coalesce(m.gender::text, 'none') as k, count(*) as n
          from members m group by 1) g), '{}'),
      'complete', (select jsonb_build_object(
          'dossiers', count(*) filter (where m.role = 'bad' and m.onboarding_completed_at is not null),
          'permits', count(*) filter (where m.role = 'visitor' and m.onboarding_completed_at is not null))
        from members m)),
    'requests', (select jsonb_build_object(
        'sent', count(*),
        'per_day', round(count(*)::numeric / days, 1),
        'auto_closed', count(*) filter (where status = 'auto_dismissed'),
        'decided', (select count(*) from decided),
        'accepted', (select count(*) from decided where accepted),
        'accepted_right_bet', (select count(*) from decided where accepted and guess_correct),
        'decided_right_bet', (select count(*) from decided where guess_correct),
        'accepted_wrong_bet', (select count(*) from decided where accepted and not guess_correct),
        'decided_wrong_bet', (select count(*) from decided where not guess_correct),
        'avg_response_hours', (select round((avg(extract(epoch from decided_at - created_at)) / 3600)::numeric, 1)
                               from decided where decided_at is not null),
        'with_visit', (select count(*) from requests r where r.accepted
                       and exists (select 1 from public.visits x where x.request_id = r.id)),
        'slots_declined', (select count(*) from requests r where r.accepted and r.slots_declined))
      from requests),
    'visits', (select jsonb_build_object(
        'started', count(*),
        'bad_present', count(*) filter (where bad_joined_at is not null),
        'visitor_present', count(*) filter (where visitor_joined_at is not null),
        'both_present', count(*) filter (where bad_joined_at is not null and visitor_joined_at is not null),
        'released', count(*) filter (where outcome = 'released'),
        'late_cancellations', (select count(*) from public.visits x join members v on v.id = x.visitor_id
                               where x.starts_at >= since and x.starts_at < until and x.cancelled_late))
      from started),
    'cavales', (select jsonb_build_object(
        'proposed', count(*),
        'accepted', count(*) filter (where status = 'accepted' or (status = 'cancelled' and responded_at is not null)))
      from dates),
    'promenade', (select jsonb_build_object(
        'visitor_days', count(*),
        'under_five', count(*) filter (where picks < 5))
      from served),
    'retention', (select jsonb_object_agg(role, jsonb_build_object(
        'cohort_d7', d7_cohort, 'back_d7', d7_back, 'cohort_d30', d30_cohort, 'back_d30', d30_back))
      from (
        select coalesce(c.role::text, 'none') as role,
          count(*) filter (where c.created_at <= now() - interval '7 days') as d7_cohort,
          count(*) filter (where c.created_at <= now() - interval '7 days' and exists (
            select 1 from public.activity_days a where a.user_id = c.id
              and a.day >= ((c.created_at + interval '7 days') at time zone 'Europe/Paris')::date)) as d7_back,
          count(*) filter (where c.created_at <= now() - interval '30 days') as d30_cohort,
          count(*) filter (where c.created_at <= now() - interval '30 days' and exists (
            select 1 from public.activity_days a where a.user_id = c.id
              and a.day >= ((c.created_at + interval '30 days') at time zone 'Europe/Paris')::date)) as d30_back
        from cohort c group by 1) r),
    'moderation', jsonb_build_object(
      'reports', (select count(*) from zone_reports),
      'avg_report_hours', (select round((avg(extract(epoch from decided_at - created_at)) / 3600)::numeric, 1)
                           from zone_reports where decided_at is not null),
      'photos_reviewed', (select count(*) from zone_photos),
      'avg_greffe_hours', (select round((avg(extract(epoch from reviewed_at - created_at)) / 3600)::numeric, 1)
                           from zone_photos)),
    'push', jsonb_build_object(
      'members', (select count(*) from members m where m.onboarding_completed_at is not null),
      'subscribed', (select count(*) from members m where m.onboarding_completed_at is not null
                     and exists (select 1 from public.push_subscriptions s where s.user_id = m.id and s.revoked_at is null)),
      'sent', (select count(*) from pushes where status = 'sent'),
      'failed', (select count(*) from pushes where status = 'failed'))
  ) into result;
  return result;
end;
$$;

------------------------------------------------------------------------------------------------
-- 5. Rights
------------------------------------------------------------------------------------------------
revoke execute on function public.admin_zones(),
  public.admin_save_zone(text, text, bigint, smallint, text, integer, smallint, smallint, boolean, smallint),
  public.admin_set_zone_status(smallint, public.zone_status), public.admin_launch_mode(),
  public.admin_set_launch_mode(public.launch_mode),
  public.admin_tribes(), public.admin_save_tribe(text, text, text, smallint, boolean, smallint),
  public.admin_keywords(), public.admin_save_keyword(text, text, public.report_category, boolean, integer),
  public.admin_questions(), public.admin_save_question(smallint, text, text, boolean, jsonb),
  public.admin_zone_health(smallint, date, date)
  from public, anon;
grant execute on function public.admin_zones(),
  public.admin_save_zone(text, text, bigint, smallint, text, integer, smallint, smallint, boolean, smallint),
  public.admin_set_zone_status(smallint, public.zone_status), public.admin_launch_mode(),
  public.admin_set_launch_mode(public.launch_mode),
  public.admin_tribes(), public.admin_save_tribe(text, text, text, smallint, boolean, smallint),
  public.admin_keywords(), public.admin_save_keyword(text, text, public.report_category, boolean, integer),
  public.admin_questions(), public.admin_save_question(smallint, text, text, boolean, jsonb),
  public.admin_zone_health(smallint, date, date)
  to authenticated;
