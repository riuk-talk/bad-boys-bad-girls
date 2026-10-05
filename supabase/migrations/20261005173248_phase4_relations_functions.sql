-- Phase 4a, part 2: the functions members call, the jobs and their grants (part 1: types, tables,
-- RLS and internal helpers). Rule 14: none of these returns true_index, the chosen charge, the
-- Casier copy or the result of the bet before the visit.

------------------------------------------------------------------------------------------------
-- 1. La Fiche d'un Bad (SPEC §5, PARCOURS-DESIGN §2). Never the true line (true_index).
------------------------------------------------------------------------------------------------
create function public.get_fiche(p_bad uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  v public.profiles;
  b public.profiles;
  c public.casier_charges;
  open_request public.visit_requests;
  score smallint;
begin
  select * into b from public.profiles where id = p_bad and role = 'bad';
  if not found or me is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if me <> p_bad then
    if public.is_blocked_between(me, p_bad)
       or not (public.can_view_bad(me, p_bad) or public.has_open_relation(me, p_bad)) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    select * into v from public.profiles where id = me;
  end if;
  select * into c from public.casier_charges where profile_id = p_bad;
  select * into open_request from public.visit_requests r
    where r.visitor_id = me and r.bad_id = p_bad and r.status in ('pending', 'accepted', 'released')
    order by r.created_at desc limit 1;
  if me <> p_bad then
    select x.score into score from public.complicity_score(me, p_bad) x;
  end if;
  return jsonb_build_object(
    'id', b.id,
    'ecrou', b.ecrou,
    'pseudo', b.pseudo,
    'gender', b.gender,
    'age', public.age_years(b.birthdate),
    'city', public.place_name(b.place_id),
    'distance_km', case when me <> p_bad then public.distance_km(v, b) end,
    'seeking_genders', to_jsonb(b.seeking_genders),
    'seek_age_min', b.seek_age_min,
    'seek_age_max', b.seek_age_max,
    'on_file_since', to_char(b.created_at, 'YYYY-MM'),
    'photos', public.public_photos(b.id, array[0, 1, 2, 3, 4, 5]::smallint[]),
    'tribes', public.public_tribes(b.id),
    'charges', case when c.profile_id is null then '[]'::jsonb
                    else jsonb_build_array(c.charge_1, c.charge_2, c.charge_3) end,
    'casier_changed_since_request', open_request.id is not null and b.casier_updated_at > open_request.created_at,
    'bio', b.bio,
    'good_conduct', b.is_reglo,
    'requests_open', b.requests_open and not b.is_paused,
    'complicity', score,
    'common_points', case when me <> p_bad then
        (select coalesce(jsonb_agg(jsonb_build_object('question', cp.question, 'answer', cp.answer)), '[]')
         from public.common_points(me, p_bad, 3) cp) else '[]'::jsonb end,
    'my_request_status', open_request.status,
    'cooldown_until', case when me <> p_bad then public.pair_cooldown_until(me, p_bad) end
  );
end;
$$;

------------------------------------------------------------------------------------------------
-- 2. Le Permis de visite seen by a Bad (SPEC §5 bis): the Visitor themself, or a Bad who received
--    a request from them. One photo, the Motif, the reputation, never anything about the bet.
------------------------------------------------------------------------------------------------
create function public.get_permit(p_visitor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  viewer public.profiles;
  v public.profiles;
  rep record;
  score smallint;
begin
  select * into v from public.profiles where id = p_visitor and role = 'visitor';
  if not found or me is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if me <> p_visitor then
    if public.is_blocked_between(me, p_visitor)
       or not exists (select 1 from public.visit_requests r where r.visitor_id = p_visitor and r.bad_id = me) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    select * into viewer from public.profiles where id = me;
    select x.score into score from public.complicity_score(me, p_visitor) x;
  end if;
  select * into rep from public.visitor_reputation(p_visitor);
  return jsonb_build_object(
    'id', v.id,
    'pseudo', v.pseudo,
    'gender', v.gender,
    'age', public.age_years(v.birthdate),
    'city', public.place_name(v.place_id),
    'distance_km', case when me <> p_visitor then public.distance_km(viewer, v) end,
    'photo', (public.public_photos(v.id, array[0]::smallint[]) -> 0),
    'motive', v.visit_motive,
    'tribes', public.public_tribes(v.id),
    'clean_record', rep.clean_record,
    'visits_honored', rep.honored,
    'visits_due', rep.due,
    'complicity', score,
    'common_points', case when me <> p_visitor then
        (select coalesce(jsonb_agg(jsonb_build_object('question', cp.question, 'answer', cp.answer)), '[]')
         from public.common_points(me, p_visitor, 3) cp) else '[]'::jsonb end
  );
end;
$$;

------------------------------------------------------------------------------------------------
-- 3. La Découverte (SPEC §12 bis): Visitors only, one query, cursor (sort_key, id).
------------------------------------------------------------------------------------------------
create function public.discover_bads(
  p_age_min integer default 18, p_age_max integer default 99, p_max_km integer default null,
  p_tribe_ids smallint[] default null, p_good_conduct_only boolean default false,
  p_recently_active boolean default false, p_cursor_key bigint default null, p_cursor_id uuid default null,
  p_limit integer default 24)
returns table (id uuid, pseudo text, gender public.gender, age integer, city text, distance_km integer,
  photo_small text, good_conduct boolean, requests_open boolean, complicity smallint, sort_key bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v public.profiles;
begin
  select * into v from public.profiles p where p.id = (select auth.uid());
  if not found or v.role is distinct from 'visitor' or not public.is_member_active(v) then
    raise exception 'visitors_only' using errcode = '42501';
  end if;
  if not public.zone_is_open(v.zone_id) then return; end if;
  return query
  with candidates as (
    select b.id, b.pseudo, b.gender, b.birthdate, b.place_id, b.is_reglo, b.requests_open, b.last_seen_at,
      public.distance_km(v, b) as dist
    from public.profiles b
    where b.role = 'bad' and b.id <> v.id
      and public.is_bad_visible(b) and public.criteria_match(v, b)
      and not public.is_blocked_between(v.id, b.id)
      and public.age_years(b.birthdate) between greatest(p_age_min, 18) and least(p_age_max, 99)
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
  )
  select sc.id, sc.pseudo::text, sc.gender, public.age_years(sc.birthdate), public.place_name(sc.place_id),
    sc.dist,
    (select ph.public_path_small from public.photos ph where ph.owner_id = sc.id and ph.position = 0 and ph.status = 'approved'),
    sc.is_reglo, sc.requests_open, sc.score, sc.key
  from scored sc
  where p_cursor_key is null or (sc.key, sc.id) < (p_cursor_key, p_cursor_id)
  order by sc.key desc, sc.id desc
  limit greatest(least(p_limit, 48), 1);
end;
$$;

------------------------------------------------------------------------------------------------
-- 4. La Promenade (SPEC §12): built in advance, shown from 21:00 local time.
------------------------------------------------------------------------------------------------
-- Builds one zone's Promenade for one local date: 5 Bads per Visitor, the attention shared out
-- (score × 0.5 above half the cap, at most N appearances per Bad and per day), in set-based rounds.
create function public.build_daily_promenade(p_zone smallint, p_date date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  tz text;
  vis_from timestamptz;
  max_per_bad integer := (select promenade_max_appearances_per_day from public.app_settings);
  round_no integer := 0;
  inserted integer := 0;
begin
  select timezone into tz from public.launch_zones where id = p_zone;
  if tz is null then return 0; end if;
  vis_from := (p_date + time '21:00') at time zone tz;

  -- One temporary table per transaction (the job may build several zones in a row): rows are
  -- tagged with their zone instead of being removed.
  create temporary table if not exists promenade_pairs (
    zone smallint, visitor_id uuid, bad_id uuid, score integer, taken boolean
  ) on commit drop;
  insert into promenade_pairs (zone, visitor_id, bad_id, score, taken)
  with visitors as (
    select v.* from public.profiles v
    where v.zone_id = p_zone and v.role = 'visitor' and public.is_member_active(v) and not v.is_seed
  ),
  bads as (
    select b.* from public.profiles b
    where public.is_bad_visible(b) and b.requests_open and not b.is_seed
  ),
  pairs as (
    select v.id visitor_id, b.id bad_id, b.pending_requests_count, b.requests_cap, b.last_seen_at
    from visitors v join bads b on public.criteria_match(v, b) and (b.zone_id = p_zone or
      exists (select 1 from public.app_settings s where s.launch_mode = 'open'))
    where not public.is_blocked_between(v.id, b.id)
      and not exists (select 1 from public.visit_requests r where r.visitor_id = v.id and r.bad_id = b.id)
      and not exists (select 1 from public.promenade_picks pp where pp.visitor_id = v.id and pp.bad_id = b.id
                      and pp.promenade_date > p_date - 14)
  ),
  sums as (
    select p.visitor_id, p.bad_id,
      public.complicity_from_sums(
        sum(public.importance_weight(va.importance)) filter (where va.accepted_option_ids is null or ba.option_id = any (va.accepted_option_ids)),
        sum(public.importance_weight(va.importance)),
        sum(public.importance_weight(ba.importance)) filter (where ba.accepted_option_ids is null or va.option_id = any (ba.accepted_option_ids)),
        sum(public.importance_weight(ba.importance)),
        count(*)::integer,
        coalesce(bool_or(
          (va.importance = 'essential' and not (va.accepted_option_ids is null or ba.option_id = any (va.accepted_option_ids)))
          or (ba.importance = 'essential' and not (ba.accepted_option_ids is null or va.option_id = any (ba.accepted_option_ids)))), false)) score
    from pairs p
    join public.answers va on va.user_id = p.visitor_id
    join public.answers ba on ba.user_id = p.bad_id and ba.question_id = va.question_id
    join public.questions qu on qu.id = va.question_id and qu.is_active
    group by p.visitor_id, p.bad_id
  )
  select p_zone, p.visitor_id, p.bad_id,
    -- score = complicity (0 if unknown) + activity bonus (0–20), × 0.5 above half of the cap.
    ((coalesce(s.score, 0) + greatest(0, 20 - (extract(epoch from now() - p.last_seen_at) / 86400)::integer))
      * (case when p.pending_requests_count * 2 > p.requests_cap then 0.5 else 1 end))::integer as score,
    false as taken
  from pairs p left join sums s on s.visitor_id = p.visitor_id and s.bad_id = p.bad_id;

  -- Rounds: each Visitor proposes their best free candidate; each Bad keeps at most its remaining
  -- capacity (best scores first); the others try again with their next candidate.
  loop
    round_no := round_no + 1;
    with proposals as (
      select distinct on (pp.visitor_id) pp.visitor_id, pp.bad_id, pp.score
      from promenade_pairs pp
      where pp.zone = p_zone and not pp.taken
        and (select count(*) from public.promenade_picks x where x.visitor_id = pp.visitor_id and x.promenade_date = p_date) < 5
      order by pp.visitor_id, pp.score desc, pp.bad_id
    ),
    ranked as (
      select pr.*, row_number() over (partition by pr.bad_id order by pr.score desc, pr.visitor_id) as nth,
        (select count(*) from public.promenade_picks x where x.bad_id = pr.bad_id and x.promenade_date = p_date) as used
      from proposals pr
    ),
    kept as (
      insert into public.promenade_picks (visitor_id, bad_id, zone_id, promenade_date, rank, score, visible_from, visible_until)
      select r.visitor_id, r.bad_id, p_zone, p_date,
        (select count(*) from public.promenade_picks x where x.visitor_id = r.visitor_id and x.promenade_date = p_date) + 1,
        least(r.score, 32767), vis_from, vis_from + interval '1 day'
      from ranked r where r.used + r.nth <= max_per_bad
      returning visitor_id, bad_id
    )
    update promenade_pairs pp set taken = true
    from proposals pr
    where pp.zone = p_zone and pp.visitor_id = pr.visitor_id and pp.bad_id = pr.bad_id;
    -- Bads that are full are no longer proposed.
    update promenade_pairs pp set taken = true
    where pp.zone = p_zone and not pp.taken and (select count(*) from public.promenade_picks x
                            where x.bad_id = pp.bad_id and x.promenade_date = p_date) >= max_per_bad;
    exit when not exists (
      select 1 from promenade_pairs pp where pp.zone = p_zone and not pp.taken
        and (select count(*) from public.promenade_picks x where x.visitor_id = pp.visitor_id and x.promenade_date = p_date) < 5)
      or round_no >= 60;
  end loop;
  select count(*) into inserted from public.promenade_picks where zone_id = p_zone and promenade_date = p_date;
  return inserted;
end;
$$;

-- Hourly job (pg_cron): builds tomorrow evening's Promenade in the hour before 21:00 local time,
-- once per zone and date, then notifies the Visitors in-app when it opens.
create function public.run_promenades_due()
returns void language plpgsql security definer set search_path = '' as $$
declare z record; local_now timestamp;
begin
  for z in select lz.id, lz.timezone from public.launch_zones lz
           where lz.status = 'open' or exists (select 1 from public.app_settings s where s.launch_mode = 'open')
  loop
    local_now := now() at time zone z.timezone;
    if local_now::time >= time '20:00' and local_now::time < time '21:00'
       and not exists (select 1 from public.promenade_picks pp where pp.zone_id = z.id and pp.promenade_date = local_now::date) then
      perform public.build_daily_promenade(z.id, local_now::date);
    end if;
    if local_now::time >= time '21:00' and local_now::time < time '22:00' then
      insert into public.notifications (user_id, type, payload)
      select distinct pp.visitor_id, 'promenade_open'::public.notification_type, jsonb_build_object('date', pp.promenade_date)
      from public.promenade_picks pp
      where pp.zone_id = z.id and pp.promenade_date = local_now::date
        and not exists (select 1 from public.notifications n where n.user_id = pp.visitor_id
                        and n.type = 'promenade_open' and n.payload ->> 'date' = pp.promenade_date::text);
    end if;
  end loop;
end;
$$;

create function public.get_my_promenade()
returns table (rank smallint, id uuid, pseudo text, gender public.gender, age integer, city text,
  distance_km integer, photo_small text, good_conduct boolean, requests_open boolean, complicity smallint,
  seen boolean, visible_until timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v public.profiles;
begin
  select * into v from public.profiles p where p.id = (select auth.uid());
  if not found or v.role is distinct from 'visitor' then raise exception 'visitors_only' using errcode = '42501'; end if;
  return query
  select pp.rank, b.id, b.pseudo::text, b.gender, public.age_years(b.birthdate), public.place_name(b.place_id),
    public.distance_km(v, b),
    (select ph.public_path_small from public.photos ph where ph.owner_id = b.id and ph.position = 0 and ph.status = 'approved'),
    b.is_reglo, b.requests_open, (select x.score from public.complicity_score(v.id, b.id) x),
    pp.seen_at is not null, pp.visible_until
  from public.promenade_picks pp
  join public.profiles b on b.id = pp.bad_id
  where pp.visitor_id = v.id and pp.visible_from <= now() and now() < pp.visible_until
    and public.is_bad_visible(b) and not public.is_blocked_between(v.id, b.id)
  order by pp.rank;
end;
$$;

create function public.mark_promenade_seen(p_bad uuid)
returns void language sql security definer set search_path = '' as $$
  update public.promenade_picks set seen_at = coalesce(seen_at, now())
  where visitor_id = (select auth.uid()) and bad_id = p_bad and visible_from <= now() and now() < visible_until
$$;

------------------------------------------------------------------------------------------------
-- 5. Sending a Demande de parloir (SCHEMA §3.3): every limit in SQL, one transaction.
------------------------------------------------------------------------------------------------
-- Stop words removed before comparing notes (anti-scam, SPEC §7).
create function public.note_fingerprint(p_note text)
returns text language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(' ' || public.normalize_text(public.mask_contacts(p_note)) || ' ',
    ' (le|la|les|un|une|des|de|du|et|a|au|aux|en|je|tu|il|elle|on|ma|ta|mon|ton|ce|ca|que|qui|the|a|an|and|of|to|i|you|my|your|is|it) ',
    ' ', 'g'))
$$;

create function public.send_visit_request(p_bad uuid, p_guessed_index smallint, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  v public.profiles;
  b public.profiles;
  c public.casier_charges;
  note text := nullif(btrim(coalesce(p_note, '')), '');
  fingerprint text;
  request_id uuid;
  similar_count integer;
begin
  -- 1. Sender: an active Visitor with a delivered Permis, in an open zone.
  select * into v from public.profiles where id = me;
  if not found or v.role is distinct from 'visitor' then raise exception 'visitors_only' using errcode = '42501'; end if;
  if not public.has_permit(me) then raise exception 'permit_pending' using errcode = '42501'; end if;
  if not public.zone_is_open(v.zone_id) then raise exception 'zone_closed' using errcode = '42501'; end if;
  if p_guessed_index is null or p_guessed_index not between 1 and 3 then
    raise exception 'invalid_guess' using errcode = '22023';
  end if;
  if note is not null and char_length(note) > 280 then raise exception 'note_too_long' using errcode = '22001'; end if;
  -- 2. Recipient: a visible Bad, criteria in both directions, no block (row locked: cap and count).
  select * into b from public.profiles where id = p_bad for update;
  if not found or not public.can_view_bad(me, p_bad) then raise exception 'not_found' using errcode = 'P0002'; end if;
  -- 3. 30 days after a closed case; one request in progress per pair.
  if public.pair_cooldown_until(me, p_bad) > now() then raise exception 'cooldown' using errcode = '23514'; end if;
  if exists (select 1 from public.visit_requests r where r.visitor_id = me and r.bad_id = p_bad
             and r.status in ('pending', 'accepted', 'released')) then
    raise exception 'already_requested' using errcode = '23505';
  end if;
  -- 4. 5 requests per 24 h (2 while the account is younger than 24 h).
  if (select count(*) from public.visit_requests r where r.visitor_id = me and r.created_at > now() - interval '24 hours')
     >= (case when v.created_at > now() - interval '24 hours' then 2 else 5 end) then
    raise exception 'daily_limit' using errcode = '23514';
  end if;
  -- 5. « Parloir complet ».
  if not b.requests_open or b.is_paused then raise exception 'parloir_full' using errcode = '23514'; end if;
  -- 6. Insert with a copy of the Casier and the result of the bet (never returned before the visit).
  select * into c from public.casier_charges where profile_id = p_bad;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if note is not null then note := left(public.mask_contacts(note), 280); end if;
  fingerprint := case when note is null then null else public.note_fingerprint(note) end;
  insert into public.visit_requests (visitor_id, bad_id, guessed_index, casier_snapshot, guess_correct, note, note_normalized)
  values (me, p_bad, p_guessed_index,
    jsonb_build_object('charges', jsonb_build_array(c.charge_1, c.charge_2, c.charge_3), 'true_index', c.true_index),
    p_guessed_index = c.true_index, note, fingerprint)
  returning id into request_id;
  if note is not null then
    perform public.flag_keywords(me, 'visit_request', request_id::text, note);
    -- 7. Anti-scam: the same note (trigram similarity ≥ 0.9) for the 3rd time within 7 days.
    if char_length(fingerprint) > 0 then
      select count(*) into similar_count from public.visit_requests r
      where r.visitor_id = me and r.id <> request_id and r.created_at > now() - interval '7 days'
        and r.note_normalized is not null and extensions.similarity(r.note_normalized, fingerprint) >= 0.9;
      if similar_count >= 2 then
        insert into public.flagged_texts (user_id, source, source_id, excerpt, matched_terms)
        values (me, 'visit_request', request_id::text, note, array['repeated_note']);
      end if;
    end if;
  end if;
  -- 8. The Bad is told (in-app; Web Push in Phase 5a).
  perform public.notify(p_bad, 'request_received', jsonb_build_object('request_id', request_id));
  return request_id;
end;
$$;

------------------------------------------------------------------------------------------------
-- 6. Le Courrier (Bad) and Mes demandes de parloir (Visitor): never the bet (rule 14).
------------------------------------------------------------------------------------------------
create function public.get_mailbox()
returns table (request_id uuid, status public.visit_request_status, created_at timestamptz,
  visitor_id uuid, pseudo text, gender public.gender, age integer, city text, distance_km integer,
  photo_small text, motive text, clean_record boolean, visits_honored integer, visits_due integer,
  complicity smallint, note text)
language plpgsql stable security definer set search_path = '' as $$
declare b public.profiles;
begin
  select * into b from public.profiles p where p.id = (select auth.uid());
  if not found or b.role is distinct from 'bad' then raise exception 'bads_only' using errcode = '42501'; end if;
  return query
  select r.id, r.status, r.created_at, v.id, v.pseudo::text, v.gender, public.age_years(v.birthdate),
    public.place_name(v.place_id), public.distance_km(b, v),
    (select ph.public_path_small from public.photos ph where ph.owner_id = v.id and ph.position = 0 and ph.status = 'approved'),
    v.visit_motive, rep.clean_record, rep.honored, rep.due,
    (select x.score from public.complicity_score(b.id, v.id) x), r.note
  from public.visit_requests r
  join public.profiles v on v.id = r.visitor_id
  cross join lateral public.visitor_reputation(v.id) rep
  where r.bad_id = b.id and r.status in ('pending', 'accepted')
    and not public.is_blocked_between(b.id, v.id)
  order by r.status, r.created_at;
end;
$$;

create function public.decide_visit_request(p_request uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.visit_requests;
begin
  select * into r from public.visit_requests where id = p_request for update;
  if not found or r.bad_id <> (select auth.uid()) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'not_pending' using errcode = '23514'; end if;
  if p_accept then
    -- Phase 4: accepted without slots; the Heures de visite are proposed in Phase 5b.
    update public.visit_requests set status = 'accepted', decided_at = now() where id = r.id;
    perform public.notify(r.visitor_id, 'request_accepted', jsonb_build_object('request_id', r.id));
  else
    update public.visit_requests
    set status = 'dismissed', close_reason = 'dismissed_by_bad', decided_at = now(), closed_at = now()
    where id = r.id;
    perform public.notify(r.visitor_id, 'request_dismissed', jsonb_build_object('request_id', r.id));
  end if;
end;
$$;

create function public.get_my_requests()
returns table (request_id uuid, status public.visit_request_status, created_at timestamptz,
  decided_at timestamptz, bad_id uuid, pseudo text, gender public.gender, photo_small text,
  cooldown_until timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v public.profiles;
begin
  select * into v from public.profiles p where p.id = (select auth.uid());
  if not found or v.role is distinct from 'visitor' then raise exception 'visitors_only' using errcode = '42501'; end if;
  return query
  select r.id, r.status, r.created_at, r.decided_at, b.id, b.pseudo::text, b.gender,
    (select ph.public_path_small from public.photos ph where ph.owner_id = b.id and ph.position = 0 and ph.status = 'approved'),
    case when r.status in ('dismissed', 'auto_dismissed', 'closed') then r.closed_at + interval '30 days' end
  from public.visit_requests r
  join public.profiles b on b.id = r.bad_id
  where r.visitor_id = v.id and not public.is_blocked_between(v.id, b.id)
  order by r.created_at desc
  limit 100;
end;
$$;

-- Hourly job: pending for 7 days → closed automatically with the neutral message.
create function public.expire_visit_requests()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  with expired as (
    update public.visit_requests
    set status = 'auto_dismissed', close_reason = 'no_answer_7d', closed_at = now()
    where status = 'pending' and created_at < now() - interval '7 days'
    returning id, visitor_id
  )
  insert into public.notifications (user_id, type, payload)
  select visitor_id, 'request_dismissed', jsonb_build_object('request_id', id) from expired;
  get diagnostics n = row_count;
  return n;
end;
$$;

------------------------------------------------------------------------------------------------
-- 7. Role change (SPEC §2 bis): once per 7 days, with its effects.
------------------------------------------------------------------------------------------------
create function public.change_role(p_role public.member_role)
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = (select auth.uid()) for update;
  if not found or me.onboarding_completed_at is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if me.role = p_role then return; end if;
  if me.role_changed_at > now() - interval '7 days' then raise exception 'role_change_too_soon' using errcode = '23514'; end if;
  if p_role = 'visitor' then
    if me.visit_motive is null then raise exception 'visit_motive_required' using errcode = '23514'; end if;
    -- Requests received: closed with the neutral message.
    with closed as (
      update public.visit_requests set status = 'dismissed', close_reason = 'role_change', decided_at = now(), closed_at = now()
      where bad_id = me.id and status in ('pending', 'accepted') returning id, visitor_id
    )
    insert into public.notifications (user_id, type, payload)
    select visitor_id, 'request_dismissed', jsonb_build_object('request_id', id) from closed;
  else
    -- Requests sent: cancelled (the Fiche stays hidden until the 3 poses and the Casier exist).
    update public.visit_requests set status = 'cancelled', close_reason = 'role_change', closed_at = now()
    where visitor_id = me.id and status in ('pending', 'accepted');
  end if;
  update public.profiles set role = p_role, role_changed_at = now() where id = me.id;
end;
$$;

------------------------------------------------------------------------------------------------
-- 8. Block, unblock, report (SPEC §10, simple words on the buttons)
------------------------------------------------------------------------------------------------
create function public.block_user(p_target uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null or p_target is null or me = p_target then raise exception 'invalid_target' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = p_target) then raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (me, p_target)
  on conflict (blocker_id, blocked_id) do update set created_at = now(), unblocked_at = null;
  update public.visit_requests set status = 'cancelled', close_reason = 'blocked', closed_at = now()
  where status in ('pending', 'accepted')
    and ((visitor_id = me and bad_id = p_target) or (visitor_id = p_target and bad_id = me));
end;
$$;

create function public.unblock_user(p_target uuid)
returns void language sql security definer set search_path = '' as $$
  update public.blocks set unblocked_at = now()
  where blocker_id = (select auth.uid()) and blocked_id = p_target and unblocked_at is null
$$;

create function public.report(p_target_type public.report_target, p_target_id text,
  p_category public.report_category, p_comment text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  target_user uuid;
  report_id bigint;
begin
  if me is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if (select count(*) from public.reports where reporter_id = me and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'report_limit' using errcode = '23514';
  end if;
  target_user := case p_target_type
    when 'profile' then (select id from public.profiles where id::text = p_target_id)
    when 'permit' then (select id from public.profiles where id::text = p_target_id)
    when 'casier' then (select profile_id from public.casier_charges where profile_id::text = p_target_id)
    when 'photo' then (select owner_id from public.photos where id::text = p_target_id)
    when 'visit_request' then (select case when r.visitor_id = me then r.bad_id else r.visitor_id end
                               from public.visit_requests r where r.id::text = p_target_id
                                 and me in (r.visitor_id, r.bad_id))
    else null end;
  if target_user is null or target_user = me then raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into public.reports (reporter_id, target_user_id, target_type, target_id, category, comment)
  values (me, target_user, p_target_type, p_target_id, p_category, left(nullif(btrim(p_comment), ''), 500))
  returning id into report_id;
  -- « Mineur »: hidden at once after 2 distinct reporters, or 1 Bad with Bonne conduite (SCHEMA).
  if p_category = 'minor' and (
       (select count(distinct reporter_id) from public.reports
        where target_user_id = target_user and category = 'minor' and status = 'open') >= 2
       or exists (select 1 from public.profiles where id = me and role = 'bad' and is_reglo)) then
    update public.profiles set hidden_reason = 'minor_report' where id = target_user and hidden_reason is null;
  end if;
  return report_id;
end;
$$;

------------------------------------------------------------------------------------------------
-- 9. Grants: only the member-callable functions, to signed-in members
------------------------------------------------------------------------------------------------
revoke execute on function
  public.build_daily_promenade(smallint, date),
  public.run_promenades_due(),
  public.note_fingerprint(text),
  public.expire_visit_requests(),
  public.get_fiche(uuid),
  public.get_permit(uuid),
  public.discover_bads(integer, integer, integer, smallint[], boolean, boolean, bigint, uuid, integer),
  public.get_my_promenade(),
  public.mark_promenade_seen(uuid),
  public.send_visit_request(uuid, smallint, text),
  public.get_mailbox(),
  public.decide_visit_request(uuid, boolean),
  public.get_my_requests(),
  public.change_role(public.member_role),
  public.block_user(uuid),
  public.unblock_user(uuid),
  public.report(public.report_target, text, public.report_category, text)
  from public, anon, authenticated;

grant execute on function public.get_fiche(uuid), public.get_permit(uuid),
  public.discover_bads(integer, integer, integer, smallint[], boolean, boolean, bigint, uuid, integer),
  public.get_my_promenade(), public.mark_promenade_seen(uuid), public.send_visit_request(uuid, smallint, text),
  public.get_mailbox(), public.decide_visit_request(uuid, boolean), public.get_my_requests(),
  public.change_role(public.member_role), public.block_user(uuid), public.unblock_user(uuid),
  public.report(public.report_target, text, public.report_category, text)
  to authenticated;

------------------------------------------------------------------------------------------------
-- 10. Scheduled jobs (pg_cron, SCHEMA §3.5)
------------------------------------------------------------------------------------------------
select cron.schedule('promenades-due', '5 * * * *', 'select public.run_promenades_due()');
select cron.schedule('expire-visit-requests', '17 * * * *', 'select public.expire_visit_requests()');
