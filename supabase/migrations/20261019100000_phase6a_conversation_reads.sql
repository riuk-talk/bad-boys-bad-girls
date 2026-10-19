-- Phase 6a: read and unread in the Parloir (SPEC §13). Each member's last message read, per
-- conversation; « Lu » is shown under my last message once the other has read it; the unread
-- counters cover the Parloirs sans horaire (Permis permanent) and are read by polling.
-- No DROP.

alter table public.conversations
  add column bad_read_id bigint not null default 0,
  add column visitor_read_id bigint not null default 0;

-- Marks the conversation read up to a message (never beyond the last one, never backwards).
create function public.mark_conversation_read(p_conversation uuid, p_up_to bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.conversations; last_id bigint;
begin
  select * into c from public.conversations where id = p_conversation;
  if not found or me is null or me not in (c.bad_id, c.visitor_id) or public.is_blocked_between(c.bad_id, c.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select coalesce(max(m.id), 0) into last_id from public.messages m where m.conversation_id = c.id;
  if me = c.bad_id then
    update public.conversations set bad_read_id = greatest(bad_read_id, least(coalesce(p_up_to, 0), last_id))
    where id = c.id;
  else
    update public.conversations set visitor_read_id = greatest(visitor_read_id, least(coalesce(p_up_to, 0), last_id))
    where id = c.id;
  end if;
end;
$$;

-- What « Lu » needs: how far each of the two has read.
create function public.get_read_state(p_conversation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.conversations;
begin
  select * into c from public.conversations where id = p_conversation;
  if not found or me is null or me not in (c.bad_id, c.visitor_id) or public.is_blocked_between(c.bad_id, c.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'my_read_id', case when me = c.bad_id then c.bad_read_id else c.visitor_read_id end,
    'other_read_id', case when me = c.bad_id then c.visitor_read_id else c.bad_read_id end);
end;
$$;

-- Unread messages of the other, per Parloir sans horaire of the member.
create function public.get_unread_counts()
returns table (conversation_id uuid, unread integer)
language sql stable security definer set search_path = '' as $$
  select c.id, (select count(*)::integer from public.messages m
                where m.conversation_id = c.id and m.kind = 'text' and m.sender_id is distinct from (select auth.uid())
                  and m.id > case when c.bad_id = (select auth.uid()) then c.bad_read_id else c.visitor_read_id end)
  from public.conversations c
  where (select auth.uid()) in (c.bad_id, c.visitor_id) and c.status = 'open'
    and not public.is_blocked_between(c.bad_id, c.visitor_id)
$$;

revoke execute on function public.mark_conversation_read(uuid, bigint), public.get_read_state(uuid),
  public.get_unread_counts() from public, anon;
grant execute on function public.mark_conversation_read(uuid, bigint), public.get_read_state(uuid),
  public.get_unread_counts() to authenticated;
