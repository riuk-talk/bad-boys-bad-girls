-- Phase 6b: la Cavale, a real date for two (SPEC §13, SCHEMA date_proposals). Only in a Parloir
-- sans horaire (Permis permanent). One proposal waits at a time; the other answers Accepter,
-- Proposer autre chose (a new proposal in return) or Pas encore (the proposer then waits 24 h,
-- the other may propose at once). Either one cancels an accepted Cavale in one gesture; moving
-- it = cancel, then propose again. Its card shows until the end of its day (time of France).
-- A private place (« chez moi », an address) brings a warning, never a refusal.
-- No DROP: the close trigger function is replaced with the same signature. The notification type
-- « date_cancelled » comes in the migration before (a new enum value cannot be used in its own one).

create type public.venue_type as enum ('bar', 'cafe', 'concert', 'walk', 'activity');
create type public.date_proposal_status as enum ('pending', 'accepted', 'countered', 'not_yet', 'cancelled');

create table public.date_proposals (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  proposer_id uuid references public.profiles (id) on delete set null,
  venue_type public.venue_type not null,
  -- 120 characters typed; the masking token may lengthen it.
  venue_name varchar(200) not null,
  starts_at timestamptz not null,
  status public.date_proposal_status not null default 'pending',
  parent_id uuid references public.date_proposals (id) on delete set null,
  private_place_warning boolean not null default false,
  responded_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index date_proposals_one_pending on public.date_proposals (conversation_id) where status = 'pending';
create index date_proposals_conversation on public.date_proposals (conversation_id, created_at desc);
create index date_proposals_proposer on public.date_proposals (proposer_id) where proposer_id is not null;
create index date_proposals_parent on public.date_proposals (parent_id) where parent_id is not null;
create index date_proposals_cancelled_by on public.date_proposals (cancelled_by) where cancelled_by is not null;
alter table public.date_proposals enable row level security;
revoke all on public.date_proposals from public, anon, authenticated;

-- The first Cavale accepted in the conversation (Phase 6c lifts the masking from then on).
alter table public.conversations add column cavale_accepted_at timestamptz;

------------------------------------------------------------------------------------------------
-- Rules (internal)
------------------------------------------------------------------------------------------------
-- « chez moi », « chez toi », « à la maison », an address… (mirror: lib/cavale.ts).
create function public.looks_private_place(p_text text)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select ' ' || public.normalize_text(p_text) || ' ' ~
    ('( chez (moi|toi|nous|vous|lui|elle|eux|mon|ma|ton|ta) | (a|a la) maison | domicile | (mon|ton|notre|votre) (appart|appartement|studio|logement) '
     || '| my place | your place | at home | my flat | your flat '
     || '| [0-9]+ ?(bis |ter )?(rue|avenue|av|boulevard|bd|chemin|allee|impasse|place|route|quai|cours|square|residence|lotissement|street|road) )')
$$;

-- The Cavale is a date of the day in France: its card shows until the end of that day.
create function public.date_is_upcoming(p_starts_at timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select (p_starts_at at time zone 'Europe/Paris')::date >= (now() at time zone 'Europe/Paris')::date
$$;

-- Checks a proposal and writes it (propose_date, counter_date).
create function public.insert_date_proposal(p_conversation uuid, p_proposer uuid, p_venue_type public.venue_type,
  p_venue_name text, p_starts_at timestamptz, p_parent uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare name text := btrim(coalesce(p_venue_name, '')); new_id uuid;
begin
  if p_venue_type is null then raise exception 'venue_required' using errcode = '22023'; end if;
  if char_length(name) < 2 or char_length(name) > 120 then raise exception 'venue_invalid' using errcode = '22023'; end if;
  if p_starts_at is null or p_starts_at < now() + interval '1 hour' then
    raise exception 'date_too_soon' using errcode = '22023';
  end if;
  if p_starts_at > now() + interval '60 days' then raise exception 'date_too_far' using errcode = '22023'; end if;
  if exists (select 1 from public.date_proposals d where d.conversation_id = p_conversation and d.status = 'pending') then
    raise exception 'date_pending' using errcode = '23514';
  end if;
  if exists (select 1 from public.date_proposals d where d.conversation_id = p_conversation and d.status = 'accepted'
             and public.date_is_upcoming(d.starts_at)) then
    raise exception 'date_accepted_exists' using errcode = '23514';
  end if;
  insert into public.date_proposals (conversation_id, proposer_id, venue_type, venue_name, starts_at, parent_id,
    private_place_warning)
  values (p_conversation, p_proposer, p_venue_type, public.mask_contacts(name), date_trunc('minute', p_starts_at),
    p_parent, public.looks_private_place(name))
  returning id into new_id;
  perform public.flag_keywords(p_proposer, 'date_venue', new_id::text, name);
  return new_id;
end;
$$;

-- The conversation of a member, open (Permis permanent), not blocked; otherwise an error.
create function public.open_conversation_for(p_conversation uuid, p_member uuid)
returns public.conversations language plpgsql security definer set search_path = '' as $$
declare c public.conversations;
begin
  select * into c from public.conversations where id = p_conversation for update;
  if not found or p_member is null or p_member not in (c.bad_id, c.visitor_id)
     or public.is_blocked_between(c.bad_id, c.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if c.status <> 'open' then raise exception 'not_open' using errcode = '23514'; end if;
  return c;
end;
$$;

------------------------------------------------------------------------------------------------
-- The members
------------------------------------------------------------------------------------------------
create function public.propose_date(p_conversation uuid, p_venue_type public.venue_type, p_venue_name text,
  p_starts_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.conversations; new_id uuid;
begin
  c := public.open_conversation_for(p_conversation, me);
  -- « Pas encore »: the proposer waits 24 h before proposing again (owner, 2026-10-19).
  if exists (select 1 from public.date_proposals d where d.conversation_id = c.id and d.proposer_id = me
             and d.status = 'not_yet' and d.responded_at > now() - interval '24 hours') then
    raise exception 'not_yet_wait' using errcode = '23514';
  end if;
  new_id := public.insert_date_proposal(c.id, me, p_venue_type, p_venue_name, p_starts_at, null);
  perform public.notify(case when me = c.bad_id then c.visitor_id else c.bad_id end, 'date_proposed',
    jsonb_build_object('conversation_id', c.id));
  return new_id;
end;
$$;

-- « Proposer autre chose »: the waiting proposal is answered with a new one.
create function public.counter_date(p_proposal uuid, p_venue_type public.venue_type, p_venue_name text,
  p_starts_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); d public.date_proposals; c public.conversations; new_id uuid;
begin
  select * into d from public.date_proposals where id = p_proposal for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  c := public.open_conversation_for(d.conversation_id, me);
  if d.proposer_id = me then raise exception 'not_found' using errcode = 'P0002'; end if;
  if d.status <> 'pending' then raise exception 'not_pending' using errcode = '23514'; end if;
  update public.date_proposals set status = 'countered', responded_at = now() where id = d.id;
  new_id := public.insert_date_proposal(c.id, me, p_venue_type, p_venue_name, p_starts_at, d.id);
  if d.proposer_id is not null then
    perform public.notify(d.proposer_id, 'date_countered', jsonb_build_object('conversation_id', c.id));
  end if;
  return new_id;
end;
$$;

-- « Accepter » or « Pas encore ».
create function public.respond_date(p_proposal uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); d public.date_proposals; c public.conversations;
begin
  select * into d from public.date_proposals where id = p_proposal for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  c := public.open_conversation_for(d.conversation_id, me);
  if d.proposer_id = me then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_accept is null then raise exception 'choice_required' using errcode = '22004'; end if;
  if d.status <> 'pending' then raise exception 'not_pending' using errcode = '23514'; end if;
  if p_accept then
    if d.starts_at <= now() then raise exception 'date_past' using errcode = '23514'; end if;
    update public.date_proposals set status = 'accepted', responded_at = now() where id = d.id;
    update public.conversations set cavale_accepted_at = coalesce(cavale_accepted_at, now()) where id = c.id;
    if d.proposer_id is not null then
      perform public.notify(d.proposer_id, 'date_accepted', jsonb_build_object('conversation_id', c.id));
    end if;
  else
    -- Gentle: no notification; the proposer sees it in the conversation.
    update public.date_proposals set status = 'not_yet', responded_at = now() where id = d.id;
  end if;
end;
$$;

-- An accepted Cavale (either one, until the end of its day) or one's own waiting proposal.
create function public.cancel_date(p_proposal uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); d public.date_proposals; c public.conversations;
begin
  select * into d from public.date_proposals where id = p_proposal for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  c := public.open_conversation_for(d.conversation_id, me);
  if not ((d.status = 'accepted' and public.date_is_upcoming(d.starts_at))
          or (d.status = 'pending' and d.proposer_id = me)) then
    raise exception 'not_cancellable' using errcode = '23514';
  end if;
  update public.date_proposals set status = 'cancelled', cancelled_by = me, cancelled_at = now() where id = d.id;
  if d.status = 'accepted' then
    perform public.notify(case when me = c.bad_id then c.visitor_id else c.bad_id end, 'date_cancelled',
      jsonb_build_object('conversation_id', c.id));
  end if;
end;
$$;

-- The Cavale of a conversation, as one of the two sees it.
create function public.get_dates(p_conversation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.conversations; pending public.date_proposals;
  accepted public.date_proposals; wait_until timestamptz;
begin
  select * into c from public.conversations where id = p_conversation;
  if not found or me is null or me not in (c.bad_id, c.visitor_id) or public.is_blocked_between(c.bad_id, c.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into pending from public.date_proposals d where d.conversation_id = c.id and d.status = 'pending';
  select * into accepted from public.date_proposals d
  where d.conversation_id = c.id and d.status = 'accepted' and public.date_is_upcoming(d.starts_at)
  order by d.starts_at limit 1;
  select max(d.responded_at) + interval '24 hours' into wait_until from public.date_proposals d
  where d.conversation_id = c.id and d.proposer_id = me and d.status = 'not_yet' and d.responded_at > now() - interval '24 hours';
  return jsonb_build_object(
    'pending', case when pending.id is null then null else jsonb_build_object(
      'id', pending.id, 'venue_type', pending.venue_type, 'venue_name', pending.venue_name,
      'starts_at', pending.starts_at, 'private_place_warning', pending.private_place_warning,
      'mine', pending.proposer_id = me, 'countered', pending.parent_id is not null) end,
    'accepted', case when accepted.id is null then null else jsonb_build_object(
      'id', accepted.id, 'venue_type', accepted.venue_type, 'venue_name', accepted.venue_name,
      'starts_at', accepted.starts_at, 'private_place_warning', accepted.private_place_warning,
      'mine', accepted.proposer_id = me) end,
    'wait_until', wait_until,
    'can_propose', c.status = 'open' and pending.id is null and accepted.id is null and wait_until is null
  );
end;
$$;

------------------------------------------------------------------------------------------------
-- A case that leaves « accepted » or « released » also ends its Cavales (blocked, classed…)
------------------------------------------------------------------------------------------------
create or replace function public.visit_requests_close_schedule()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.visits set status = 'cancelled', cancelled_at = now()
  where request_id = new.id and status in ('scheduled', 'in_progress');
  update public.visit_slots set status = 'expired' where request_id = new.id and status = 'offered';
  update public.date_proposals set status = 'cancelled', cancelled_at = now()
  where status in ('pending', 'accepted')
    and conversation_id in (select c.id from public.conversations c where c.request_id = new.id);
  update public.conversations set status = 'closed', closed_at = now()
  where request_id = new.id and status <> 'closed';
  return null;
end;
$$;

------------------------------------------------------------------------------------------------
-- Web Push (SPEC §16): proposed, accepted, other proposal, cancelled → the Visites tab
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
    when 'visit_no_show' then '/visites'
    when 'visit_released' then '/visites'
    when 'visit_closed' then '/visites'
    when 'message_received' then '/visites'
    when 'date_proposed' then '/visites'
    when 'date_accepted' then '/visites'
    when 'date_countered' then '/visites'
    when 'date_cancelled' then '/visites'
    when 'promenade_open' then '/promenade'
    when 'permit_granted' then '/ma-fiche'
    when 'moderation_decision' then '/ma-fiche'
  end
$$;

------------------------------------------------------------------------------------------------
-- Rights
------------------------------------------------------------------------------------------------
revoke execute on function public.insert_date_proposal(uuid, uuid, public.venue_type, text, timestamptz, uuid),
  public.open_conversation_for(uuid, uuid), public.date_is_upcoming(timestamptz), public.looks_private_place(text)
  from public, anon, authenticated;
revoke execute on function public.propose_date(uuid, public.venue_type, text, timestamptz),
  public.counter_date(uuid, public.venue_type, text, timestamptz), public.respond_date(uuid, boolean),
  public.cancel_date(uuid), public.get_dates(uuid)
  from public, anon;
grant execute on function public.propose_date(uuid, public.venue_type, text, timestamptz),
  public.counter_date(uuid, public.venue_type, text, timestamptz), public.respond_date(uuid, boolean),
  public.cancel_date(uuid), public.get_dates(uuid)
  to authenticated;
