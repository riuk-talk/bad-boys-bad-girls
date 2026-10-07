-- Phase 5b: les Heures de visite (SPEC §7 bis, SCHEMA visit_slots / visits).
-- The Bad accepts by proposing 2 or 3 half-hour slots (accept_visit_request); the Visitor chooses
-- one within 48 h (choose_slot) or says « Aucun ne me va » once (decline_slots), after which the
-- Bad has 48 h to propose again (propose_slots). Either can cancel a scheduled visit
-- (cancel_visit; less than 2 h before = late). A job every minute closes what is past its
-- deadline and sends the reminders (1 h before, at the start). Every rule lives here.
-- No DROP: decide_visit_request keeps its signature and now only classes a case.

create extension if not exists btree_gist with schema extensions;

------------------------------------------------------------------------------------------------
-- 1. Types and tables
------------------------------------------------------------------------------------------------
create type public.slot_status as enum ('offered', 'chosen', 'declined', 'expired');
create type public.visit_status as enum ('scheduled', 'in_progress', 'ended', 'cancelled', 'no_show');

create table public.visit_slots (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.visit_requests (id) on delete cascade,
  round smallint not null check (round >= 1),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.slot_status not null default 'offered',
  created_at timestamptz not null default now(),
  check (ends_at = starts_at + interval '30 minutes')
);
create index visit_slots_request on public.visit_slots (request_id, round);

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.visit_requests (id) on delete cascade,
  slot_id uuid not null references public.visit_slots (id) on delete cascade,
  bad_id uuid not null references public.profiles (id) on delete cascade,
  visitor_id uuid not null references public.profiles (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.visit_status not null default 'scheduled',
  cancelled_by uuid,
  cancelled_at timestamptz,
  -- Cancelled less than 2 h before the start: counts as an absence of cancelled_by (SPEC §7 bis).
  cancelled_late boolean not null default false,
  reminder_sent_at timestamptz,
  start_notified_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at = starts_at + interval '30 minutes'),
  check (bad_id <> visitor_id),
  -- Never two visits at the same time, for a Bad or for a Visitor.
  constraint visits_bad_no_overlap exclude using gist
    (bad_id extensions.gist_uuid_ops with =, tstzrange(starts_at, ends_at) with &&)
    where (status in ('scheduled', 'in_progress')),
  constraint visits_visitor_no_overlap exclude using gist
    (visitor_id extensions.gist_uuid_ops with =, tstzrange(starts_at, ends_at) with &&)
    where (status in ('scheduled', 'in_progress'))
);
-- One scheduled visit at a time per couple (SPEC §7 bis, 6).
create unique index visits_one_per_request on public.visits (request_id)
  where status in ('scheduled', 'in_progress');
create index visits_due on public.visits (status, starts_at) where status in ('scheduled', 'in_progress');
create index visits_bad on public.visits (bad_id, starts_at);
create index visits_visitor on public.visits (visitor_id, starts_at);
create index visits_slot on public.visits (slot_id);

create index visit_requests_choose_deadline on public.visit_requests (choose_deadline)
  where status = 'accepted' and choose_deadline is not null;
create index visit_requests_repropose_deadline on public.visit_requests (repropose_deadline)
  where status = 'accepted' and repropose_deadline is not null;

-- Read through functions only (no direct right for members).
alter table public.visit_slots enable row level security;
alter table public.visits enable row level security;
revoke all on public.visit_slots, public.visits from public, anon, authenticated;

------------------------------------------------------------------------------------------------
-- 2. Rules for a proposal (internal)
------------------------------------------------------------------------------------------------
-- 2 or 3 slots, on the hour or the half hour, at least 2 h ahead and within 7 days, all different,
-- none overlapping a visit the Bad already has (SPEC §7 bis, 1). Returns them sorted.
create function public.checked_slots(p_bad uuid, p_slots timestamptz[])
returns timestamptz[] language plpgsql stable security definer set search_path = '' as $$
declare s timestamptz; sorted timestamptz[];
begin
  if p_slots is null or cardinality(p_slots) not between 2 and 3 then
    raise exception 'slots_count' using errcode = '22023';
  end if;
  select array_agg(x order by x) into sorted from unnest(p_slots) x;
  if (select count(distinct x) from unnest(sorted) x) <> cardinality(sorted) then
    raise exception 'slot_duplicate' using errcode = '22023';
  end if;
  foreach s in array sorted loop
    if s is null or extract(second from s) <> 0 or extract(minute from s) not in (0, 30) then
      raise exception 'slot_invalid' using errcode = '22023';
    end if;
    if s < now() + interval '2 hours' then raise exception 'slot_too_soon' using errcode = '22023'; end if;
    if s > now() + interval '7 days' then raise exception 'slot_too_far' using errcode = '22023'; end if;
    if exists (select 1 from public.visits v
               where v.bad_id = p_bad and v.status in ('scheduled', 'in_progress')
                 and tstzrange(v.starts_at, v.ends_at) && tstzrange(s, s + interval '30 minutes')) then
      raise exception 'slot_busy' using errcode = '23514';
    end if;
  end loop;
  return sorted;
end;
$$;

create function public.insert_slots(p_request uuid, p_round smallint, p_slots timestamptz[])
returns void language sql security definer set search_path = '' as $$
  insert into public.visit_slots (request_id, round, starts_at, ends_at)
  select p_request, p_round, s, s + interval '30 minutes' from unnest(p_slots) s
$$;

------------------------------------------------------------------------------------------------
-- 3. The Bad: accept with slots, class, propose again
------------------------------------------------------------------------------------------------
-- Accepting means proposing the Heures de visite (SCHEMA: accept requires 2 or 3 valid slots).
-- A request accepted in Phase 4 without slots gets its first slots the same way.
create function public.accept_visit_request(p_request uuid, p_slots timestamptz[])
returns void language plpgsql security definer set search_path = '' as $$
declare r public.visit_requests; slots timestamptz[];
begin
  select * into r from public.visit_requests where id = p_request for update;
  if not found or r.bad_id <> (select auth.uid()) or public.is_blocked_between(r.bad_id, r.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not (r.status = 'pending' or (r.status = 'accepted' and r.slots_round = 0)) then
    raise exception 'not_pending' using errcode = '23514';
  end if;
  slots := public.checked_slots(r.bad_id, p_slots);
  perform public.insert_slots(r.id, 1::smallint, slots);
  update public.visit_requests
  set status = 'accepted', decided_at = coalesce(decided_at, now()), slots_round = 1,
      choose_deadline = now() + interval '48 hours', repropose_deadline = null
  where id = r.id;
  perform public.notify(r.visitor_id, 'request_accepted', jsonb_build_object('request_id', r.id));
end;
$$;

-- Phase 4 signature kept (no DROP): now only « Affaire classée ». Accepting goes through
-- accept_visit_request, with the slots.
create or replace function public.decide_visit_request(p_request uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.visit_requests;
begin
  select * into r from public.visit_requests where id = p_request for update;
  if not found or r.bad_id <> (select auth.uid()) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'not_pending' using errcode = '23514'; end if;
  if p_accept then raise exception 'slots_required' using errcode = '22023'; end if;
  update public.visit_requests
  set status = 'dismissed', close_reason = 'dismissed_by_bad', decided_at = now(), closed_at = now()
  where id = r.id;
  perform public.notify(r.visitor_id, 'request_dismissed', jsonb_build_object('request_id', r.id));
end;
$$;

-- New slots: after « Aucun ne me va » or a cancelled visit (within 48 h), or for a request
-- accepted in Phase 4 without slots.
create function public.propose_slots(p_request uuid, p_slots timestamptz[])
returns void language plpgsql security definer set search_path = '' as $$
declare r public.visit_requests; slots timestamptz[];
begin
  select * into r from public.visit_requests where id = p_request for update;
  if not found or r.bad_id <> (select auth.uid()) or public.is_blocked_between(r.bad_id, r.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if r.status <> 'accepted' then raise exception 'not_accepted' using errcode = '23514'; end if;
  if r.slots_round = 0 then
    perform public.accept_visit_request(p_request, p_slots);
    return;
  end if;
  if r.repropose_deadline is null or r.repropose_deadline <= now()
     or exists (select 1 from public.visits v where v.request_id = r.id and v.status in ('scheduled', 'in_progress')) then
    raise exception 'not_expected' using errcode = '23514';
  end if;
  slots := public.checked_slots(r.bad_id, p_slots);
  update public.visit_slots set status = 'expired' where request_id = r.id and status = 'offered';
  perform public.insert_slots(r.id, (r.slots_round + 1)::smallint, slots);
  update public.visit_requests
  set slots_round = slots_round + 1, choose_deadline = now() + interval '48 hours', repropose_deadline = null
  where id = r.id;
  perform public.notify(r.visitor_id, 'slots_reproposed', jsonb_build_object('request_id', r.id));
end;
$$;

------------------------------------------------------------------------------------------------
-- 4. The Visitor: choose a slot, or « Aucun ne me va » (once)
------------------------------------------------------------------------------------------------
create function public.choose_slot(p_slot uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.visit_slots; r public.visit_requests; visit uuid;
begin
  select * into s from public.visit_slots where id = p_slot;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into r from public.visit_requests where id = s.request_id for update;
  if r.visitor_id <> (select auth.uid()) or public.is_blocked_between(r.bad_id, r.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if r.status <> 'accepted' or s.round <> r.slots_round or s.status <> 'offered'
     or r.choose_deadline is null or r.choose_deadline <= now() then
    raise exception 'not_open' using errcode = '23514';
  end if;
  -- « plus disponible »: starts in less than 15 min, or the Bad has a visit at that time now.
  if s.starts_at < now() + interval '15 minutes' or exists (
       select 1 from public.visits v where v.bad_id = r.bad_id and v.status in ('scheduled', 'in_progress')
         and tstzrange(v.starts_at, v.ends_at) && tstzrange(s.starts_at, s.ends_at)) then
    raise exception 'slot_unavailable' using errcode = '23514';
  end if;
  if exists (select 1 from public.visits v where v.visitor_id = r.visitor_id and v.status in ('scheduled', 'in_progress')
               and tstzrange(v.starts_at, v.ends_at) && tstzrange(s.starts_at, s.ends_at)) then
    raise exception 'visitor_busy' using errcode = '23514';
  end if;
  insert into public.visits (request_id, slot_id, bad_id, visitor_id, starts_at, ends_at)
  values (r.id, s.id, r.bad_id, r.visitor_id, s.starts_at, s.ends_at)
  returning id into visit;
  update public.visit_slots set status = case when id = s.id then 'chosen'::public.slot_status else 'expired' end
  where request_id = r.id and status = 'offered';
  update public.visit_requests set choose_deadline = null, repropose_deadline = null where id = r.id;
  perform public.notify(r.bad_id, 'slot_chosen', jsonb_build_object('request_id', r.id, 'visit_id', visit));
  return visit;
end;
$$;

create function public.decline_slots(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.visit_requests;
begin
  select * into r from public.visit_requests where id = p_request for update;
  if not found or r.visitor_id <> (select auth.uid()) or public.is_blocked_between(r.bad_id, r.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if r.status <> 'accepted' or r.choose_deadline is null or r.choose_deadline <= now() then
    raise exception 'not_open' using errcode = '23514';
  end if;
  if r.slots_declined then raise exception 'already_declined' using errcode = '23514'; end if;
  update public.visit_slots set status = 'declined' where request_id = r.id and status = 'offered';
  update public.visit_requests
  set slots_declined = true, choose_deadline = null, repropose_deadline = now() + interval '48 hours'
  where id = r.id;
  perform public.notify(r.bad_id, 'slots_declined', jsonb_build_object('request_id', r.id));
end;
$$;

------------------------------------------------------------------------------------------------
-- 5. Cancelling a scheduled visit (either side, until the start)
------------------------------------------------------------------------------------------------
-- The other side is told with a neutral message; the Bad then has 48 h to propose new slots
-- (otherwise the case is classed automatically). Less than 2 h before = a late cancellation.
create function public.cancel_visit(p_visit uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.visits; me uuid := (select auth.uid()); other uuid;
begin
  select * into v from public.visits where id = p_visit for update;
  if not found or me not in (v.bad_id, v.visitor_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v.status <> 'scheduled' or v.starts_at <= now() then raise exception 'not_cancellable' using errcode = '23514'; end if;
  update public.visits
  set status = 'cancelled', cancelled_by = me, cancelled_at = now(),
      cancelled_late = v.starts_at - now() < interval '2 hours'
  where id = v.id;
  update public.visit_requests set repropose_deadline = now() + interval '48 hours', choose_deadline = null
  where id = v.request_id and status = 'accepted';
  other := case when me = v.bad_id then v.visitor_id else v.bad_id end;
  perform public.notify(other, 'visit_cancelled', jsonb_build_object('request_id', v.request_id, 'visit_id', v.id));
end;
$$;

-- A case that leaves « accepted » (classed, blocked, role change…) takes its visit and slots with it.
create function public.visit_requests_close_schedule()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.visits set status = 'cancelled', cancelled_at = now()
  where request_id = new.id and status = 'scheduled';
  update public.visit_slots set status = 'expired' where request_id = new.id and status = 'offered';
  return null;
end;
$$;
create trigger visit_requests_close_schedule
  after update of status on public.visit_requests
  for each row when (old.status = 'accepted' and new.status <> 'accepted')
  execute function public.visit_requests_close_schedule();

------------------------------------------------------------------------------------------------
-- 6. Reading the schedule (participants only, never anything about the bet: rule 14)
------------------------------------------------------------------------------------------------
create function public.get_request_schedule(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.visit_requests; me uuid := (select auth.uid()); visit jsonb;
begin
  select * into r from public.visit_requests where id = p_request;
  if not found or me not in (r.bad_id, r.visitor_id) or public.is_blocked_between(r.bad_id, r.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select jsonb_build_object('id', v.id, 'starts_at', v.starts_at, 'ends_at', v.ends_at, 'status', v.status)
    into visit
  from public.visits v where v.request_id = r.id and v.status in ('scheduled', 'in_progress');
  return jsonb_build_object(
    'request_id', r.id,
    'status', r.status,
    'round', r.slots_round,
    'slots_declined', r.slots_declined,
    'choose_deadline', r.choose_deadline,
    'repropose_deadline', r.repropose_deadline,
    'visit', visit,
    -- The Bad may (re)propose: Phase 4 acceptance without slots, or within the 48 h after a refusal
    -- of the slots or a cancellation.
    'can_propose', me = r.bad_id and r.status = 'accepted' and visit is null
      and (r.slots_round = 0 or (r.repropose_deadline is not null and r.repropose_deadline > now())),
    'slots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'status', s.status,
        'available', s.status = 'offered' and r.choose_deadline > now()
          and s.starts_at >= now() + interval '15 minutes'
          and not exists (select 1 from public.visits v
                          where v.status in ('scheduled', 'in_progress')
                            and (v.bad_id = r.bad_id or (me = r.visitor_id and v.visitor_id = r.visitor_id))
                            and tstzrange(v.starts_at, v.ends_at) && tstzrange(s.starts_at, s.ends_at)))
        order by s.starts_at)
      from public.visit_slots s where s.request_id = r.id and s.round = r.slots_round), '[]'::jsonb)
  );
end;
$$;

-- Le Tableau des visites: my scheduled visits (both roles).
create function public.get_my_visits()
returns table (visit_id uuid, request_id uuid, starts_at timestamptz, ends_at timestamptz,
  status public.visit_status, other_id uuid, other_pseudo text, other_gender public.gender,
  other_photo_small text, i_am_bad boolean)
language sql stable security definer set search_path = '' as $$
  select v.id, v.request_id, v.starts_at, v.ends_at, v.status, o.id, o.pseudo::text, o.gender,
    (select ph.public_path_small::text from public.photos ph
     where ph.owner_id = o.id and ph.position = 0 and ph.status = 'approved'),
    v.bad_id = (select auth.uid())
  from public.visits v
  join public.profiles o on o.id = case when v.bad_id = (select auth.uid()) then v.visitor_id else v.bad_id end
  where (select auth.uid()) in (v.bad_id, v.visitor_id)
    and v.status in ('scheduled', 'in_progress')
    and not public.is_blocked_between(v.bad_id, v.visitor_id)
  order by v.starts_at
  limit 50
$$;

------------------------------------------------------------------------------------------------
-- 7. Every minute: deadlines and reminders
------------------------------------------------------------------------------------------------
create function public.run_visit_schedule()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare no_choice integer; no_new integer; reminded integer; started integer;
begin
  -- No slot chosen within 48 h → classed automatically, neutral message (SPEC §7 bis, 2).
  with closed as (
    update public.visit_requests r
    set status = 'auto_dismissed', close_reason = 'no_slot_chosen', closed_at = now()
    where r.status = 'accepted' and r.choose_deadline is not null and r.choose_deadline <= now()
      and not exists (select 1 from public.visits v where v.request_id = r.id and v.status in ('scheduled', 'in_progress'))
    returning r.id, r.visitor_id
  )
  insert into public.notifications (user_id, type, payload)
  select visitor_id, 'request_dismissed', jsonb_build_object('request_id', id) from closed;
  get diagnostics no_choice = row_count;

  -- No new slots within 48 h → classed automatically (SPEC §7 bis, 3).
  with closed as (
    update public.visit_requests r
    set status = 'auto_dismissed', close_reason = 'no_new_slots', closed_at = now()
    where r.status = 'accepted' and r.repropose_deadline is not null and r.repropose_deadline <= now()
      and not exists (select 1 from public.visits v where v.request_id = r.id and v.status in ('scheduled', 'in_progress'))
    returning r.id, r.visitor_id
  )
  insert into public.notifications (user_id, type, payload)
  select visitor_id, 'request_dismissed', jsonb_build_object('request_id', id) from closed;
  get diagnostics no_new = row_count;

  -- Reminder 1 h before, then at the start: once each, to both (SPEC §7 bis, 5).
  with due as (
    update public.visits set reminder_sent_at = now()
    where status = 'scheduled' and reminder_sent_at is null
      and starts_at > now() and starts_at <= now() + interval '1 hour'
    returning id, request_id, bad_id, visitor_id
  )
  insert into public.notifications (user_id, type, payload)
  select u, 'visit_reminder_1h', jsonb_build_object('request_id', request_id, 'visit_id', id)
  from due cross join lateral (values (bad_id), (visitor_id)) people (u);
  get diagnostics reminded = row_count;

  with due as (
    update public.visits set start_notified_at = now()
    where status = 'scheduled' and start_notified_at is null and starts_at <= now() and ends_at > now()
    returning id, request_id, bad_id, visitor_id
  )
  insert into public.notifications (user_id, type, payload)
  select u, 'visit_starting', jsonb_build_object('request_id', request_id, 'visit_id', id)
  from due cross join lateral (values (bad_id), (visitor_id)) people (u);
  get diagnostics started = row_count;

  return jsonb_build_object('no_slot_chosen', no_choice, 'no_new_slots', no_new,
    'reminders', reminded, 'starting', started);
end;
$$;

select cron.schedule('visit-schedule', '* * * * *', 'select public.run_visit_schedule()');

------------------------------------------------------------------------------------------------
-- 8. Web Push: « créneau choisi », reminder 1 h, « la visite commence » (SPEC §16)
------------------------------------------------------------------------------------------------
create or replace function public.push_path(p_type public.notification_type)
returns text language sql immutable set search_path = '' as $$
  select case p_type
    when 'request_received' then '/courrier'
    when 'request_accepted' then '/demandes'
    when 'request_dismissed' then '/demandes'
    when 'slot_chosen' then '/visites'
    when 'visit_reminder_1h' then '/visites'
    when 'visit_starting' then '/visites'
    when 'promenade_open' then '/promenade'
    when 'permit_granted' then '/ma-fiche'
    when 'moderation_decision' then '/ma-fiche'
  end
$$;

------------------------------------------------------------------------------------------------
-- 9. Rights
------------------------------------------------------------------------------------------------
revoke execute on function public.checked_slots(uuid, timestamptz[]), public.insert_slots(uuid, smallint, timestamptz[]),
  public.run_visit_schedule(), public.visit_requests_close_schedule()
  from public, anon, authenticated;
revoke execute on function public.accept_visit_request(uuid, timestamptz[]), public.propose_slots(uuid, timestamptz[]),
  public.choose_slot(uuid), public.decline_slots(uuid), public.cancel_visit(uuid),
  public.get_request_schedule(uuid), public.get_my_visits()
  from public, anon;
grant execute on function public.accept_visit_request(uuid, timestamptz[]), public.propose_slots(uuid, timestamptz[]),
  public.choose_slot(uuid), public.decline_slots(uuid), public.cancel_visit(uuid),
  public.get_request_schedule(uuid), public.get_my_visits()
  to authenticated;
