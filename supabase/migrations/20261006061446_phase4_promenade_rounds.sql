-- Phase 4f: the Promenade builder, second pass.
-- 20261006055943 kept only each Visitor's 60 best candidates; that is not neutral, because a Bad
-- already full is skipped without using a round: some Visitors ran out of candidates. Every pair is
-- now kept, and each Visitor walks down their own list (promenade_state.last_nth), skipping full
-- Bads. Checked against the Phase 4a builder: same picks, same ranks, same scores.
-- The CTEs are materialized: inlined, the planner joined the pairs to the complicity sums in a
-- nested loop (11 s for 60 × 60 instead of 0.1 s).
-- complicity_from_sums is written in the query (an exact integer rounding, one correction step
-- each way after the float estimate, as the function's loops do): one call per pair was too slow.

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
  proposed integer;
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
    build integer, visitor_id uuid, bad_id uuid, score integer, nth integer
  ) on commit drop;
  create temporary table if not exists promenade_state (
    build integer, visitor_id uuid, last_nth integer, picks integer, active boolean
  ) on commit drop;
  create index if not exists promenade_pairs_next on promenade_pairs (build, visitor_id, nth);
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

  -- Every pair (criteria in both directions, no block, no request, not shown within 14 days),
  -- scored, in batches of 500 Visitors; nth = rank of the Bad in the Visitor's list.
  for batch in
    select array_agg(m.id) from (
      select pm.id, (row_number() over (order by pm.id) - 1) / 500 as grp
      from promenade_members pm where pm.build = build_no and not pm.is_bad) m
    group by m.grp
  loop
    insert into promenade_pairs (build, visitor_id, bad_id, score, nth)
    with pairs as materialized (
      select v.id as visitor_id, b.id as bad_id, b.activity, b.busy
      from promenade_members v
      join promenade_members b on b.build = build_no and b.is_bad
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
    sums as materialized (
      select va.user_id as visitor_id, ba.user_id as bad_id,
        coalesce(sum(va.w) filter (where va.accepted is null or ba.option_id = any (va.accepted)), 0)::bigint as n_a,
        sum(va.w)::bigint as d_a,
        coalesce(sum(ba.w) filter (where ba.accepted is null or va.option_id = any (ba.accepted)), 0)::bigint as n_b,
        sum(ba.w)::bigint as d_b,
        count(*) as cnt,
        coalesce(bool_or((va.essential and not (va.accepted is null or ba.option_id = any (va.accepted)))
                      or (ba.essential and not (ba.accepted is null or va.option_id = any (ba.accepted)))), false) as cap
      from promenade_answers va
      join promenade_answers ba on ba.build = build_no and ba.question_id = va.question_id
      join promenade_members bm on bm.build = build_no and bm.id = ba.user_id and bm.is_bad
      where va.build = build_no and va.user_id = any (batch)
      group by va.user_id, ba.user_id
    ),
    -- complicity_from_sums, written in the query: s = round(100 × √(n_a·n_b / d_a·d_b)), exact
    -- (the float estimate is corrected by one step each way, as the function's loops do).
    est as (
      select s.visitor_id, s.bad_id, s.cap, 40000 * s.n_a * s.n_b as p, s.d_a * s.d_b as q,
        round(100 * sqrt((s.n_a * s.n_b)::double precision / (s.d_a * s.d_b)))::bigint as s0
      from sums s where s.cnt >= 5 and s.d_a > 0 and s.d_b > 0
    ),
    down as (
      select e.*, e.s0 - (case when e.s0 > 0 and (2 * e.s0 - 1) * (2 * e.s0 - 1) * e.q > e.p then 1 else 0 end) as s1
      from est e
    ),
    complicity as materialized (
      select d.visitor_id, d.bad_id,
        least(d.s1 + (case when (2 * d.s1 + 1) * (2 * d.s1 + 1) * d.q <= d.p then 1 else 0 end),
              case when d.cap then 50 else 32767 end) as score
      from down d
    ),
    scored as (
      -- score = complicity (0 if unknown) + activity bonus (0–20), × 0.5 above half of the cap.
      select p.visitor_id, p.bad_id,
        ((coalesce(c.score, 0) + p.activity) * (case when p.busy then 0.5 else 1 end))::integer as score
      from pairs p left join complicity c on c.visitor_id = p.visitor_id and c.bad_id = p.bad_id
    )
    select build_no, sc.visitor_id, sc.bad_id, sc.score,
      row_number() over (partition by sc.visitor_id order by sc.score desc, sc.bad_id)
    from scored sc;
  end loop;
  analyze promenade_pairs;

  insert into promenade_state
  select build_no, pm.id, 0, coalesce((select count(*) from public.promenade_picks x
                                       where x.visitor_id = pm.id and x.promenade_date = p_date), 0), true
  from promenade_members pm where pm.build = build_no and not pm.is_bad;

  -- Rounds: each Visitor proposes their next candidate (Bads already full are skipped); each Bad
  -- keeps at most its remaining capacity (best scores first); the others try again next round.
  loop
    round_no := round_no + 1;
    with full_bads as (
      select x.bad_id from public.promenade_picks x where x.promenade_date = p_date
      group by x.bad_id having count(*) >= max_per_bad
    ),
    proposals as (
      select st.visitor_id, nx.bad_id, nx.score, nx.nth, st.picks
      from promenade_state st
      cross join lateral (
        select pp.bad_id, pp.score, pp.nth from promenade_pairs pp
        where pp.build = build_no and pp.visitor_id = st.visitor_id and pp.nth > st.last_nth
          and pp.bad_id not in (select f.bad_id from full_bads f)
        order by pp.nth limit 1) nx
      where st.build = build_no and st.active and st.picks < 5
    ),
    ranked as (
      select pr.*, row_number() over (partition by pr.bad_id order by pr.score desc, pr.visitor_id) as rnk,
        coalesce((select count(*) from public.promenade_picks x
                  where x.bad_id = pr.bad_id and x.promenade_date = p_date), 0) as used
      from proposals pr
    ),
    kept as (
      insert into public.promenade_picks (visitor_id, bad_id, zone_id, promenade_date, rank, score, visible_from, visible_until)
      select r.visitor_id, r.bad_id, p_zone, p_date, r.picks + 1, least(r.score, 32767), vis_from, vis_from + interval '1 day'
      from ranked r where r.used + r.rnk <= max_per_bad
      returning visitor_id
    ),
    moved as (
      update promenade_state st set last_nth = pr.nth,
        picks = st.picks + (select count(*) from kept k where k.visitor_id = pr.visitor_id)
      from proposals pr
      where st.build = build_no and st.visitor_id = pr.visitor_id
      returning st.visitor_id
    )
    select count(*) into proposed from moved;
    -- A Visitor without a proposal this round has no candidate left.
    update promenade_state st set active = false
    where st.build = build_no and st.active and st.picks < 5
      and not exists (select 1 from promenade_pairs pp where pp.build = build_no
                      and pp.visitor_id = st.visitor_id and pp.nth > st.last_nth);
    exit when proposed = 0 or round_no >= max_rounds;
  end loop;
  select count(*) into inserted from public.promenade_picks where zone_id = p_zone and promenade_date = p_date;
  return inserted;
end;
$$;
