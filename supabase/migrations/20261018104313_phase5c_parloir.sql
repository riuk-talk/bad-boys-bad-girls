-- Phase 5c: la visite au Parloir (SPEC §7 ter, §13; SCHEMA conversations, messages, visits).
--   * The Parloir opens only during the 30 minutes of the slot. A member is present once they open
--     the visit screen (join_visit, database clock).
--   * The bet (chosen charge and result) and the Visitor's note are revealed as the first messages
--     only when both are present: a visit that does not happen reveals nothing (rule 14).
--   * 10 minutes after the start, a missing member makes the visit « absent »; the Bad then has
--     48 h to propose new slots; a second absence in the same case classes it.
--   * After the 30 minutes each one chooses « Prolonger » or « Affaire classée » within 24 h, in
--     secret: both prolong → Permis permanent (the Parloir stays open, without a schedule).
--   * Messages: 1,000 characters, 30 per minute, contacts masked, kept for moderation.
-- No DROP: functions are replaced with the same signatures, the trigger with create or replace.

------------------------------------------------------------------------------------------------
-- 1. Types, tables, columns
------------------------------------------------------------------------------------------------
create type public.visit_absence as enum ('bad', 'visitor', 'both');
create type public.visit_end_choice as enum ('prolong', 'close');
create type public.conversation_status as enum ('visiting', 'open', 'closed');
create type public.message_kind as enum ('text', 'system');

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.visit_requests (id) on delete cascade,
  bad_id uuid not null references public.profiles (id) on delete cascade,
  visitor_id uuid not null references public.profiles (id) on delete cascade,
  status public.conversation_status not null default 'visiting',
  created_at timestamptz not null default now(),
  released_at timestamptz,
  closed_at timestamptz,
  last_message_at timestamptz,
  check (bad_id <> visitor_id)
);
create index conversations_bad on public.conversations (bad_id, status);
create index conversations_visitor on public.conversations (visitor_id, status);

create table public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  visit_id uuid references public.visits (id) on delete set null,
  sender_id uuid references public.profiles (id) on delete set null,
  kind public.message_kind not null default 'text',
  body varchar(1100),
  system_payload jsonb,
  created_at timestamptz not null default now(),
  check (kind <> 'system' or (sender_id is null and system_payload is not null)),
  check (kind <> 'text' or body is not null)
);
create index messages_conversation on public.messages (conversation_id, id);
create index messages_sender on public.messages (sender_id, created_at) where sender_id is not null;
create index messages_visit on public.messages (visit_id) where visit_id is not null;

alter table public.visits
  add column conversation_id uuid references public.conversations (id) on delete set null,
  add column bad_joined_at timestamptz,
  add column visitor_joined_at timestamptz,
  add column absent public.visit_absence,
  add column bad_end_choice public.visit_end_choice,
  add column visitor_end_choice public.visit_end_choice,
  add column end_choice_deadline timestamptz,
  add column outcome text check (outcome in ('released', 'closed'));
create index visits_conversation on public.visits (conversation_id) where conversation_id is not null;
create index visits_end_due on public.visits (end_choice_deadline) where status = 'ended' and outcome is null;

alter table public.visit_requests
  add constraint visit_requests_conversation_fk foreign key (conversation_id)
  references public.conversations (id) on delete set null;
create index visit_requests_conversation on public.visit_requests (conversation_id) where conversation_id is not null;

------------------------------------------------------------------------------------------------
-- 2. Rights: conversations through functions only; messages readable by the two members (needed
--    by Supabase Realtime, which applies RLS to each change it sends).
------------------------------------------------------------------------------------------------
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
revoke all on public.conversations, public.messages from public, anon, authenticated;

-- In the private schema (not exposed by the API): only answers « may I read this conversation? ».
create function private.can_read_conversation(p_conversation uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversations c
                 where c.id = p_conversation and (select auth.uid()) in (c.bad_id, c.visitor_id)
                   and not public.is_blocked_between(c.bad_id, c.visitor_id))
$$;
revoke execute on function private.can_read_conversation(uuid) from public, anon;
grant execute on function private.can_read_conversation(uuid) to authenticated;

grant select on public.messages to authenticated;
create policy "messages readable by the two members" on public.messages for select to authenticated
  using ((select private.can_read_conversation(conversation_id)));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

------------------------------------------------------------------------------------------------
-- 3. Internal steps of a visit
------------------------------------------------------------------------------------------------
-- The visit starts: in progress, its conversation (one per case, kept across visits), the
-- « la visite commence » notification once.
create function public.start_visit(p_visit uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.visits; conv uuid;
begin
  select * into v from public.visits where id = p_visit for update;
  if not found or v.status <> 'scheduled' or v.starts_at > now() or v.ends_at <= now() then return; end if;
  insert into public.conversations (request_id, bad_id, visitor_id)
  values (v.request_id, v.bad_id, v.visitor_id)
  on conflict (request_id) do update set request_id = excluded.request_id
  returning id into conv;
  update public.visits set status = 'in_progress', conversation_id = conv,
    start_notified_at = coalesce(start_notified_at, now())
  where id = v.id;
  update public.visit_requests set conversation_id = conv where id = v.request_id;
  if v.start_notified_at is null then
    insert into public.notifications (user_id, type, payload)
    select u, 'visit_starting', jsonb_build_object('request_id', v.request_id, 'visit_id', v.id)
    from (values (v.bad_id), (v.visitor_id)) people (u);
  end if;
end;
$$;

-- Both present: the bet and the Visitor's note open the conversation, once per case (SPEC §7 ter).
create function public.reveal_bet(p_visit uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.visits; r public.visit_requests; charges jsonb; true_index integer;
begin
  select * into v from public.visits where id = p_visit;
  if v.conversation_id is null or v.bad_joined_at is null or v.visitor_joined_at is null then return; end if;
  if exists (select 1 from public.messages m where m.conversation_id = v.conversation_id and m.kind = 'system'
             and m.system_payload ->> 'type' = 'bet') then return; end if;
  select * into r from public.visit_requests where id = v.request_id;
  charges := r.casier_snapshot -> 'charges';
  true_index := (r.casier_snapshot ->> 'true_index')::integer;
  insert into public.messages (conversation_id, visit_id, kind, system_payload)
  values (v.conversation_id, v.id, 'system', jsonb_build_object(
    'type', 'bet',
    'charge', charges ->> (r.guessed_index - 1),
    'correct', r.guess_correct,
    'true_charge', case when r.guess_correct then null else charges ->> (true_index - 1) end));
  if r.note is not null then
    insert into public.messages (conversation_id, visit_id, kind, system_payload)
    values (v.conversation_id, v.id, 'system', jsonb_build_object('type', 'note', 'text', r.note));
  end if;
  update public.conversations set last_message_at = now() where id = v.conversation_id;
end;
$$;

-- The end of a visit: Permis permanent if both prolong, otherwise the case is classed. Decided
-- once both have chosen, or at the deadline; neither choice is ever shown to the other.
create function public.resolve_visit(p_visit uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.visits; released boolean; reason public.case_close_reason;
begin
  select * into v from public.visits where id = p_visit for update;
  if not found or v.status <> 'ended' or v.outcome is not null then return; end if;
  if (v.bad_end_choice is null or v.visitor_end_choice is null) and v.end_choice_deadline > now() then return; end if;
  released := v.bad_end_choice = 'prolong' and v.visitor_end_choice = 'prolong';
  if released then
    update public.visits set outcome = 'released' where id = v.id;
    update public.visit_requests set status = 'released', closed_at = null where id = v.request_id and status = 'accepted';
    update public.conversations set status = 'open', released_at = now() where id = v.conversation_id;
    insert into public.messages (conversation_id, visit_id, kind, system_payload)
    values (v.conversation_id, v.id, 'system', jsonb_build_object('type', 'released'));
  else
    reason := case when v.bad_end_choice = 'close' or v.visitor_end_choice = 'close'
                   then 'not_prolonged' else 'no_end_choice' end;
    update public.visits set outcome = 'closed' where id = v.id;
    insert into public.messages (conversation_id, visit_id, kind, system_payload)
    values (v.conversation_id, v.id, 'system', jsonb_build_object('type', 'closed'));
    -- The trigger on visit_requests closes the conversation.
    update public.visit_requests set status = 'closed', close_reason = reason, closed_at = now()
    where id = v.request_id and status = 'accepted';
  end if;
  insert into public.notifications (user_id, type, payload)
  select u, case when released then 'visit_released'::public.notification_type else 'visit_closed' end,
    jsonb_build_object('request_id', v.request_id, 'visit_id', v.id)
  from (values (v.bad_id), (v.visitor_id)) people (u);
end;
$$;

------------------------------------------------------------------------------------------------
-- 4. Every minute: start, absence (+10 min), end (+30 min), choices past 24 h
------------------------------------------------------------------------------------------------
create function public.run_parloir_ticks()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x record; started integer := 0; absent_n integer := 0; ended integer := 0; resolved integer := 0;
  who public.visit_absence; r public.visit_requests;
begin
  for x in select id from public.visits where status = 'scheduled' and starts_at <= now() and ends_at > now() loop
    perform public.start_visit(x.id);
    started := started + 1;
  end loop;

  -- A slot that passed entirely without the job (or anyone) starting it: nobody was there.
  update public.visits set status = 'in_progress'
  where status = 'scheduled' and ends_at <= now();

  for x in select * from public.visits
           where status = 'in_progress' and starts_at + interval '10 minutes' <= now()
             and (bad_joined_at is null or visitor_joined_at is null)
           for update skip locked loop
    who := case when x.bad_joined_at is null and x.visitor_joined_at is null then 'both'
                when x.bad_joined_at is null then 'bad' else 'visitor' end;
    update public.visits set status = 'no_show', absent = who where id = x.id;
    update public.visit_requests set no_show_count = no_show_count + 1 where id = x.request_id
      returning * into r;
    insert into public.notifications (user_id, type, payload)
    select u, 'visit_no_show', jsonb_build_object('request_id', x.request_id, 'visit_id', x.id)
    from (values (x.bad_id), (x.visitor_id)) people (u);
    if r.status = 'accepted' then
      if r.no_show_count >= 2 then
        -- Second absence in the same case: classed, neutral message (SPEC §7 ter).
        update public.visit_requests set status = 'closed', close_reason = 'second_no_show', closed_at = now(),
          choose_deadline = null, repropose_deadline = null
        where id = r.id;
        perform public.notify(r.visitor_id, 'request_dismissed', jsonb_build_object('request_id', r.id));
      else
        -- New slots within 48 h (same rule as SPEC §7 bis), otherwise classed by run_visit_schedule.
        update public.visit_requests set repropose_deadline = now() + interval '48 hours', choose_deadline = null
        where id = r.id;
      end if;
    end if;
    absent_n := absent_n + 1;
  end loop;

  with done as (
    update public.visits set status = 'ended', end_choice_deadline = ends_at + interval '24 hours'
    where status = 'in_progress' and ends_at <= now() and bad_joined_at is not null and visitor_joined_at is not null
    returning id
  )
  select count(*) into ended from done;

  for x in select id from public.visits
           where status = 'ended' and outcome is null and end_choice_deadline <= now() loop
    perform public.resolve_visit(x.id);
    resolved := resolved + 1;
  end loop;

  return jsonb_build_object('started', started, 'absent', absent_n, 'ended', ended, 'resolved', resolved);
end;
$$;

select cron.schedule('parloir-ticks', '* * * * *', 'select public.run_parloir_ticks()');

------------------------------------------------------------------------------------------------
-- 5. The visit seen by a participant: never the other's end choice, never the bet before it is
--    revealed in the conversation.
------------------------------------------------------------------------------------------------
create function public.get_visit(p_visit uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v public.visits; me uuid := (select auth.uid()); i_am_bad boolean; o public.profiles;
  r public.visit_requests; rep record; c public.conversations;
begin
  select * into v from public.visits where id = p_visit;
  if not found or me is null or me not in (v.bad_id, v.visitor_id) or public.is_blocked_between(v.bad_id, v.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  i_am_bad := me = v.bad_id;
  select * into o from public.profiles where id = case when i_am_bad then v.visitor_id else v.bad_id end;
  select * into r from public.visit_requests where id = v.request_id;
  select * into rep from public.visitor_reputation(v.visitor_id);
  select * into c from public.conversations where id = v.conversation_id;
  return jsonb_build_object(
    'id', v.id,
    'request_id', v.request_id,
    'status', v.status,
    'starts_at', v.starts_at,
    'ends_at', v.ends_at,
    'now', now(),
    'cabin', abs(hashtext(v.id::text)) % 20 + 1,
    'i_am_bad', i_am_bad,
    'other', jsonb_build_object('id', o.id, 'pseudo', o.pseudo, 'gender', o.gender,
      'photo_small', (select ph.public_path_small from public.photos ph
                      where ph.owner_id = o.id and ph.position = 0 and ph.status = 'approved')),
    'me_present', case when i_am_bad then v.bad_joined_at else v.visitor_joined_at end is not null,
    'other_present', case when i_am_bad then v.visitor_joined_at else v.bad_joined_at end is not null,
    'absent', case
      when v.absent is null then null
      when v.absent = 'both' then 'both'
      when (v.absent = 'bad') = i_am_bad then 'me'
      else 'other' end,
    'visitor_clean_record', rep.clean_record,
    'visitor_honored', rep.honored,
    'visitor_due', rep.due,
    'end_choice_deadline', v.end_choice_deadline,
    'my_choice', case when i_am_bad then v.bad_end_choice else v.visitor_end_choice end,
    'outcome', v.outcome,
    'conversation_id', v.conversation_id,
    'conversation_status', c.status,
    'request_status', r.status,
    'can_propose', i_am_bad and r.status = 'accepted' and r.repropose_deadline is not null
      and r.repropose_deadline > now()
      and not exists (select 1 from public.visits x where x.request_id = r.id and x.status in ('scheduled', 'in_progress'))
  );
end;
$$;

-- Opening the visit screen: the visit starts if it is time, the member is marked present (once,
-- database clock), and the bet is revealed when both are there.
create function public.join_visit(p_visit uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.visits; me uuid := (select auth.uid());
begin
  select * into v from public.visits where id = p_visit;
  if not found or me is null or me not in (v.bad_id, v.visitor_id) or public.is_blocked_between(v.bad_id, v.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform public.start_visit(v.id);
  update public.visits
  set bad_joined_at = case when me = bad_id then coalesce(bad_joined_at, now()) else bad_joined_at end,
      visitor_joined_at = case when me = visitor_id then coalesce(visitor_joined_at, now()) else visitor_joined_at end
  where id = v.id and status = 'in_progress' and now() >= starts_at and now() < ends_at;
  perform public.reveal_bet(v.id);
  return public.get_visit(v.id);
end;
$$;

-- « Prolonger » or « Affaire classée », once, within 24 h of the end.
create function public.choose_visit_end(p_visit uuid, p_prolong boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.visits; me uuid := (select auth.uid()); choice public.visit_end_choice;
begin
  select * into v from public.visits where id = p_visit for update;
  if not found or me is null or me not in (v.bad_id, v.visitor_id) or public.is_blocked_between(v.bad_id, v.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_prolong is null then raise exception 'choice_required' using errcode = '22004'; end if;
  if v.status <> 'ended' or v.outcome is not null or v.end_choice_deadline <= now() then
    raise exception 'not_open' using errcode = '23514';
  end if;
  if (me = v.bad_id and v.bad_end_choice is not null) or (me = v.visitor_id and v.visitor_end_choice is not null) then
    raise exception 'already_chosen' using errcode = '23514';
  end if;
  choice := case when p_prolong then 'prolong'::public.visit_end_choice else 'close' end;
  if me = v.bad_id then
    update public.visits set bad_end_choice = choice where id = v.id;
  else
    update public.visits set visitor_end_choice = choice where id = v.id;
  end if;
  perform public.resolve_visit(v.id);
  return public.get_visit(v.id);
end;
$$;

------------------------------------------------------------------------------------------------
-- 6. Messages
------------------------------------------------------------------------------------------------
create function public.send_message(p_conversation uuid, p_body text)
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
  values (c.id, v.id, me, 'text', public.mask_contacts(msg))
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

create function public.get_messages(p_conversation uuid, p_after bigint default 0)
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
      m.body::text, m.system_payload, m.created_at
    from public.messages m
    where m.conversation_id = c.id and m.id > coalesce(p_after, 0)
    order by m.id
    limit 300;
end;
$$;

-- Le Parloir sans horaire (Permis permanent): the conversation seen by one of the two.
create function public.get_conversation(p_conversation uuid)
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
    'other', jsonb_build_object('id', o.id, 'pseudo', o.pseudo, 'gender', o.gender,
      'photo_small', (select ph.public_path_small from public.photos ph
                      where ph.owner_id = o.id and ph.position = 0 and ph.status = 'approved')));
end;
$$;

create function public.get_my_parloirs()
returns table (conversation_id uuid, other_id uuid, other_pseudo text, other_gender public.gender,
  other_photo_small text, released_at timestamptz, last_message_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, o.id, o.pseudo::text, o.gender,
    (select ph.public_path_small::text from public.photos ph
     where ph.owner_id = o.id and ph.position = 0 and ph.status = 'approved'),
    c.released_at, c.last_message_at
  from public.conversations c
  join public.profiles o on o.id = case when c.bad_id = (select auth.uid()) then c.visitor_id else c.bad_id end
  where (select auth.uid()) in (c.bad_id, c.visitor_id) and c.status = 'open'
    and not public.is_blocked_between(c.bad_id, c.visitor_id)
  order by coalesce(c.last_message_at, c.released_at) desc
  limit 50
$$;

-- « Affaire classée » from the Parloir sans horaire: neutral message, 30 days before a new request.
create function public.close_conversation(p_conversation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.conversations;
begin
  select * into c from public.conversations where id = p_conversation for update;
  if not found or me is null or me not in (c.bad_id, c.visitor_id) or public.is_blocked_between(c.bad_id, c.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if c.status <> 'open' then raise exception 'conversation_closed' using errcode = '23514'; end if;
  insert into public.messages (conversation_id, kind, system_payload)
  values (c.id, 'system', jsonb_build_object('type', 'closed'));
  update public.visit_requests set status = 'closed', close_reason = 'closed_after_release', closed_at = now()
  where id = c.request_id and status = 'released';
  perform public.notify(case when me = c.bad_id then c.visitor_id else c.bad_id end, 'visit_closed',
    jsonb_build_object('request_id', c.request_id));
end;
$$;

------------------------------------------------------------------------------------------------
-- 7. Existing rules extended to the Parloir
------------------------------------------------------------------------------------------------
-- A case that leaves « accepted » or « released » (classed, blocked, role change…) takes its
-- visit, its slots and its conversation with it.
create or replace function public.visit_requests_close_schedule()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.visits set status = 'cancelled', cancelled_at = now()
  where request_id = new.id and status in ('scheduled', 'in_progress');
  update public.visit_slots set status = 'expired' where request_id = new.id and status = 'offered';
  update public.conversations set status = 'closed', closed_at = now()
  where request_id = new.id and status <> 'closed';
  return null;
end;
$$;
create or replace trigger visit_requests_close_schedule
  after update of status on public.visit_requests
  for each row when (old.status in ('accepted', 'released') and new.status not in ('accepted', 'released'))
  execute function public.visit_requests_close_schedule();

-- Bloquer ends the visit and the Parloir at once (SPEC §7 ter).
create or replace function public.block_user(p_target uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null or p_target is null or me = p_target then raise exception 'invalid_target' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = p_target) then raise exception 'not_found' using errcode = 'P0002'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (me, p_target)
  on conflict (blocker_id, blocked_id) do update set created_at = now(), unblocked_at = null;
  update public.visit_requests set status = 'cancelled', close_reason = 'blocked', closed_at = now()
  where status in ('pending', 'accepted', 'released')
    and ((visitor_id = me and bad_id = p_target) or (visitor_id = p_target and bad_id = me));
end;
$$;

-- A role change also classes the Parloirs sans horaire of the member.
create or replace function public.change_role(p_role public.member_role)
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
      where bad_id = me.id and status in ('pending', 'accepted', 'released') returning id, visitor_id
    )
    insert into public.notifications (user_id, type, payload)
    select visitor_id, 'request_dismissed', jsonb_build_object('request_id', id) from closed;
  else
    -- Requests sent: cancelled (the Fiche stays hidden until the 3 poses and the Casier exist).
    update public.visit_requests set status = 'cancelled', close_reason = 'role_change', closed_at = now()
    where visitor_id = me.id and status in ('pending', 'accepted', 'released');
  end if;
  update public.profiles set role = p_role, role_changed_at = now() where id = me.id;
end;
$$;

-- « Visites honorées »: a visit held, or one the Bad missed, is honored by the Visitor; absences
-- and late cancellations of the Visitor are due and not honored.
create or replace function public.visitor_reputation(p_visitor uuid)
returns table (clean_record boolean, honored integer, due integer)
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.reports r where r.target_user_id = p_visitor and r.status = 'upheld'
                       and r.created_at > now() - interval '12 months')
     and not exists (select 1 from public.moderation_actions m where m.target_user_id = p_visitor
                       and m.action in ('warn', 'suspend', 'ban') and m.created_at > now() - interval '12 months'),
    (select count(*)::integer from public.visits x where x.visitor_id = p_visitor
       and (x.status = 'ended' or (x.status = 'no_show' and x.absent = 'bad'))),
    (select count(*)::integer from public.visits x where x.visitor_id = p_visitor
       and (x.status in ('ended', 'no_show')
            or (x.status = 'cancelled' and x.cancelled_late and x.cancelled_by = p_visitor)))
$$;

-- Le Tableau des visites also lists the visits waiting for the end choice.
create or replace function public.get_my_visits()
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
    and (v.status in ('scheduled', 'in_progress') or (v.status = 'ended' and v.outcome is null))
    and not public.is_blocked_between(v.bad_id, v.visitor_id)
  order by v.starts_at
  limit 50
$$;

------------------------------------------------------------------------------------------------
-- 8. Web Push (SPEC §16): absence, Permis permanent, case classed, message in the Parloir
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
    when 'promenade_open' then '/promenade'
    when 'permit_granted' then '/ma-fiche'
    when 'moderation_decision' then '/ma-fiche'
  end
$$;

-- Messages follow the « messages » preference, the rest of the visits « visites ».
create or replace function public.notifications_to_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare path text := public.push_path(new.type); allowed boolean;
begin
  if path is null then return null; end if;
  select case
      when new.type in ('request_received', 'request_accepted', 'request_dismissed') then np.push_requests
      when new.type = 'promenade_open' then np.push_promenade
      when new.type = 'message_received' then np.push_messages
      else np.push_visits end
    into allowed
  from public.notification_preferences np where np.user_id = new.user_id;
  if not coalesce(allowed, true) then return null; end if;
  if not exists (select 1 from public.push_subscriptions s where s.user_id = new.user_id and s.revoked_at is null) then
    return null;
  end if;
  insert into public.push_outbox (user_id, type, payload, dedupe_key)
  values (new.user_id, new.type, jsonb_build_object('path', path),
          -- The Greffe decides photo by photo: one notification a day is enough.
          case when new.type = 'moderation_decision' then 'greffe-' || current_date::text else new.id::text end)
  on conflict (user_id, type, dedupe_key) do nothing;
  return null;
end;
$$;

------------------------------------------------------------------------------------------------
-- 9. Rights
------------------------------------------------------------------------------------------------
revoke execute on function public.start_visit(uuid), public.reveal_bet(uuid), public.resolve_visit(uuid),
  public.run_parloir_ticks()
  from public, anon, authenticated;
revoke execute on function public.get_visit(uuid), public.join_visit(uuid), public.choose_visit_end(uuid, boolean),
  public.send_message(uuid, text), public.get_messages(uuid, bigint), public.get_conversation(uuid),
  public.get_my_parloirs(), public.close_conversation(uuid)
  from public, anon;
grant execute on function public.get_visit(uuid), public.join_visit(uuid), public.choose_visit_end(uuid, boolean),
  public.send_message(uuid, text), public.get_messages(uuid, bigint), public.get_conversation(uuid),
  public.get_my_parloirs(), public.close_conversation(uuid)
  to authenticated;
