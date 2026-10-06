-- Phase 4f: the Promenade builder, third pass (speed; same rules, same result).
-- The complicity of every pair was a join over every question then an aggregate: ~36 µs per pair,
-- about 3 minutes for 5,000 Visitors × 1,000 Bads. Answers are now turned into bitsets once per
-- member, and a pair is scored with a few AND and bit counts (see the comment in the function).
-- The excluded pairs (blocks, Demandes, shown within 14 days) are gathered once into a temporary
-- table; work_mem is raised for this nightly job only (the project default, 2 MB, spills to disk).
-- Checked against the Phase 4a builder on varied data (skipped answers, < 5 questions in common,
-- several accepted options, blocks): same picks, same ranks, same scores.

create or replace function public.build_daily_promenade(p_zone smallint, p_date date)
returns integer language plpgsql security definer set search_path = '' set work_mem = '32MB' as $$
declare
  tz text;
  vis_from timestamptz;
  max_per_bad integer := (select promenade_max_appearances_per_day from public.app_settings);
  open_all boolean := exists (select 1 from public.app_settings s where s.launch_mode = 'open');
  max_rounds constant integer := 60;
  build_no integer;
  visitors integer;
  batch_from integer;
  batch_to integer;
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
    build integer, n integer, id uuid, is_bad boolean, gender public.gender, seeking public.gender[],
    age integer, age_min smallint, age_max smallint, activity integer, busy boolean,
    q varbit, ql varbit, qi varbit, qe varbit, o varbit, al varbit, ai varbit, ae varbit
  ) on commit drop;
  create temporary table if not exists promenade_pairs (
    build integer, visitor_id uuid, bad_id uuid, score integer, nth integer
  ) on commit drop;
  create temporary table if not exists promenade_excluded (
    build integer, vn integer, bn integer
  ) on commit drop;
  create temporary table if not exists promenade_state (
    build integer, visitor_id uuid, last_nth integer, picks integer, active boolean
  ) on commit drop;
  create index if not exists promenade_pairs_next on promenade_pairs (build, visitor_id, nth);
  build_no := coalesce((select max(build) from promenade_members), 0) + 1;

  -- Visitors of the zone (is_member_active) and Bads seen by Visitors (is_bad_visible), open.
  insert into promenade_members
  select build_no, row_number() over (partition by p.role order by p.id), p.id, p.role = 'bad', p.gender, p.seeking_genders, public.age_years(p.birthdate),
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

  -- Answers as bitsets, so that the complicity of a pair is a few AND and bit counts instead of a
  -- join over every question. Active question k (0-based) owns bit k of the « question » sets and
  -- bits k·S … k·S + S − 1 of the « option » sets (S = most options of a question):
  --   q   questions answered          ql / qi / qe  the same, by importance (low, important, essential)
  --   o   option chosen               al / ai / ae  options accepted from the other, by importance
  -- For a pair (a, b), with weights 1 / 10 / 50 as importance_weight:
  --   common questions  = bits(a.q & b.q)
  --   d_a = bits(a.ql & b.q) + 10·bits(a.qi & b.q) + 50·bits(a.qe & b.q)
  --   n_a = bits(a.al & b.o) + 10·bits(a.ai & b.o) + 50·bits(a.ae & b.o)
  --   a's essential answer not accepted ⇔ bits(a.ae & b.o) < bits(a.qe & b.q)
  with qs as (
    select qu.id, (row_number() over (order by qu.id) - 1)::integer as k from public.questions qu where qu.is_active
  ),
  dims as (
    select (select count(*) from qs)::integer as nq,
      coalesce((select max(o.position) from public.question_options o join qs on qs.id = o.question_id), 1)::integer as s
  ),
  answers as (
    select m.n, m.is_bad, qs.k, o.position - 1 as pos, a.importance,
      coalesce((select bit_or(1 << (ao.position - 1)) from public.question_options ao
                where ao.question_id = a.question_id and ao.id = any (a.accepted_option_ids)), -1) as acc
    from public.answers a
    join qs on qs.id = a.question_id
    join public.question_options o on o.question_id = a.question_id and o.id = a.option_id
    join promenade_members m on m.build = build_no and m.id = a.user_id
  ),
  question_bits as (
    select x.n, x.is_bad,
      string_agg(case when an.k is null then '0' else '1' end, '' order by g) as q,
      string_agg(case when an.importance = 'low' then '1' else '0' end, '' order by g) as ql,
      string_agg(case when an.importance = 'important' then '1' else '0' end, '' order by g) as qi,
      string_agg(case when an.importance = 'essential' then '1' else '0' end, '' order by g) as qe
    from (select pm.n, pm.is_bad from promenade_members pm where pm.build = build_no) x
    cross join dims cross join generate_series(0, dims.nq - 1) g
    left join answers an on an.n = x.n and an.is_bad = x.is_bad and an.k = g
    group by x.n, x.is_bad
  ),
  option_bits as (
    select x.n, x.is_bad,
      string_agg(case when an.pos = g % dims.s then '1' else '0' end, '' order by g) as o,
      string_agg(case when an.importance = 'low' and (an.acc >> (g % dims.s)) & 1 = 1 then '1' else '0' end, '' order by g) as al,
      string_agg(case when an.importance = 'important' and (an.acc >> (g % dims.s)) & 1 = 1 then '1' else '0' end, '' order by g) as ai,
      string_agg(case when an.importance = 'essential' and (an.acc >> (g % dims.s)) & 1 = 1 then '1' else '0' end, '' order by g) as ae
    from (select pm.n, pm.is_bad from promenade_members pm where pm.build = build_no) x
    cross join dims cross join generate_series(0, dims.nq * dims.s - 1) g
    left join answers an on an.n = x.n and an.is_bad = x.is_bad and an.k = g / dims.s
    group by x.n, x.is_bad
  )
  update promenade_members pm set q = qb.q::varbit, ql = qb.ql::varbit, qi = qb.qi::varbit, qe = qb.qe::varbit,
    o = ob.o::varbit, al = ob.al::varbit, ai = ob.ai::varbit, ae = ob.ae::varbit
  from question_bits qb join option_bits ob on ob.n = qb.n and ob.is_bad = qb.is_bad
  where pm.build = build_no and pm.n = qb.n and pm.is_bad = qb.is_bad;

  -- Pairs never proposed: a block either way, a Demande already sent, shown within 14 days.
  insert into promenade_excluded
  select build_no, v.n, b.n
  from (select k.blocker_id as x, k.blocked_id as y from public.blocks k where k.unblocked_at is null
        union all select k.blocked_id, k.blocker_id from public.blocks k where k.unblocked_at is null
        union all select r.visitor_id, r.bad_id from public.visit_requests r
        union all select pp.visitor_id, pp.bad_id from public.promenade_picks pp where pp.promenade_date > p_date - 14) e
  join promenade_members v on v.build = build_no and not v.is_bad and v.id = e.x
  join promenade_members b on b.build = build_no and b.is_bad and b.id = e.y;
  analyze promenade_members;
  analyze promenade_excluded;

  -- Every pair (criteria in both directions, no block, no request, not shown within 14 days),
  -- scored, in batches of 500 Visitors; nth = rank of the Bad in the Visitor's list.
  visitors := (select count(*) from promenade_members pm where pm.build = build_no and not pm.is_bad);
  for batch_from in 1 .. visitors by 500 loop
    batch_to := batch_from + 499;
    insert into promenade_pairs (build, visitor_id, bad_id, score, nth)
    with pairs as (
      select v.id as visitor_id, b.id as bad_id, b.activity, b.busy,
        bit_count(v.q & b.q) as cnt,
        bit_count(v.al & b.o) + 10 * bit_count(v.ai & b.o) + 50 * bit_count(v.ae & b.o) as n_a,
        bit_count(v.ql & b.q) + 10 * bit_count(v.qi & b.q) + 50 * bit_count(v.qe & b.q) as d_a,
        bit_count(b.al & v.o) + 10 * bit_count(b.ai & v.o) + 50 * bit_count(b.ae & v.o) as n_b,
        bit_count(b.ql & v.q) + 10 * bit_count(b.qi & v.q) + 50 * bit_count(b.qe & v.q) as d_b,
        bit_count(v.ae & b.o) < bit_count(v.qe & b.q) or bit_count(b.ae & v.o) < bit_count(b.qe & v.q) as cap
      from promenade_members v
      join promenade_members b on b.build = build_no and b.is_bad
        -- criteria_match, both directions
        and v.gender = any (b.seeking) and b.gender = any (v.seeking)
        and v.age between b.age_min and b.age_max and b.age between v.age_min and v.age_max
      where v.build = build_no and not v.is_bad and v.n between batch_from and batch_to
        and not exists (select 1 from promenade_excluded e where e.build = build_no and e.vn = v.n and e.bn = b.n)
    ),
    -- complicity_from_sums, written in the query: s = round(100 × √(n_a·n_b / d_a·d_b)), exact
    -- (the float estimate is corrected by one step each way, as the function's loops do); unknown
    -- (0 here) under 5 common questions.
    est as (
      select p.visitor_id, p.bad_id, p.activity, p.busy, p.cap,
        p.cnt >= 5 and p.d_a > 0 and p.d_b > 0 as known,
        40000::bigint * p.n_a * p.n_b as num, p.d_a::bigint * p.d_b as den,
        case when p.d_a > 0 and p.d_b > 0
          then round(100 * sqrt((p.n_a::bigint * p.n_b)::double precision / (p.d_a::bigint * p.d_b)))::bigint
          else 0 end as s0
      from pairs p
    ),
    down as (
      select e.*, e.s0 - (case when e.s0 > 0 and (2 * e.s0 - 1) * (2 * e.s0 - 1) * e.den > e.num then 1 else 0 end) as s1
      from est e
    ),
    scored as (
      -- score = complicity (0 if unknown) + activity bonus (0–20), × 0.5 above half of the cap.
      select d.visitor_id, d.bad_id,
        ((case when d.known
            then least(d.s1 + (case when (2 * d.s1 + 1) * (2 * d.s1 + 1) * d.den <= d.num then 1 else 0 end),
                       case when d.cap then 50 else 32767 end)
            else 0 end + d.activity) * (case when d.busy then 0.5 else 1 end))::integer as score
      from down d
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
