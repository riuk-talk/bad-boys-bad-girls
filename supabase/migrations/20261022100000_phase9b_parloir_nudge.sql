-- Phase 9b [P1]: la relance à 48 h du Parloir sans horaire (SPEC §13). Permis permanent for 48 h,
-- no Cavale ever proposed in the conversation, last message older than 24 h: a discreet banner
-- « Toujours là ? », once per member and per conversation (marked as seen when shown).

alter table public.conversations
  add column bad_nudged_at timestamptz,
  add column visitor_nudged_at timestamptz;

-- Whether the banner is due for p_member (a participant) in c.
create function private.nudge_due(c public.conversations, p_member uuid)
returns boolean language sql stable set search_path = '' as $$
  select c.status = 'open'
    and c.released_at <= now() - interval '48 hours'
    and coalesce(c.last_message_at, c.released_at) <= now() - interval '24 hours'
    and c.bad_id is not null and c.visitor_id is not null
    and case when p_member = c.bad_id then c.bad_nudged_at else c.visitor_nudged_at end is null
    and not exists (select 1 from public.date_proposals d where d.conversation_id = c.id)
$$;
revoke execute on function private.nudge_due(public.conversations, uuid) from public, anon, authenticated, service_role;

-- Same function as Phase 7d, plus `nudge`.
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
    'nudge', private.nudge_due(c, me),
    'other', jsonb_build_object('id', o.id, 'pseudo', o.pseudo, 'gender', o.gender,
      'photo_small', (select ph.public_path_small from public.photos ph
                      where ph.owner_id = o.id and ph.position = 0 and ph.status = 'approved')));
end;
$$;

-- The banner was shown to the caller: it will not come back in this conversation.
create function public.ack_parloir_nudge(p_conversation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  update public.conversations c set
    bad_nudged_at = case when me = c.bad_id then coalesce(c.bad_nudged_at, now()) else c.bad_nudged_at end,
    visitor_nudged_at = case when me = c.visitor_id then coalesce(c.visitor_nudged_at, now()) else c.visitor_nudged_at end
  where c.id = p_conversation and me in (c.bad_id, c.visitor_id);
end;
$$;
revoke execute on function public.ack_parloir_nudge(uuid) from public, anon, authenticated, service_role;
grant execute on function public.ack_parloir_nudge(uuid) to authenticated;
