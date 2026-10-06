-- Phase 4f performance, part 2: the Promenade builder with the conditions written in the query
-- (see 20261006055602_phase4_perf_inline.sql for why), scored in batches of 500 Visitors.

------------------------------------------------------------------------------------------------
-- 3. La Promenade: same rules, built in batches of Visitors.
--    Each Visitor proposes one candidate per round and there are at most 60 rounds, so only their
--    60 best candidates can ever be proposed: the others are not kept (same result, less work).
------------------------------------------------------------------------------------------------
create or replace function public.build_daily_promenade(p_zone smallint, p_date date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  tz text;
  vis_from timestamptz;
  max_per_bad integer := (select promenade_max_appearances_per_day from public.app_settings);
  open_all boolean := exists (select 1 from public.app_settings s where s.launch_mode = 'open');
  max_rounds constant integer := 60;
  build_no integer;
  batch uuid[];
  round_no integer := 0;
  inserted integer := 0;
begin
  select timezone into tz from public.launch_zones where id = p_zone;
  if tz is null then return 0; end if;
  vis_from := (p_date + time '21:00') at time zone tz;

  -- Temporary tables live until the end of the transaction (the job may build several zones or
  -- dates in a row): rows are tagged with their build number instead of being removed.
  create temporary table if not exists promenade_members (
    build integer, id uuid, is_bad boolean, gender public.gender, seeking public.gender[],
    age integer, age_min smallint, age_max smallint, activity integer, busy boolean
  ) on commit drop;
  create temporary table if not exists promenade_answers (
    build integer, user_id uuid, question_id smallint, option_id smallint, accepted smallint[],
    w integer, essential boolean
  ) on commit drop;
  create temporary table if not exists promenade_pairs (
    build integer, visitor_id uuid, bad_id uuid, score integer, nth integer, taken boolean
  ) on commit drop;
  build_no := coalesce((select max(build) from promenade_members), 0) + 1;

  -- Visitors of the zone (is_member_active) and Bads seen by Visitors (is_bad_visible), open.
  insert into promenade_members
  select build_no, p.id, p.role = 'bad', p.gender, p.seeking_genders, public.age_years(p.birthdate),
    p.seek_age_min, p.seek_age_max,
    greatest(0, 20 - (extract(epoch from now() - p.last_seen_at) / 86400)::integer),
    p.pending_requests_count * 2 > p.requests_cap
  from public.profiles p
  where not p.is_seed
    and p.onboarding_completed_at is not null and p.banned_at is null and p.hidden_reason is null
    and (p.suspended_until is null or p.suspended_until <= now())
    and ((p.role = 'visitor' and p.zone_id = p_zone)
      or (p.role = 'bad' and p.requests_open and not p.is_paused
          and p.last_seen_at >= now() - interval '90 days'
          and (p.zone_id = p_zone or open_all)
          and (open_all or p.zone_id in (select z.id from public.launch_zones z where z.status = 'open'))
          and exists (select 1 from public.casier_charges c where c.profile_id = p.id)
          and (select count(distinct ph.position) from public.photos ph
               where ph.owner_id = p.id and ph.position in (0, 1, 2) and ph.status = 'approved') = 3));

  -- Their answers to the active questions, weights as importance_weight.
  insert into promenade_answers
  select build_no, a.user_id, a.question_id, a.option_id, a.accepted_option_ids,
    case a.importance when 'low' then 1 when 'important' then 10 else 50 end, a.importance = 'essential'
  from public.answers a
  join public.questions qu on qu.id = a.question_id and qu.is_active
  join promenade_members m on m.build = build_no and m.id = a.user_id;
  analyze promenade_members;
  analyze promenade_answers;

  for batch in
    select array_agg(m.id) from (
      select pm.id, (row_number() over (order by pm.id) - 1) / 500 as grp
      from promenade_members pm where pm.build = build_no and not pm.is_bad) m
    group by m.grp
  loop
    insert into promenade_pairs (build, visitor_id, bad_id, score, nth, taken)
    with pairs as (
      select v.id as visitor_id, b.id as bad_id, b.activity, b.busy
      from promenade_members v
      join promenade_members b on b.build = build_no and b.is_bad
        -- criteria_match, both directions
        and v.gender = any (b.seeking) and b.gender = any (v.seeking)
        and v.age between b.age_min and b.age_max and b.age between v.age_min and v.age_max
      where v.build = build_no and not v.is_bad and v.id = any (batch)
        and not exists (select 1 from public.blocks k where k.unblocked_at is null
                        and k.blocker_id = v.id and k.blocked_id = b.id)
        and not exists (select 1 from public.blocks k where k.unblocked_at is null
                        and k.blocker_id = b.id and k.blocked_id = v.id)
        and not exists (select 1 from public.visit_requests r where r.visitor_id = v.id and r.bad_id = b.id)
        and not exists (select 1 from public.promenade_picks pp where pp.visitor_id = v.id and pp.bad_id = b.id
                        and pp.promenade_date > p_date - 14)
    ),
    sums as (
      select va.user_id as visitor_id, ba.user_id as bad_id,
        public.complicity_from_sums(
          sum(va.w) filter (where va.accepted is null or ba.option_id = any (va.accepted)), sum(va.w),
          sum(ba.w) filter (where ba.accepted is null or va.option_id = any (ba.accepted)), sum(ba.w),
          count(*)::integer,
          coalesce(bool_or((va.essential and not (va.accepted is null or ba.option_id = any (va.accepted)))
                        or (ba.essential and not (ba.accepted is null or va.option_id = any (ba.accepted)))), false)) as score
      from promenade_answers va
      join promenade_answers ba on ba.build = build_no and ba.question_id = va.question_id
      where va.build = build_no and va.user_id = any (batch)
        and ba.user_id in (select pm.id from promenade_members pm where pm.build = build_no and pm.is_bad)
      group by va.user_id, ba.user_id
    ),
    scored as (
      -- score = complicity (0 if unknown) + activity bonus (0–20), × 0.5 above half of the cap.
      select p.visitor_id, p.bad_id,
        ((coalesce(s.score, 0) + p.activity) * (case when p.busy then 0.5 else 1 end))::integer as score
      from pairs p left join sums s on s.visitor_id = p.visitor_id and s.bad_id = p.bad_id
    )
    select build_no, x.visitor_id, x.bad_id, x.score, x.nth, false
    from (select sc.*, row_number() over (partition by sc.visitor_id order by sc.score desc, sc.bad_id) as nth
          from scored sc) x
    where x.nth <= max_rounds;
  end loop;
  analyze promenade_pairs;

  -- Rounds: each Visitor proposes their best free candidate; each Bad keeps at most its remaining
  -- capacity (best scores first); the others try again with their next candidate.
  loop
    round_no := round_no + 1;
    with visitor_counts as (
      select x.visitor_id, count(*) as n from public.promenade_picks x where x.promenade_date = p_date group by x.visitor_id
    ),
    bad_counts as (
      select x.bad_id, count(*) as n from public.promenade_picks x where x.promenade_date = p_date group by x.bad_id
    ),
    proposals as (
      select distinct on (pp.visitor_id) pp.visitor_id, pp.bad_id, pp.score, coalesce(vc.n, 0) as already
      from promenade_pairs pp
      left join visitor_counts vc on vc.visitor_id = pp.visitor_id
      where pp.build = build_no and not pp.taken and coalesce(vc.n, 0) < 5
      order by pp.visitor_id, pp.nth
    ),
    ranked as (
      select pr.*, row_number() over (partition by pr.bad_id order by pr.score desc, pr.visitor_id) as nth,
        coalesce(bc.n, 0) as used
      from proposals pr left join bad_counts bc on bc.bad_id = pr.bad_id
    ),
    kept as (
      insert into public.promenade_picks (visitor_id, bad_id, zone_id, promenade_date, rank, score, visible_from, visible_until)
      select r.visitor_id, r.bad_id, p_zone, p_date, r.already + 1, least(r.score, 32767), vis_from, vis_from + interval '1 day'
      from ranked r where r.used + r.nth <= max_per_bad
      returning visitor_id, bad_id
    )
    update promenade_pairs pp set taken = true
    from proposals pr
    where pp.build = build_no and pp.visitor_id = pr.visitor_id and pp.bad_id = pr.bad_id;
    -- Bads that are full and Visitors that are served are no longer proposed.
    update promenade_pairs pp set taken = true
    from (select x.bad_id from public.promenade_picks x where x.promenade_date = p_date
          group by x.bad_id having count(*) >= max_per_bad) full_bads
    where pp.build = build_no and not pp.taken and pp.bad_id = full_bads.bad_id;
    update promenade_pairs pp set taken = true
    from (select x.visitor_id from public.promenade_picks x where x.promenade_date = p_date
          group by x.visitor_id having count(*) >= 5) served
    where pp.build = build_no and not pp.taken and pp.visitor_id = served.visitor_id;
    exit when not exists (select 1 from promenade_pairs pp where pp.build = build_no and not pp.taken)
      or round_no >= max_rounds;
  end loop;
  select count(*) into inserted from public.promenade_picks where zone_id = p_zone and promenade_date = p_date;
  return inserted;
end;
$$;
