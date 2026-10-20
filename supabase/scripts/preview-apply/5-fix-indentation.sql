-- bad-boys-preview (chvnmzmvcjvhxlnfmlvv) seulement. Remet à l'identique des fichiers ce que le
-- collage dans le SQL Editor a ré-indenté (des centaines d'espaces ajoutées en début de ligne) :
-- 1. les 4 fonctions qui contiennent un mot destructif (le connecteur refuse de les redéfinir) ;
-- 2. le texte d'historique des 4 migrations 7a, 7c (×2) et 7d.
-- Les 15 autres fonctions ont déjà été redéfinies à l'identique par le connecteur.
-- À lancer avec psql, qui envoie le texte tel quel (pas par copier-coller dans l'éditeur) :
--   psql "<chaîne de connexion de bad-boys-preview>" -v ON_ERROR_STOP=1 -f 5-fix-indentation.sql
-- La dernière requête affiche les empreintes, à comparer à celles en commentaire.

begin;

create or replace function public.cleanup_rows()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pushes integer; emails integer; hashes integer; days integer;
begin
  delete from public.push_outbox where status in ('sent', 'failed', 'skipped') and created_at < now() - interval '30 days';
  get diagnostics pushes = row_count;
  delete from public.email_outbox where status in ('sent', 'failed', 'skipped') and created_at < now() - interval '30 days';
  get diagnostics emails = row_count;
  delete from public.banned_email_hashes where expires_at < now();
  get diagnostics hashes = row_count;
  delete from public.activity_days where day < current_date - 400;
  get diagnostics days = row_count;
  return jsonb_build_object('push_outbox', pushes, 'email_outbox', emails, 'banned_email_hashes', hashes,
    'activity_days', days);
end;
$$;

create or replace function public.build_daily_promenade(p_zone smallint, p_date date)
returns integer language plpgsql security definer set search_path = '' set work_mem = '32MB' as $$
declare
  tz text;
  vis_from timestamptz;
  max_per_bad integer := (select promenade_max_appearances_per_day from public.app_settings);
  open_all boolean := exists (select 1 from public.app_settings s where s.launch_mode = 'open');
  max_rounds constant integer := 60; -- per tier
  build_no integer;
  visitors integer;
  batch_from integer;
  batch_to integer;
  round_no integer := 0;
  proposed integer;
  inserted integer := 0;
begin
  -- p_zone null: the members outside every quartier, only when launch_mode = 'open' (SPEC §2:
  -- the open mode lifts the quartiers), on the time of France.
  if p_zone is null then
    if not open_all then return 0; end if;
    tz := 'Europe/Paris';
  else
    select timezone into tz from public.launch_zones where id = p_zone;
  end if;
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
    and ((p.role = 'visitor' and p.zone_id is not distinct from p_zone)
      or (p.role = 'bad' and p.requests_open and not p.is_paused
          -- Seen in the last 21 days (SPEC §5: an inactive Fiche leaves the Promenade).
          and p.last_seen_at >= now() - interval '21 days'
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
    with pairs as materialized (
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
    est as materialized (
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

  -- Places are given out by tiers (Chris, 2026-10-06): first one Bad for every Visitor, then a
  -- second, and so on up to 5, always within the daily cap of each Bad. In tier t, only Visitors
  -- with fewer than t Bads propose. Each round, every such Visitor proposes their next candidate
  -- (Bads already full are skipped); each Bad keeps at most its remaining capacity, best scores
  -- first; the others try again with their next candidate. A Visitor left without a Bad therefore
  -- means every Bad they could meet is full.
  for tier in 1 .. 5 loop
    round_no := 0;
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
        where st.build = build_no and st.active and st.picks < tier
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
      -- A Visitor whose list is exhausted has no candidate left, in this tier or the next ones.
      update promenade_state st set active = false
      where st.build = build_no and st.active and st.picks < 5
        and not exists (select 1 from promenade_pairs pp where pp.build = build_no
                        and pp.visitor_id = st.visitor_id and pp.nth > st.last_nth);
      exit when proposed = 0 or round_no >= max_rounds;
    end loop;
  end loop;
  select count(*) into inserted from public.promenade_picks where zone_id is not distinct from p_zone and promenade_date = p_date;
  return inserted;
end;
$$;

create or replace function public.moderation_actions_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.target_user_id is not null
     and not exists (select 1 from public.profiles p where p.id = old.target_user_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'append_only' using errcode = '42501';
end;
$$;

create or replace function public.prepare_my_account_deletion()
returns table (pending_paths text[], public_paths text[])
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform private.close_cases_of(me, 'account_deleted');
  update public.messages set body = '', removed_at = now(), system_payload = jsonb_build_object('type', 'removed')
  where sender_id = me and kind = 'text';
  delete from public.messages m
  using public.conversations c
  where m.conversation_id = c.id and m.kind = 'system'
    and ((m.system_payload ->> 'type' = 'note' and c.visitor_id = me)
      or (m.system_payload ->> 'type' = 'bet' and c.bad_id = me));
  return query
    select
      coalesce((select array_agg(ph.pending_path) from public.photos ph where ph.owner_id = me and ph.pending_path is not null), '{}'),
      coalesce((select array_agg(x.path) from public.photos ph
                cross join lateral (values (ph.public_path_large), (ph.public_path_small)) x(path)
                where ph.owner_id = me and x.path is not null), '{}');
end;
$$;

-- 20261019130100_phase7a_moderation.sql, MD5 attendu : 52b8eb75a56ef1349c8201794063b7d0
update supabase_migrations.schema_migrations set statements = array[$mig$-- Phase 7a: la modération (SPEC §10 DSA, §14, §15). Reports and flagged texts are decided by an
-- admin with a written motive; the reporter and the member concerned each receive their own
-- exposé des motifs (never the identity of the reporter, never the sanction of someone else).
-- Sanctions: warning, suspension (1 to 90 days), ban (e-mail fingerprint + Auth account banned,
-- sessions revoked), Fiche hidden, Bonne conduite withdrawn, text removed. Every admin function
-- checks is_admin() (second factor, aal2) first; moderation_actions stays append-only; the super
-- admin has no profile, so nothing here can reach them (Phase 5a-ter guards still apply).

------------------------------------------------------------------------------------------------
-- 1. Columns
------------------------------------------------------------------------------------------------
-- The motive written for the reporter (the member concerned gets the one of moderation_actions).
alter table public.reports add column decision_reason varchar(1000);
alter table public.moderation_actions
  add column ends_at timestamptz,
  add column flag_id bigint references public.flagged_texts (id) on delete set null;
alter table public.flagged_texts
  add column decided_by uuid,
  add column decided_at timestamptz,
  add column decision_reason varchar(1000);
create index moderation_actions_recent on public.moderation_actions (created_at desc);
-- A message removed by the Greffe: its text is erased, the bubble says so.
alter table public.messages add column removed_at timestamptz;

------------------------------------------------------------------------------------------------
-- 2. Internal helpers (schema private, never exposed; invoker rights, called by the functions
--    below only)
------------------------------------------------------------------------------------------------
-- A motive is mandatory for every decision that reaches a member: 10 to 1,000 characters.
create function private.motive(p_text text)
returns text language plpgsql immutable set search_path = '' as $$
declare t text := btrim(coalesce(p_text, ''));
begin
  if char_length(t) < 10 or char_length(t) > 1000 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  return t;
end;
$$;

create function private.member_state(p public.profiles)
returns text language sql stable set search_path = '' as $$
  select case
    when p.banned_at is not null then 'banned'
    when p.suspended_until > now() then 'suspended'
    when p.hidden_reason is not null then 'hidden'
    when p.onboarding_completed_at is null then 'onboarding'
    else 'active' end
$$;

-- Closes every open case of a sanctioned member, so that nobody meets or writes to them meanwhile
-- (the close trigger cancels the visits, the Cavales and the conversations). The other one is told
-- neutrally: « Affaire classée » for a Visitor, the cancelled visit for a Bad.
create function private.close_cases_of(p_user uuid, p_reason public.case_close_reason)
returns void language plpgsql set search_path = '' as $$
begin
  perform public.notify(v.bad_id, 'visit_cancelled', jsonb_build_object('request_id', v.request_id, 'visit_id', v.id))
  from public.visits v where v.visitor_id = p_user and v.status = 'scheduled';
  with closed as (
    update public.visit_requests r
    set status = 'closed', close_reason = p_reason, closed_at = now(), choose_deadline = null, repropose_deadline = null
    where r.status in ('pending', 'accepted', 'released') and p_user in (r.visitor_id, r.bad_id)
    returning r.id, r.visitor_id, r.bad_id
  )
  insert into public.notifications (user_id, type, payload)
  select c.visitor_id, 'request_dismissed', jsonb_build_object('request_id', c.id)
  from closed c where c.bad_id = p_user;
end;
$$;

-- Who may be sanctioned: a member with a profile (so never the super admin), never oneself, and an
-- admin only by the super admin.
create function private.sanction_target(p_user uuid)
returns public.profiles language plpgsql set search_path = '' as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = p_user for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_user = (select auth.uid()) then raise exception 'self_sanction' using errcode = '42501'; end if;
  if exists (select 1 from public.admin_users where user_id = p_user)
     and not exists (select 1 from public.super_admins where user_id = (select auth.uid())) then
    raise exception 'admin_protected' using errcode = '42501';
  end if;
  return p;
end;
$$;

-- Applies one sanction, records it (append-only) and tells the member concerned. A banned member
-- cannot sign in any more: the exposé des motifs also goes by e-mail (sent in Phase 7e).
create function private.apply_sanction(p_user uuid, p_action public.moderation_action_type, p_reason text,
  p_days integer, p_report bigint, p_flag bigint)
returns bigint language plpgsql set search_path = '' as $$
declare
  p public.profiles := private.sanction_target(p_user);
  ends timestamptz;
  address text;
  action_id bigint;
begin
  case p_action
    when 'warn', 'text_remove' then
      null;
    when 'suspend' then
      if p_days is null or p_days not between 1 and 90 then raise exception 'invalid_days' using errcode = '22023'; end if;
      ends := now() + make_interval(days => p_days);
      update public.profiles set suspended_until = greatest(coalesce(suspended_until, ends), ends) where id = p_user;
      perform private.close_cases_of(p_user, 'moderation');
    when 'ban' then
      if p.banned_at is not null then raise exception 'already_banned' using errcode = '23514'; end if;
      update public.profiles set banned_at = now() where id = p_user;
      select u.email into address from auth.users u where u.id = p_user;
      if address is not null then
        insert into public.banned_email_hashes (hash, expires_at)
        values (public.ban_email_hash(address),
                now() + make_interval(months => (select s.ban_hash_retention_months from public.app_settings s where s.id)))
        on conflict (hash) do update set banned_at = now(), expires_at = excluded.expires_at;
      end if;
      update auth.users set banned_until = now() + interval '100 years' where id = p_user;
      delete from auth.sessions where user_id = p_user;
      perform private.close_cases_of(p_user, 'banned');
    when 'unban' then
      -- Lifting a ban is reserved to the super admin.
      if not exists (select 1 from public.super_admins where user_id = (select auth.uid())) then
        raise exception 'super_admin_only' using errcode = '42501';
      end if;
      if p.banned_at is null then raise exception 'not_banned' using errcode = '23514'; end if;
      update public.profiles set banned_at = null where id = p_user;
      update auth.users set banned_until = null where id = p_user;
      select u.email into address from auth.users u where u.id = p_user;
      if address is not null then
        delete from public.banned_email_hashes where hash = public.ban_email_hash(address);
      end if;
    when 'hide_profile' then
      if p.hidden_reason = 'moderation' then raise exception 'already_hidden' using errcode = '23514'; end if;
      update public.profiles set hidden_reason = 'moderation' where id = p_user;
      perform private.close_cases_of(p_user, 'moderation');
    when 'unhide_profile' then
      if p.hidden_reason is null then raise exception 'not_hidden' using errcode = '23514'; end if;
      update public.profiles set hidden_reason = null where id = p_user;
    when 'revoke_good_conduct' then
      if not p.is_reglo then raise exception 'no_good_conduct' using errcode = '23514'; end if;
    else
      raise exception 'invalid_action' using errcode = '22023';
  end case;
  -- Bonne conduite goes at once with a report upheld, a suspension, a ban or a hidden Fiche (SPEC §14).
  if p_action in ('suspend', 'ban', 'hide_profile', 'revoke_good_conduct') or p_report is not null then
    update public.profiles set is_reglo = false where id = p_user and is_reglo;
  end if;
  insert into public.moderation_actions (target_user_id, action, reason, report_id, flag_id, admin_id, ends_at)
  values (p_user, p_action, p_reason, p_report, p_flag, (select auth.uid()), ends)
  returning id into action_id;
  perform public.notify(p_user, 'sanction', jsonb_build_object('action_id', action_id));
  if p_action = 'ban' then
    insert into public.email_outbox (user_id, kind, payload, priority)
    values (p_user, 'moderation_decision', jsonb_build_object('action_id', action_id), 10);
  end if;
  return action_id;
end;
$$;

revoke execute on function private.motive(text), private.member_state(public.profiles),
  private.close_cases_of(uuid, public.case_close_reason), private.sanction_target(uuid),
  private.apply_sanction(uuid, public.moderation_action_type, text, integer, bigint, bigint)
  from public, anon, authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 3. Admin: the report queue and its decision
------------------------------------------------------------------------------------------------
-- Open reports, « mineur » first, then threats, harassment, scams, then the oldest. The reported
-- content itself is shown (the text, the photo), nothing more of the conversation.
create function public.admin_report_queue(p_limit integer default 50)
returns table (report_id bigint, created_at timestamptz, category public.report_category, comment text,
  target_type public.report_target, target_id text, target_user_id uuid, target_pseudo text,
  target_role public.member_role, target_state text, target_open_reports integer,
  target_upheld_reports integer, reporter_pseudo text, content text, photo_path text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select r.id, r.created_at, r.category, r.comment::text, r.target_type, r.target_id, r.target_user_id,
      t.pseudo::text, t.role, private.member_state(t),
      (select count(*)::integer from public.reports x where x.target_user_id = r.target_user_id and x.status = 'open'),
      (select count(*)::integer from public.reports x where x.target_user_id = r.target_user_id and x.status = 'upheld'),
      rp.pseudo::text,
      case r.target_type
        when 'profile' then t.bio::text
        when 'permit' then t.visit_motive::text
        when 'casier' then (select concat_ws(' / ', c.charge_1, c.charge_2, c.charge_3)
                            from public.casier_charges c where c.profile_id = t.id)
        when 'visit_request' then (select v.note::text from public.visit_requests v where v.id::text = r.target_id)
        when 'message' then (select m.body::text from public.messages m
                             where m.id::text = r.target_id and m.removed_at is null)
      end,
      case when r.target_type = 'photo' then
        (select ph.public_path_large from public.photos ph where ph.id::text = r.target_id) end
    from public.reports r
    left join public.profiles t on t.id = r.target_user_id
    left join public.profiles rp on rp.id = r.reporter_id
    where r.status = 'open'
    order by case r.category when 'minor' then 0 when 'violence_threat' then 1 when 'harassment' then 2
                             when 'scam' then 3 else 4 end,
             r.created_at
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- One decision per report: upheld (with a sanction and a motive for the member concerned) or
-- rejected; the reporter always gets a motive. A « mineur » hiding is lifted once no « mineur »
-- report on the member is still open and none was upheld.
create function public.admin_decide_report(p_report bigint, p_upheld boolean, p_reason_reporter text,
  p_action public.moderation_action_type default null, p_reason_target text default null,
  p_days integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.reports; reporter_motive text;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into r from public.reports where id = p_report for update;
  if not found or r.target_user_id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status <> 'open' then raise exception 'already_decided' using errcode = '23514'; end if;
  reporter_motive := private.motive(p_reason_reporter);
  if p_upheld then
    if p_action is null or p_action not in ('warn', 'suspend', 'ban', 'hide_profile') then
      raise exception 'invalid_action' using errcode = '22023';
    end if;
    perform private.apply_sanction(r.target_user_id, p_action, private.motive(p_reason_target), p_days, r.id, null);
  elsif p_action is not null then
    raise exception 'invalid_action' using errcode = '22023';
  elsif r.target_user_id = (select auth.uid()) then
    raise exception 'self_sanction' using errcode = '42501';
  end if;
  update public.reports
  set status = case when p_upheld then 'upheld'::public.report_status else 'rejected'::public.report_status end,
      decided_by = (select auth.uid()), decided_at = now(), decision_reason = reporter_motive
  where id = r.id;
  if not p_upheld and r.category = 'minor'
     and not exists (select 1 from public.reports x where x.target_user_id = r.target_user_id
                     and x.category = 'minor' and x.status in ('open', 'upheld')) then
    update public.profiles set hidden_reason = null where id = r.target_user_id and hidden_reason = 'minor_report';
  end if;
  if r.reporter_id is not null then
    perform public.notify(r.reporter_id, 'report_decided', jsonb_build_object('report_id', r.id));
  end if;
end;
$$;

------------------------------------------------------------------------------------------------
-- 4. Admin: flagged texts (keywords)
------------------------------------------------------------------------------------------------
-- Texts the Greffe can erase itself; the others (pseudo, Motif de visite, Casier, place of a
-- Cavale) are upheld and dealt with by a sanction (the Fiche hidden until it is corrected).
create function private.removable_source(p_source public.flag_source)
returns boolean language sql immutable set search_path = '' as $$
  select p_source in ('bio', 'tribe_detail', 'visit_request', 'message')
$$;
revoke execute on function private.removable_source(public.flag_source) from public, anon, authenticated, service_role;

create function public.admin_flag_queue(p_limit integer default 50)
returns table (flag_id bigint, created_at timestamptz, source public.flag_source, excerpt text,
  matched_terms text[], user_id uuid, pseudo text, role public.member_role, state text, removable boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select f.id, f.created_at, f.source, f.excerpt, f.matched_terms, f.user_id, p.pseudo::text, p.role,
      private.member_state(p), private.removable_source(f.source)
    from public.flagged_texts f
    left join public.profiles p on p.id = f.user_id
    where f.status = 'open'
    order by f.created_at
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- 'clear': nothing wrong (the motive is optional, the member is not told);
-- 'uphold': the text breaks the rules, the admin sanctions from the member page;
-- 'remove': the text is erased and the member gets the motive.
create function public.admin_decide_flag(p_flag bigint, p_decision text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.flagged_texts; motive text;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into f from public.flagged_texts where id = p_flag for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if f.status <> 'open' then raise exception 'already_decided' using errcode = '23514'; end if;
  if p_decision = 'clear' then
    motive := left(nullif(btrim(coalesce(p_reason, '')), ''), 1000);
    if f.user_id is not null then
      perform private.sanction_target(f.user_id);
      insert into public.moderation_actions (target_user_id, action, reason, flag_id, admin_id)
      values (f.user_id, 'text_clear', motive, f.id, (select auth.uid()));
    end if;
  elsif p_decision = 'uphold' then
    motive := private.motive(p_reason);
  elsif p_decision = 'remove' then
    motive := private.motive(p_reason);
    if not private.removable_source(f.source) then raise exception 'not_removable' using errcode = '23514'; end if;
    case f.source
      when 'bio' then
        update public.profiles set bio = null where id = f.user_id;
      when 'tribe_detail' then
        update public.profile_tribes set detail = null where profile_id = f.user_id and tribe_id::text = f.source_id;
      when 'visit_request' then
        update public.visit_requests set note = null where id::text = f.source_id;
        delete from public.messages m
        where m.kind = 'system' and m.system_payload ->> 'type' = 'note'
          and m.conversation_id in (select c.id from public.conversations c where c.request_id::text = f.source_id);
      when 'message' then
        update public.messages set body = '', removed_at = now() where id::text = f.source_id and kind = 'text';
    end case;
    if f.user_id is not null then
      perform private.apply_sanction(f.user_id, 'text_remove', motive, null, null, f.id);
    end if;
  else
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  update public.flagged_texts
  set status = case when p_decision = 'clear' then 'rejected'::public.report_status else 'upheld'::public.report_status end,
      decided_by = (select auth.uid()), decided_at = now(), decision_reason = motive
  where id = f.id;
end;
$$;

------------------------------------------------------------------------------------------------
-- 5. Admin: members, sanctions, history
------------------------------------------------------------------------------------------------
-- By the start of the pseudo or the exact e-mail (never returned). Never by the N° d'écrou: no
-- function takes it as an input (PARCOURS-DESIGN §2).
create function public.admin_find_members(p_query text)
returns table (user_id uuid, pseudo text, role public.member_role, state text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare q text := btrim(coalesce(p_query, ''));
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if char_length(q) < 2 or char_length(q) > 254 then return; end if;
  return query
    select p.id, p.pseudo::text, p.role, private.member_state(p), p.created_at
    from public.profiles p
    where p.pseudo::text ilike replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
       or p.id = (select u.id from auth.users u where lower(u.email) = lower(q) limit 1)
    order by p.pseudo
    limit 20;
end;
$$;

create function public.admin_member(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into p from public.profiles where id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'id', p.id, 'pseudo', p.pseudo, 'role', p.role, 'gender', p.gender,
    'created_at', p.created_at, 'last_seen_at', p.last_seen_at, 'state', private.member_state(p),
    'suspended_until', case when p.suspended_until > now() then p.suspended_until end,
    'hidden_reason', p.hidden_reason, 'banned_at', p.banned_at, 'good_conduct', p.is_reglo,
    'is_admin', exists (select 1 from public.admin_users a where a.user_id = p.id),
    'zone', (select z.name from public.launch_zones z where z.id = p.zone_id),
    'reports_made', (select count(*) from public.reports r where r.reporter_id = p.id),
    'reports_received', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'created_at', r.created_at, 'category', r.category,
        'target_type', r.target_type, 'status', r.status, 'comment', r.comment, 'decision_reason', r.decision_reason)
        order by r.created_at desc)
      from public.reports r where r.target_user_id = p.id), '[]'),
    'actions', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'created_at', m.created_at, 'action', m.action,
        'reason', m.reason, 'ends_at', m.ends_at, 'report_id', m.report_id) order by m.created_at desc)
      from public.moderation_actions m where m.target_user_id = p.id), '[]'),
    'flags', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'created_at', f.created_at, 'source', f.source,
        'excerpt', f.excerpt, 'status', f.status) order by f.created_at desc)
      from (select * from public.flagged_texts x where x.user_id = p.id order by x.created_at desc limit 20) f), '[]'));
end;
$$;

create function public.admin_sanction(p_user uuid, p_action public.moderation_action_type, p_reason text,
  p_days integer default null)
returns bigint language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if p_action not in ('warn', 'suspend', 'ban', 'unban', 'hide_profile', 'unhide_profile', 'revoke_good_conduct') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  return private.apply_sanction(p_user, p_action, private.motive(p_reason), p_days, null, null);
end;
$$;

-- Historique des décisions: every action recorded, the newest first.
create function public.admin_moderation_log(p_limit integer default 100)
returns table (action_id bigint, created_at timestamptz, action public.moderation_action_type, reason text,
  ends_at timestamptz, target_user_id uuid, target_pseudo text, report_id bigint, flag_id bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select m.id, m.created_at, m.action, m.reason, m.ends_at, m.target_user_id, p.pseudo::text, m.report_id, m.flag_id
    from public.moderation_actions m
    left join public.profiles p on p.id = m.target_user_id
    where m.action not in ('photo_approve', 'photo_reject')
    order by m.created_at desc, m.id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

------------------------------------------------------------------------------------------------
-- 6. Members: the exposé des motifs
------------------------------------------------------------------------------------------------
-- The sanction in force, if any (the screen shown instead of the site).
create function public.get_my_sanction()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case
    when p.banned_at is not null then jsonb_build_object('state', 'banned', 'reason',
      (select m.reason from public.moderation_actions m where m.target_user_id = p.id and m.action = 'ban'
       order by m.created_at desc limit 1))
    when p.suspended_until > now() then jsonb_build_object('state', 'suspended', 'until', p.suspended_until, 'reason',
      (select m.reason from public.moderation_actions m where m.target_user_id = p.id and m.action = 'suspend'
       order by m.created_at desc limit 1))
    when p.hidden_reason = 'moderation' then jsonb_build_object('state', 'hidden', 'reason',
      (select m.reason from public.moderation_actions m where m.target_user_id = p.id and m.action = 'hide_profile'
       order by m.created_at desc limit 1))
    when p.hidden_reason = 'minor_report' then jsonb_build_object('state', 'review')
  end
  from public.profiles p where p.id = (select auth.uid())
$$;

-- The reports I made (outcome and the motive written for me, nothing about the sanction) and the
-- decisions about me (the motive written for me, never who reported).
create function public.get_my_decisions()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'created_at', r.created_at, 'category', r.category,
        'target_type', r.target_type, 'status', r.status, 'decided_at', r.decided_at, 'reason', r.decision_reason)
        order by r.created_at desc)
      from public.reports r where r.reporter_id = (select auth.uid())), '[]'),
    'decisions', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'created_at', m.created_at, 'action', m.action,
        'reason', m.reason, 'ends_at', m.ends_at) order by m.created_at desc)
      from public.moderation_actions m
      where m.target_user_id = (select auth.uid())
        and m.action in ('warn', 'suspend', 'ban', 'unban', 'hide_profile', 'unhide_profile',
                         'revoke_good_conduct', 'text_remove')), '[]'))
$$;

------------------------------------------------------------------------------------------------
-- 7. A message removed by the Greffe is read as removed (body null)
------------------------------------------------------------------------------------------------
create or replace function public.get_messages(p_conversation uuid, p_after bigint default 0)
returns table (id bigint, kind public.message_kind, mine boolean, body text, payload jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.conversations;
begin
  select * into c from public.conversations x where x.id = p_conversation;
  if not found or me is null or me not in (c.bad_id, c.visitor_id) or public.is_blocked_between(c.bad_id, c.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return query
    select m.id, m.kind,
      case when m.kind = 'text' then m.sender_id = me
           when m.system_payload ->> 'type' = 'note' then me = c.visitor_id
           else false end,
      case when m.removed_at is null then m.body::text end, m.system_payload, m.created_at
    from public.messages m
    where m.conversation_id = c.id and m.id > coalesce(p_after, 0)
    order by m.id
    limit 300;
end;
$$;

------------------------------------------------------------------------------------------------
-- 8. Rights
------------------------------------------------------------------------------------------------
revoke execute on function public.admin_report_queue(integer),
  public.admin_decide_report(bigint, boolean, text, public.moderation_action_type, text, integer),
  public.admin_flag_queue(integer), public.admin_decide_flag(bigint, text, text),
  public.admin_find_members(text), public.admin_member(uuid),
  public.admin_sanction(uuid, public.moderation_action_type, text, integer),
  public.admin_moderation_log(integer), public.get_my_sanction(), public.get_my_decisions()
  from public, anon;
grant execute on function public.admin_report_queue(integer),
  public.admin_decide_report(bigint, boolean, text, public.moderation_action_type, text, integer),
  public.admin_flag_queue(integer), public.admin_decide_flag(bigint, text, text),
  public.admin_find_members(text), public.admin_member(uuid),
  public.admin_sanction(uuid, public.moderation_action_type, text, integer),
  public.admin_moderation_log(integer), public.get_my_sanction(), public.get_my_decisions()
  to authenticated;
$mig$]
where version = '20261019130100';

-- 20261020110000_phase7c_jobs.sql, MD5 attendu : 6e883863984fa13f247796199949e564
update supabase_migrations.schema_migrations set statements = array[$mig$-- Phase 7c: les tâches planifiées (SPEC §3, §5, §11, §14, SCHEMA §3.5). Every day: Bonne conduite,
-- Fiches en veille, automatic opening of the quartiers, clean-up. What touches files or Auth
-- accounts is done by the route /api/cron/cleanup (secret key), called through pg_net only when
-- there is something to do; the super admin and the admins are never purged.

------------------------------------------------------------------------------------------------
-- 1. Bonne conduite (SPEC §14), every day
------------------------------------------------------------------------------------------------
-- A Bad gets it with: an account older than 30 days, at least 3 visits where they were there, no
-- report ever upheld against them, no absence and no late cancellation in the last 30 days, and
-- no warning, suspension, hidden Fiche or withdrawal of the badge in the last 30 days.
create function public.compute_good_conduct()
returns integer language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  with verdict as (
    select p.id,
      p.created_at < now() - interval '30 days'
      and public.is_member_active(p)
      and (select count(*) from public.visits x
           where x.bad_id = p.id and x.status in ('ended', 'no_show') and x.bad_joined_at is not null) >= 3
      and not exists (select 1 from public.reports r where r.target_user_id = p.id and r.status = 'upheld')
      and not exists (select 1 from public.visits x
                      where x.bad_id = p.id and x.starts_at > now() - interval '30 days'
                        and (x.absent in ('bad', 'both')
                             or (x.status = 'cancelled' and x.cancelled_late and x.cancelled_by = p.id)))
      and not exists (select 1 from public.moderation_actions m
                      where m.target_user_id = p.id and m.created_at > now() - interval '30 days'
                        and m.action in ('warn', 'suspend', 'ban', 'hide_profile', 'revoke_good_conduct')) as ok
    from public.profiles p
    where p.role = 'bad' and not p.is_seed
  )
  update public.profiles p set is_reglo = v.ok
  from verdict v where p.id = v.id and p.is_reglo is distinct from v.ok;
  get diagnostics changed = row_count;
  -- The badge belongs to Bads only (a role change takes it away).
  update public.profiles set is_reglo = false where role is distinct from 'bad' and is_reglo and not is_seed;
  return changed;
end;
$$;

------------------------------------------------------------------------------------------------
-- 2. Fiches en veille (SPEC §5): 90 days without signing in → hidden everywhere (is_bad_visible
--    already), told once (notification + e-mail « Ta Fiche est en veille »); back on sign-in.
--    21 days: out of the Promenade, last in the Découverte (migration phase7c_inactive_fiches).
------------------------------------------------------------------------------------------------
create function public.process_inactive_profiles()
returns integer language plpgsql security definer set search_path = '' as $$
declare slept integer;
begin
  with dormant as (
    update public.profiles p set dormant_since = now()
    where p.role = 'bad' and p.onboarding_completed_at is not null and not p.is_seed
      and p.banned_at is null and p.dormant_since is null
      and coalesce(p.last_seen_at, p.created_at) < now() - interval '90 days'
    returning p.id
  ), told as (
    insert into public.notifications (user_id, type, payload)
    select d.id, 'profile_dormant', '{}' from dormant d
    returning user_id
  )
  insert into public.email_outbox (user_id, kind, payload, priority)
  select t.user_id, 'profile_dormant', '{}', 30 from told t;
  get diagnostics slept = row_count;
  return slept;
end;
$$;

-- Last activity, at most one write per hour, the day of activity with it, and a sleeping Fiche
-- wakes up.
create or replace function public.touch_activity()
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  update public.profiles set last_seen_at = now(), dormant_since = null
  where id = me and (last_seen_at is null or last_seen_at < now() - interval '1 hour');
  if found then
    insert into public.activity_days (user_id, day)
    values (me, (now() at time zone 'Europe/Paris')::date)
    on conflict do nothing;
  end if;
end;
$$;

------------------------------------------------------------------------------------------------
-- 3. Quartiers (SPEC §3): ready_at the first time the thresholds are reached (the admins are told
--    once, by e-mail), opened by itself when auto_open is set
------------------------------------------------------------------------------------------------
-- Opening a quartier: its members are told (notification, e-mail sent in Phase 7e).
create function private.open_zone(p_zone smallint)
returns void language plpgsql set search_path = '' as $$
begin
  update public.launch_zones set status = 'open', opened_at = now() where id = p_zone and status <> 'open';
  if not found then return; end if;
  insert into public.notifications (user_id, type, payload)
  select p.id, 'zone_opened', jsonb_build_object('zone_id', p_zone)
  from public.profiles p
  where p.zone_id = p_zone and p.onboarding_completed_at is not null and p.banned_at is null and not p.is_seed;
  insert into public.email_outbox (user_id, kind, payload, priority)
  select p.id, 'zone_opened', jsonb_build_object('zone_id', p_zone), 40
  from public.profiles p
  where p.zone_id = p_zone and p.onboarding_completed_at is not null and p.banned_at is null and not p.is_seed;
end;
$$;
revoke execute on function private.open_zone(smallint) from public, anon, authenticated, service_role;

create or replace function public.admin_set_zone_status(p_zone smallint, p_status public.zone_status)
returns void language plpgsql security definer set search_path = '' as $$
declare z public.launch_zones;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into z from public.launch_zones where id = p_zone for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if z.status = p_status then raise exception 'same_status' using errcode = '23514'; end if;
  if p_status = 'open' then
    perform private.open_zone(p_zone);
  else
    update public.launch_zones set status = p_status where id = p_zone;
  end if;
end;
$$;

create function public.auto_open_zones()
returns integer language plpgsql security definer set search_path = '' as $$
declare z record; opened integer := 0;
begin
  for z in select lz.id, lz.auto_open, lz.ready_at from public.launch_zones lz where lz.status = 'waitlist' loop
    if (private.zone_gauge(z.id) ->> 'ready')::boolean then
      if z.ready_at is null then
        update public.launch_zones set ready_at = now() where id = z.id;
        -- The admins have no member profile necessarily: the e-mail carries their id.
        insert into public.email_outbox (user_id, kind, payload, priority)
        select null, 'admin_zone_ready', jsonb_build_object('zone_id', z.id, 'admin_id', a.user_id), 5
        from (select user_id from public.admin_users union select user_id from public.super_admins) a;
      end if;
      if z.auto_open then
        perform private.open_zone(z.id);
        opened := opened + 1;
      end if;
    end if;
  end loop;
  return opened;
end;
$$;

------------------------------------------------------------------------------------------------
-- 4. Clean-up (rows), every day
------------------------------------------------------------------------------------------------
-- Queues already handled (30 days), expired e-mail fingerprints, days of activity older than 400
-- days (retention needs J30 at most).
create function public.cleanup_rows()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pushes integer; emails integer; hashes integer; days integer;
begin
  delete from public.push_outbox where status in ('sent', 'failed', 'skipped') and created_at < now() - interval '30 days';
  get diagnostics pushes = row_count;
  delete from public.email_outbox where status in ('sent', 'failed', 'skipped') and created_at < now() - interval '30 days';
  get diagnostics emails = row_count;
  delete from public.banned_email_hashes where expires_at < now();
  get diagnostics hashes = row_count;
  delete from public.activity_days where day < current_date - 400;
  get diagnostics days = row_count;
  return jsonb_build_object('push_outbox', pushes, 'email_outbox', emails, 'banned_email_hashes', hashes,
    'activity_days', days);
end;
$$;

------------------------------------------------------------------------------------------------
-- 5. Clean-up (files and Auth accounts), done by /api/cron/cleanup with the secret key
------------------------------------------------------------------------------------------------
-- Photo path rotation (SPEC §11): after 30 days of pause and at a ban, the public files get a new
-- random name and the old ones are erased, so that old links stop working.
alter table public.photos add column path_rotated_at timestamptz;

-- Accounts whose onboarding is not finished 30 days after sign-up (SPEC §4): never an admin,
-- never the super admin.
create function public.cleanup_accounts_due(p_limit integer default 50)
returns table (user_id uuid, pending_paths text[], public_paths text[])
language sql stable security definer set search_path = '' as $$
  select u.id,
    coalesce((select array_agg(ph.pending_path) from public.photos ph where ph.owner_id = u.id and ph.pending_path is not null), '{}'),
    coalesce((select array_agg(x.path) from public.photos ph
              cross join lateral (values (ph.public_path_large), (ph.public_path_small)) x(path)
              where ph.owner_id = u.id and x.path is not null), '{}')
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.created_at < now() - interval '30 days'
    and (p.id is null or p.onboarding_completed_at is null)
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not exists (select 1 from public.super_admins s where s.user_id = u.id)
  order by u.created_at
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

create function public.cleanup_photos_due(p_limit integer default 50)
returns table (photo_id uuid, public_path_large text, public_path_small text)
language sql stable security definer set search_path = '' as $$
  select ph.id, ph.public_path_large, ph.public_path_small
  from public.photos ph join public.profiles p on p.id = ph.owner_id
  where ph.status = 'approved' and ph.public_path_large is not null and ph.public_path_small is not null
    and ((p.banned_at is not null and (ph.path_rotated_at is null or ph.path_rotated_at < p.banned_at))
      or (p.is_paused and p.paused_at < now() - interval '30 days'
          and (ph.path_rotated_at is null or ph.path_rotated_at < p.paused_at + interval '30 days')))
  order by ph.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

-- Records the new names once the files are copied; refused if the photo changed meanwhile.
create function public.cleanup_photo_rotated(p_photo uuid, p_old_large text, p_new_large text, p_new_small text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_new_large is null or p_new_small is null
     or p_new_large !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
     or p_new_small !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-s\.webp$' then
    raise exception 'invalid_public_path' using errcode = '22023';
  end if;
  update public.photos
  set public_path_large = p_new_large, public_path_small = p_new_small, path_rotated_at = now()
  where id = p_photo and public_path_large = p_old_large and status = 'approved';
  return found;
end;
$$;

-- Calls the route only when there is a file or an account to deal with (same secret and host as
-- the push route).
create function public.cleanup_dispatch()
returns boolean language plpgsql security definer set search_path = '' as $$
declare url text; secret text; bypass text; headers jsonb;
begin
  if not exists (select 1 from public.cleanup_accounts_due(1)) and not exists (select 1 from public.cleanup_photos_due(1)) then
    return false;
  end if;
  select ds.decrypted_secret into url from vault.decrypted_secrets ds where ds.name = 'push_endpoint_url';
  select ds.decrypted_secret into secret from vault.decrypted_secrets ds where ds.name = 'push_cron_secret';
  select ds.decrypted_secret into bypass from vault.decrypted_secrets ds where ds.name = 'vercel_protection_bypass';
  if url is null or secret is null or url !~ '/api/cron/push$' then return false; end if;
  headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || secret);
  if bypass is not null then headers := headers || jsonb_build_object('x-vercel-protection-bypass', bypass); end if;
  perform net.http_post(url := regexp_replace(url, '/api/cron/push$', '/api/cron/cleanup'), body := '{}'::jsonb,
    headers := headers, timeout_milliseconds := 60000);
  return true;
end;
$$;

------------------------------------------------------------------------------------------------
-- 6. Rights and schedule (times in UTC, at night in France)
------------------------------------------------------------------------------------------------
revoke execute on function public.compute_good_conduct(), public.process_inactive_profiles(),
  public.auto_open_zones(), public.cleanup_rows(), public.cleanup_dispatch(),
  public.cleanup_accounts_due(integer), public.cleanup_photos_due(integer),
  public.cleanup_photo_rotated(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_accounts_due(integer), public.cleanup_photos_due(integer),
  public.cleanup_photo_rotated(uuid, text, text, text) to service_role;

select cron.schedule('good-conduct', '10 2 * * *', 'select public.compute_good_conduct()');
select cron.schedule('inactive-profiles', '20 2 * * *', 'select public.process_inactive_profiles()');
select cron.schedule('auto-open-zones', '30 2 * * *', 'select public.auto_open_zones()');
select cron.schedule('cleanup', '40 2 * * *', 'select public.cleanup_rows(); select public.cleanup_dispatch()');
$mig$]
where version = '20261020110000';

-- 20261020110100_phase7c_inactive_fiches.sql, MD5 attendu : ef0a53b8838382df6d339df5ada82b14
update supabase_migrations.schema_migrations set statements = array[$mig$-- Phase 7c: les Fiches inactives (SPEC §5). Without signing in for 21 days, a Bad leaves the
-- Promenade and comes last in the Découverte; after 90 days the Fiche is hidden everywhere
-- (is_bad_visible, unchanged) and goes to sleep (process_inactive_profiles).
-- Same signatures: both functions are redefined as they were, with only these two changes.

create or replace function public.build_daily_promenade(p_zone smallint, p_date date)
returns integer language plpgsql security definer set search_path = '' set work_mem = '32MB' as $$
declare
  tz text;
  vis_from timestamptz;
  max_per_bad integer := (select promenade_max_appearances_per_day from public.app_settings);
  open_all boolean := exists (select 1 from public.app_settings s where s.launch_mode = 'open');
  max_rounds constant integer := 60; -- per tier
  build_no integer;
  visitors integer;
  batch_from integer;
  batch_to integer;
  round_no integer := 0;
  proposed integer;
  inserted integer := 0;
begin
  -- p_zone null: the members outside every quartier, only when launch_mode = 'open' (SPEC §2:
  -- the open mode lifts the quartiers), on the time of France.
  if p_zone is null then
    if not open_all then return 0; end if;
    tz := 'Europe/Paris';
  else
    select timezone into tz from public.launch_zones where id = p_zone;
  end if;
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
    and ((p.role = 'visitor' and p.zone_id is not distinct from p_zone)
      or (p.role = 'bad' and p.requests_open and not p.is_paused
          -- Seen in the last 21 days (SPEC §5: an inactive Fiche leaves the Promenade).
          and p.last_seen_at >= now() - interval '21 days'
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
    with pairs as materialized (
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
    est as materialized (
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

  -- Places are given out by tiers (Chris, 2026-10-06): first one Bad for every Visitor, then a
  -- second, and so on up to 5, always within the daily cap of each Bad. In tier t, only Visitors
  -- with fewer than t Bads propose. Each round, every such Visitor proposes their next candidate
  -- (Bads already full are skipped); each Bad keeps at most its remaining capacity, best scores
  -- first; the others try again with their next candidate. A Visitor left without a Bad therefore
  -- means every Bad they could meet is full.
  for tier in 1 .. 5 loop
    round_no := 0;
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
        where st.build = build_no and st.active and st.picks < tier
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
      -- A Visitor whose list is exhausted has no candidate left, in this tier or the next ones.
      update promenade_state st set active = false
      where st.build = build_no and st.active and st.picks < 5
        and not exists (select 1 from promenade_pairs pp where pp.build = build_no
                        and pp.visitor_id = st.visitor_id and pp.nth > st.last_nth);
      exit when proposed = 0 or round_no >= max_rounds;
    end loop;
  end loop;
  select count(*) into inserted from public.promenade_picks where zone_id is not distinct from p_zone and promenade_date = p_date;
  return inserted;
end;
$$;

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
      -- Fiches seen in the last 21 days first (SPEC §5), then « Parloir complet » last, then
      -- complicity, then recent activity.
      ((case when c.last_seen_at >= now() - interval '21 days' then 1 else 0 end)::bigint * 10000000
        + (case when c.requests_open then 1 else 0 end)::bigint * 1000000
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
$mig$]
where version = '20261020110100';

-- 20261020120000_phase7d_rgpd.sql, MD5 attendu : 2f7c4c641d38142920a5974e186e5430
update supabase_migrations.schema_migrations set statements = array[$mig$-- Phase 7d: RGPD (SPEC §10). The export of my data (mine only, the other person reduced to their
-- pseudo) and the real deletion of my account: my messages are erased and read « Message
-- supprimé », the conversation stays visible to the other person with « Ce compte a été
-- supprimé », my scheduled visits are cancelled, then the Auth account is deleted by the server
-- (files first) and every row follows by cascade. A banned e-mail cannot sign up again (hook of
-- Phase 2, fingerprint kept by the ban).

------------------------------------------------------------------------------------------------
-- 1. A conversation outlives the deletion of one of its two members
------------------------------------------------------------------------------------------------
alter table public.conversations
  alter column bad_id drop not null,
  alter column visitor_id drop not null,
  alter column request_id drop not null;
alter table public.conversations
  drop constraint conversations_bad_id_fkey,
  drop constraint conversations_visitor_id_fkey,
  drop constraint conversations_request_id_fkey;
alter table public.conversations
  add constraint conversations_bad_id_fkey foreign key (bad_id) references public.profiles (id) on delete set null,
  add constraint conversations_visitor_id_fkey foreign key (visitor_id) references public.profiles (id) on delete set null,
  add constraint conversations_request_id_fkey foreign key (request_id) references public.visit_requests (id) on delete set null;

-- The Parloirs sans horaire, plus the closed ones whose other member deleted their account.
create or replace function public.get_my_parloirs()
returns table (conversation_id uuid, other_id uuid, other_pseudo text, other_gender public.gender,
  other_photo_small text, released_at timestamptz, last_message_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, o.id, o.pseudo::text, o.gender,
    (select ph.public_path_small::text from public.photos ph
     where ph.owner_id = o.id and ph.position = 0 and ph.status = 'approved'),
    c.released_at, c.last_message_at
  from public.conversations c
  left join public.profiles o on o.id = case when c.bad_id = (select auth.uid()) then c.visitor_id else c.bad_id end
  where (select auth.uid()) in (c.bad_id, c.visitor_id)
    and (c.status = 'open' or (c.released_at is not null and (c.bad_id is null or c.visitor_id is null)))
    and not public.is_blocked_between(c.bad_id, c.visitor_id)
  order by coalesce(c.last_message_at, c.released_at) desc
  limit 50
$$;

create or replace function public.get_conversation(p_conversation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.conversations; o public.profiles;
begin
  select * into c from public.conversations where id = p_conversation;
  if not found or me is null or me not in (c.bad_id, c.visitor_id) or public.is_blocked_between(c.bad_id, c.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into o from public.profiles where id = case when me = c.bad_id then c.visitor_id else c.bad_id end;
  return jsonb_build_object(
    'id', c.id, 'request_id', c.request_id, 'status', c.status, 'released_at', c.released_at,
    'i_am_bad', me = c.bad_id,
    'unmasked', private.can_unmask(c.id),
    'other_deleted', o.id is null,
    'other', jsonb_build_object('id', o.id, 'pseudo', o.pseudo, 'gender', o.gender,
      'photo_small', (select ph.public_path_small from public.photos ph
                      where ph.owner_id = o.id and ph.position = 0 and ph.status = 'approved')));
end;
$$;

-- A message whose author deleted their account has no sender any more: it is not mine.
create or replace function public.get_messages(p_conversation uuid, p_after bigint default 0)
returns table (id bigint, kind public.message_kind, mine boolean, body text, payload jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.conversations;
begin
  select * into c from public.conversations x where x.id = p_conversation;
  if not found or me is null or me not in (c.bad_id, c.visitor_id) or public.is_blocked_between(c.bad_id, c.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return query
    select m.id, m.kind,
      case when m.kind = 'text' then coalesce(m.sender_id = me, false)
           when m.system_payload ->> 'type' = 'note' then coalesce(me = c.visitor_id, false)
           else false end,
      case when m.removed_at is null then m.body::text end, m.system_payload, m.created_at
    from public.messages m
    where m.conversation_id = c.id and m.id > coalesce(p_after, 0)
    order by m.id
    limit 300;
end;
$$;

------------------------------------------------------------------------------------------------
-- 2. The decisions of the Greffe stay append-only, except when their member is deleted
------------------------------------------------------------------------------------------------
-- The cascade from the deleted profile runs after the profile row is gone: only then may the
-- rows of that member be removed (or have a key set to null on the way).
create function public.moderation_actions_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.target_user_id is not null
     and not exists (select 1 from public.profiles p where p.id = old.target_user_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'append_only' using errcode = '42501';
end;
$$;
revoke execute on function public.moderation_actions_append_only() from public, anon, authenticated;
drop trigger moderation_actions_append_only on public.moderation_actions;
create trigger moderation_actions_append_only
  before update or delete on public.moderation_actions
  for each row execute function public.moderation_actions_append_only();

------------------------------------------------------------------------------------------------
-- 3. Export of my data (SPEC §10): mine only; the other person is their pseudo, never their text
------------------------------------------------------------------------------------------------
create function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); p public.profiles;
begin
  select * into p from public.profiles where id = me;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at)
                from auth.users u where u.id = me),
    'profile', to_jsonb(p) - 'referred_by',
    'photos', coalesce((select jsonb_agg(jsonb_build_object('position', ph.position, 'status', ph.status,
        'created_at', ph.created_at, 'reviewed_at', ph.reviewed_at, 'rejection_reason', ph.rejection_reason)
        order by ph.position) from public.photos ph where ph.owner_id = me), '[]'),
    'signes', coalesce((select jsonb_agg(jsonb_build_object('signe', t.label, 'detail', pt.detail))
        from public.profile_tribes pt join public.tribes t on t.id = pt.tribe_id where pt.profile_id = me), '[]'),
    'casier', (select to_jsonb(c) - 'profile_id' from public.casier_charges c where c.profile_id = me),
    'answers', coalesce((select jsonb_agg(jsonb_build_object('question_id', a.question_id, 'option_id', a.option_id,
        'accepted_option_ids', a.accepted_option_ids, 'importance', a.importance) order by a.question_id)
        from public.answers a where a.user_id = me), '[]'),
    'consents', coalesce((select jsonb_agg(jsonb_build_object('type', c.type, 'text_version', c.text_version,
        'granted', c.granted, 'created_at', c.created_at) order by c.created_at)
        from public.consents c where c.user_id = me), '[]'),
    -- Never the Casier of the Bad nor whether the bet was right (règle 14): only my own choice.
    'requests_sent', coalesce((select jsonb_agg(jsonb_build_object('created_at', r.created_at, 'bad', b.pseudo,
        'status', r.status, 'close_reason', r.close_reason, 'my_bet', r.guessed_index, 'my_note', r.note)
        order by r.created_at) from public.visit_requests r join public.profiles b on b.id = r.bad_id
        where r.visitor_id = me), '[]'),
    'requests_received', coalesce((select jsonb_agg(jsonb_build_object('created_at', r.created_at, 'visitor', v.pseudo,
        'status', r.status, 'close_reason', r.close_reason) order by r.created_at)
        from public.visit_requests r join public.profiles v on v.id = r.visitor_id where r.bad_id = me), '[]'),
    'visits', coalesce((select jsonb_agg(jsonb_build_object('starts_at', x.starts_at, 'status', x.status,
        'with', o.pseudo, 'i_was_there', case when x.bad_id = me then x.bad_joined_at else x.visitor_joined_at end is not null)
        order by x.starts_at) from public.visits x
        join public.profiles o on o.id = case when x.bad_id = me then x.visitor_id else x.bad_id end
        where me in (x.bad_id, x.visitor_id)), '[]'),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', m.conversation_id,
        'created_at', m.created_at, 'text', m.body) order by m.id)
        from public.messages m where m.sender_id = me and m.kind = 'text' and m.removed_at is null), '[]'),
    'cavales_proposed', coalesce((select jsonb_agg(jsonb_build_object('created_at', d.created_at,
        'venue_type', d.venue_type, 'venue_name', d.venue_name, 'starts_at', d.starts_at, 'status', d.status)
        order by d.created_at) from public.date_proposals d where d.proposer_id = me), '[]'),
    'reports_made', coalesce((select jsonb_agg(jsonb_build_object('created_at', r.created_at, 'category', r.category,
        'target_type', r.target_type, 'comment', r.comment, 'status', r.status, 'decision_reason', r.decision_reason)
        order by r.created_at) from public.reports r where r.reporter_id = me), '[]'),
    'decisions_about_me', coalesce((select jsonb_agg(jsonb_build_object('created_at', m.created_at, 'action', m.action,
        'reason', m.reason, 'ends_at', m.ends_at) order by m.created_at)
        from public.moderation_actions m where m.target_user_id = me
          and m.action in ('warn', 'suspend', 'ban', 'unban', 'hide_profile', 'unhide_profile',
                           'revoke_good_conduct', 'text_remove')), '[]'),
    'blocks', coalesce((select jsonb_agg(jsonb_build_object('pseudo', o.pseudo, 'created_at', k.created_at,
        'unblocked_at', k.unblocked_at) order by k.created_at)
        from public.blocks k join public.profiles o on o.id = k.blocked_id where k.blocker_id = me), '[]'),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('type', n.type, 'created_at', n.created_at,
        'read_at', n.read_at) order by n.created_at) from public.notifications n where n.user_id = me), '[]'),
    'notification_preferences', (select to_jsonb(np) - 'user_id' - 'unsubscribe_token'
        from public.notification_preferences np where np.user_id = me),
    -- Devices without their keys or address.
    'push_devices', coalesce((select jsonb_agg(jsonb_build_object('created_at', s.created_at, 'locale', s.locale,
        'last_success_at', s.last_success_at, 'revoked_at', s.revoked_at) order by s.created_at)
        from public.push_subscriptions s where s.user_id = me), '[]'),
    'activity_days', coalesce((select jsonb_agg(a.day order by a.day) from public.activity_days a where a.user_id = me), '[]'));
end;
$$;

------------------------------------------------------------------------------------------------
-- 4. Deletion of my account: what the database does before the server deletes the Auth account
------------------------------------------------------------------------------------------------
-- My open cases are closed (the other is told neutrally, my scheduled visits are cancelled); my
-- messages are erased (« Message supprimé »); what the Parloir copied of my texts (my note, my
-- Casier in the bet) is erased too. Returns my files, which the server removes before deleting
-- the Auth account (the rows then follow by cascade).
create function public.prepare_my_account_deletion()
returns table (pending_paths text[], public_paths text[])
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform private.close_cases_of(me, 'account_deleted');
  update public.messages set body = '', removed_at = now(), system_payload = jsonb_build_object('type', 'removed')
  where sender_id = me and kind = 'text';
  delete from public.messages m
  using public.conversations c
  where m.conversation_id = c.id and m.kind = 'system'
    and ((m.system_payload ->> 'type' = 'note' and c.visitor_id = me)
      or (m.system_payload ->> 'type' = 'bet' and c.bad_id = me));
  return query
    select
      coalesce((select array_agg(ph.pending_path) from public.photos ph where ph.owner_id = me and ph.pending_path is not null), '{}'),
      coalesce((select array_agg(x.path) from public.photos ph
                cross join lateral (values (ph.public_path_large), (ph.public_path_small)) x(path)
                where ph.owner_id = me and x.path is not null), '{}');
end;
$$;

revoke execute on function public.export_my_data(), public.prepare_my_account_deletion() from public, anon;
grant execute on function public.export_my_data(), public.prepare_my_account_deletion() to authenticated;
$mig$]
where version = '20261020120000';

commit;

select version, name, md5(array_to_string(statements, ';')) as md5_statements
from supabase_migrations.schema_migrations
where version in ('20261019130100', '20261020110000', '20261020110100', '20261020120000')
order by version;
