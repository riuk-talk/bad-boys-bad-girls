-- UTILISÉ LE 2026-11-04, DEVENU INUTILE : phases 6 à 9 déjà en production. Ne pas relancer (voir README.md).
-- bad-boys-prod (hmmobtyherwuhrhymfbk). Script 2 sur 9, à lancer dans l'ordre, dans le SQL Editor.
-- Généré par scripts/build-prod-apply.mjs (ne pas modifier à la main). Une seule transaction :
-- en cas d'erreur, rien n'est appliqué ; relancer le même script après correction.
-- Migrations (texte exact des fichiers, puis leur ligne d'historique) :
--   20261019110000_phase6b_cavale.sql
--   20261019120000_phase6c_unmask.sql
-- Contient un mot destructif (delete, drop ou truncate), dans : phase6b_cavale, phase6c_unmask. L'éditeur demandera une confirmation.

begin;

-- Garde : la base est à l'étape précédente, et ce script n'a pas déjà été lancé.
do $guard$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261019105900') then
    raise exception 'étape précédente absente (20261019105900) : lancer les scripts dans l''ordre';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version >= '20261019110000') then
    raise exception 'déjà appliqué (20261019110000 ou plus récent présent)';
  end if;
end
$guard$;

-- ===== 20261019110000_phase6b_cavale.sql =====
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

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261019110000', 'phase6b_cavale', array[$mig$-- Phase 6b: la Cavale, a real date for two (SPEC §13, SCHEMA date_proposals). Only in a Parloir
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
$mig$]);

-- ===== 20261019120000_phase6c_unmask.sql =====
-- Phase 6c: the masking of contacts is lifted in the Parloir sans horaire (SPEC §10, v7.6) once a
-- Cavale has been accepted, provided both accounts are more than 7 days old, no report is open
-- between the two, and no open report for scam, minor, harassment or violence/threat targets
-- either of them. Only the messages sent after that are stored in clear (the earlier ones stay as
-- they were stored); once accepted, a cancelled Cavale keeps it lifted, but a blocking report
-- masks again. Never during the 30 minutes of a visit (the conversation is « visiting »).
-- No DROP: send_message and get_conversation keep their signatures.

create function private.can_unmask(p_conversation uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversations c
    join public.profiles b on b.id = c.bad_id
    join public.profiles v on v.id = c.visitor_id
    where c.id = p_conversation and c.status = 'open' and c.cavale_accepted_at is not null
      and b.created_at < now() - interval '7 days' and v.created_at < now() - interval '7 days'
      and not exists (select 1 from public.reports r where r.status = 'open'
                      and ((r.reporter_id = c.bad_id and r.target_user_id = c.visitor_id)
                        or (r.reporter_id = c.visitor_id and r.target_user_id = c.bad_id)
                        or (r.target_user_id in (c.bad_id, c.visitor_id)
                            and r.category in ('scam', 'minor', 'harassment', 'violence_threat')))))
$$;
revoke execute on function private.can_unmask(uuid) from public, anon, authenticated;

create or replace function public.send_message(p_conversation uuid, p_body text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.conversations; v public.visits; msg text; new_id bigint; other uuid;
begin
  select * into c from public.conversations where conversations.id = p_conversation for update;
  if not found or me is null or me not in (c.bad_id, c.visitor_id) or public.is_blocked_between(c.bad_id, c.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  msg := btrim(coalesce(p_body, ''));
  if msg = '' then raise exception 'message_empty' using errcode = '22023'; end if;
  if char_length(msg) > 1000 then raise exception 'message_too_long' using errcode = '22001'; end if;
  if c.status = 'closed' then raise exception 'conversation_closed' using errcode = '23514'; end if;
  if c.status = 'visiting' then
    -- During a visit only: in progress, before its end, both present.
    select * into v from public.visits x
    where x.conversation_id = c.id and x.status = 'in_progress' and now() >= x.starts_at and now() < x.ends_at
      and x.bad_joined_at is not null and x.visitor_joined_at is not null;
    if not found then raise exception 'not_open' using errcode = '23514'; end if;
  end if;
  if (select count(*) from public.messages m where m.sender_id = me and m.created_at > now() - interval '1 minute') >= 30 then
    raise exception 'rate_limited' using errcode = '23514';
  end if;
  insert into public.messages (conversation_id, visit_id, sender_id, kind, body)
  values (c.id, v.id, me, 'text', case when private.can_unmask(c.id) then msg else public.mask_contacts(msg) end)
  returning messages.id into new_id;
  update public.conversations set last_message_at = now() where conversations.id = c.id;
  perform public.flag_keywords(me, 'message', new_id::text, msg);
  -- Parloir sans horaire: the other is told, at most once per 15 minutes per conversation.
  other := case when me = c.bad_id then c.visitor_id else c.bad_id end;
  if c.status = 'open' and not exists (
       select 1 from public.notifications n where n.user_id = other and n.type = 'message_received'
         and n.payload ->> 'conversation_id' = c.id::text and n.created_at > now() - interval '15 minutes') then
    perform public.notify(other, 'message_received', jsonb_build_object('conversation_id', c.id));
  end if;
  return new_id;
end;
$$;

-- The Parloir sans horaire knows whether contacts pass (the « Ne partage jamais d'argent ni de
-- codes » notice).
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
    'other', jsonb_build_object('id', o.id, 'pseudo', o.pseudo, 'gender', o.gender,
      'photo_small', (select ph.public_path_small from public.photos ph
                      where ph.owner_id = o.id and ph.position = 0 and ph.status = 'approved')));
end;
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261019120000', 'phase6c_unmask', array[$mig$-- Phase 6c: the masking of contacts is lifted in the Parloir sans horaire (SPEC §10, v7.6) once a
-- Cavale has been accepted, provided both accounts are more than 7 days old, no report is open
-- between the two, and no open report for scam, minor, harassment or violence/threat targets
-- either of them. Only the messages sent after that are stored in clear (the earlier ones stay as
-- they were stored); once accepted, a cancelled Cavale keeps it lifted, but a blocking report
-- masks again. Never during the 30 minutes of a visit (the conversation is « visiting »).
-- No DROP: send_message and get_conversation keep their signatures.

create function private.can_unmask(p_conversation uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversations c
    join public.profiles b on b.id = c.bad_id
    join public.profiles v on v.id = c.visitor_id
    where c.id = p_conversation and c.status = 'open' and c.cavale_accepted_at is not null
      and b.created_at < now() - interval '7 days' and v.created_at < now() - interval '7 days'
      and not exists (select 1 from public.reports r where r.status = 'open'
                      and ((r.reporter_id = c.bad_id and r.target_user_id = c.visitor_id)
                        or (r.reporter_id = c.visitor_id and r.target_user_id = c.bad_id)
                        or (r.target_user_id in (c.bad_id, c.visitor_id)
                            and r.category in ('scam', 'minor', 'harassment', 'violence_threat')))))
$$;
revoke execute on function private.can_unmask(uuid) from public, anon, authenticated;

create or replace function public.send_message(p_conversation uuid, p_body text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.conversations; v public.visits; msg text; new_id bigint; other uuid;
begin
  select * into c from public.conversations where conversations.id = p_conversation for update;
  if not found or me is null or me not in (c.bad_id, c.visitor_id) or public.is_blocked_between(c.bad_id, c.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  msg := btrim(coalesce(p_body, ''));
  if msg = '' then raise exception 'message_empty' using errcode = '22023'; end if;
  if char_length(msg) > 1000 then raise exception 'message_too_long' using errcode = '22001'; end if;
  if c.status = 'closed' then raise exception 'conversation_closed' using errcode = '23514'; end if;
  if c.status = 'visiting' then
    -- During a visit only: in progress, before its end, both present.
    select * into v from public.visits x
    where x.conversation_id = c.id and x.status = 'in_progress' and now() >= x.starts_at and now() < x.ends_at
      and x.bad_joined_at is not null and x.visitor_joined_at is not null;
    if not found then raise exception 'not_open' using errcode = '23514'; end if;
  end if;
  if (select count(*) from public.messages m where m.sender_id = me and m.created_at > now() - interval '1 minute') >= 30 then
    raise exception 'rate_limited' using errcode = '23514';
  end if;
  insert into public.messages (conversation_id, visit_id, sender_id, kind, body)
  values (c.id, v.id, me, 'text', case when private.can_unmask(c.id) then msg else public.mask_contacts(msg) end)
  returning messages.id into new_id;
  update public.conversations set last_message_at = now() where conversations.id = c.id;
  perform public.flag_keywords(me, 'message', new_id::text, msg);
  -- Parloir sans horaire: the other is told, at most once per 15 minutes per conversation.
  other := case when me = c.bad_id then c.visitor_id else c.bad_id end;
  if c.status = 'open' and not exists (
       select 1 from public.notifications n where n.user_id = other and n.type = 'message_received'
         and n.payload ->> 'conversation_id' = c.id::text and n.created_at > now() - interval '15 minutes') then
    perform public.notify(other, 'message_received', jsonb_build_object('conversation_id', c.id));
  end if;
  return new_id;
end;
$$;

-- The Parloir sans horaire knows whether contacts pass (the « Ne partage jamais d'argent ni de
-- codes » notice).
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
    'other', jsonb_build_object('id', o.id, 'pseudo', o.pseudo, 'gender', o.gender,
      'photo_small', (select ph.public_path_small from public.photos ph
                      where ph.owner_id = o.id and ph.position = 0 and ph.status = 'approved')));
end;
$$;
$mig$]);

commit;

-- Empreintes (sans les blancs) : colonne attendu = colonne base.
select m.version, m.name, x.expected as attendu, md5(regexp_replace(array_to_string(m.statements, ';'), '\s', '', 'g')) as base
from supabase_migrations.schema_migrations m
join (values
  ('20261019110000', 'c4a7d62d477e9d0b6fca9107b53d0906'),
  ('20261019120000', '5700122a93d1c5fb37b5af94d5d4e46a')
) as x (version, expected) on x.version = m.version
order by m.version;
