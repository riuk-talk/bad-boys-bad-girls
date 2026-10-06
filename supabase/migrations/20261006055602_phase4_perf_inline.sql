-- Phase 4f performance: the Découverte and the Promenade inline their per-row conditions.
-- A SQL function declared with `set search_path` is never inlined by the planner, so calling
-- is_bad_visible, criteria_match, distance_km or importance_weight on each row costs about
-- 0.1–0.3 ms per call: 1.1 s for one Découverte page over 1,000 Bads (target: 200 ms).
-- The rules are unchanged: the inlined conditions are the same as those helpers (kept for
-- single checks: can_view_bad, get_fiche…), and supabase/tests/phase4_perf.test.sql checks that
-- the Découverte returns exactly the Bads can_view_bad allows.

------------------------------------------------------------------------------------------------
-- 1. Complicity with many members: weights inlined (same values as importance_weight).
------------------------------------------------------------------------------------------------
create or replace function public.complicity_with(p_viewer uuid, p_others uuid[])
returns table (other_id uuid, score smallint)
language sql stable security definer set search_path = '' as $$
  with mine as (
    select a.question_id, a.option_id, a.accepted_option_ids,
      case a.importance when 'low' then 1 when 'important' then 10 else 50 end as w,
      a.importance = 'essential' as essential
    from public.answers a join public.questions qu on qu.id = a.question_id and qu.is_active
    where a.user_id = p_viewer
  ),
  theirs as (
    select o.user_id, o.question_id, o.option_id, o.accepted_option_ids,
      case o.importance when 'low' then 1 when 'important' then 10 else 50 end as w,
      o.importance = 'essential' as essential
    from public.answers o
    where o.user_id in (select unnest(p_others)) and o.user_id <> p_viewer
  ),
  pairs as (
    select t.user_id, m.w as w_a, t.w as w_b,
      m.accepted_option_ids is null or t.option_id = any (m.accepted_option_ids) as ok_a,
      t.accepted_option_ids is null or m.option_id = any (t.accepted_option_ids) as ok_b,
      m.essential as ess_a, t.essential as ess_b
    from mine m join theirs t on t.question_id = m.question_id
  )
  select user_id,
    public.complicity_from_sums(
      sum(w_a) filter (where ok_a), sum(w_a), sum(w_b) filter (where ok_b), sum(w_b), count(*)::integer,
      coalesce(bool_or((ess_a and not ok_a) or (ess_b and not ok_b)), false))
  from pairs
  group by user_id
$$;

------------------------------------------------------------------------------------------------
-- 2. La Découverte: the visibility of a Bad, the criteria in both directions and the blocks are
--    written in the query; the distance, the town and the photo only for the page returned.
------------------------------------------------------------------------------------------------
create or replace function public.discover_bads(
  p_age_min integer default 18, p_age_max integer default 99, p_max_km integer default null,
  p_tribe_ids smallint[] default null, p_good_conduct_only boolean default false,
  p_recently_active boolean default false, p_cursor_key bigint default null, p_cursor_id uuid default null,
  p_limit integer default 24)
returns table (id uuid, pseudo text, gender public.gender, age integer, city text, distance_km integer,
  photo_small text, good_conduct boolean, requests_open boolean, complicity smallint, sort_key bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.profiles;
  open_all boolean;
  v_age integer;
  age_lo integer;
  age_hi integer;
begin
  select * into v from public.profiles p where p.id = (select auth.uid());
  if not found or v.role is distinct from 'visitor' or not public.is_member_active(v) then
    raise exception 'visitors_only' using errcode = '42501';
  end if;
  if not public.zone_is_open(v.zone_id) then return; end if;
  open_all := exists (select 1 from public.app_settings s where s.launch_mode = 'open');
  v_age := public.age_years(v.birthdate);
  -- The Bad's age must suit the Visitor's criteria and the filter: age_years(b) between lo and hi
  -- is birthdate in (today − (hi + 1) years, today − lo years].
  age_lo := greatest(v.seek_age_min, p_age_min, 18);
  age_hi := least(v.seek_age_max, p_age_max, 99);
  return query
  with candidates as materialized (
    select b.id, b.pseudo, b.gender, b.birthdate, b.place_id, b.is_reglo, b.requests_open,
      b.last_seen_at, b.lat, b.lng
    from public.profiles b
    where b.role = 'bad' and b.id <> v.id
      -- is_bad_visible
      and b.onboarding_completed_at is not null and b.banned_at is null and b.hidden_reason is null
      and (b.suspended_until is null or b.suspended_until <= now())
      and not b.is_paused and b.last_seen_at >= now() - interval '90 days'
      and (open_all or b.zone_id in (select z.id from public.launch_zones z where z.status = 'open'))
      and exists (select 1 from public.casier_charges c where c.profile_id = b.id)
      and (select count(distinct ph.position) from public.photos ph
           where ph.owner_id = b.id and ph.position in (0, 1, 2) and ph.status = 'approved') = 3
      -- criteria_match, both directions
      and v.gender = any (b.seeking_genders) and b.gender = any (v.seeking_genders)
      and v_age between b.seek_age_min and b.seek_age_max
      and b.birthdate > (current_date - make_interval(years => age_hi + 1))::date
      and b.birthdate <= (current_date - make_interval(years => age_lo))::date
      -- is_blocked_between
      and not exists (select 1 from public.blocks k where k.unblocked_at is null
                      and ((k.blocker_id = v.id and k.blocked_id = b.id) or (k.blocker_id = b.id and k.blocked_id = v.id)))
      and (p_max_km is null or (b.lat is not null and v.lat is not null
           and extensions.earth_box(extensions.ll_to_earth(v.lat, v.lng), p_max_km * 1000) operator(extensions.@>) extensions.ll_to_earth(b.lat, b.lng)
           and extensions.earth_distance(extensions.ll_to_earth(v.lat, v.lng), extensions.ll_to_earth(b.lat, b.lng)) <= p_max_km * 1000))
      and (p_tribe_ids is null or exists (select 1 from public.profile_tribes pt
                                          where pt.profile_id = b.id and pt.tribe_id = any (p_tribe_ids)))
      and (not p_good_conduct_only or b.is_reglo)
      and (not p_recently_active or b.last_seen_at >= now() - interval '7 days')
  ),
  scored as (
    select c.*, s.score,
      -- « Parloir complet » last, then complicity, then recent activity.
      ((case when c.requests_open then 1 else 0 end)::bigint * 1000000
        + (coalesce(s.score, -1) + 1)::bigint * 1000
        + greatest(0, 999 - (extract(epoch from now() - c.last_seen_at) / 86400)::integer))::bigint as key
    from candidates c
    left join public.complicity_with(v.id, array(select c2.id from candidates c2)) s on s.other_id = c.id
  ),
  page as (
    select sc.* from scored sc
    where p_cursor_key is null or (sc.key, sc.id) < (p_cursor_key, p_cursor_id)
    order by sc.key desc, sc.id desc
    limit greatest(least(p_limit, 48), 1)
  )
  select pg.id, pg.pseudo::text, pg.gender, public.age_years(pg.birthdate), public.place_name(pg.place_id),
    case when pg.lat is null or v.lat is null then null
      else round(extensions.earth_distance(extensions.ll_to_earth(v.lat, v.lng),
                                           extensions.ll_to_earth(pg.lat, pg.lng)) / 1000)::integer end,
    (select ph.public_path_small from public.photos ph where ph.owner_id = pg.id and ph.position = 0 and ph.status = 'approved'),
    pg.is_reglo, pg.requests_open, pg.score, pg.key
  from page pg
  order by pg.key desc, pg.id desc;
end;
$$;
