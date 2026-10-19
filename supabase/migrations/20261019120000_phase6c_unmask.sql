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
