-- 9l (owner's decision 2026-11-04): « … écrit » in the Parloir. Nothing is written in the
-- database: the typing signal goes through Supabase Realtime Broadcast on a private channel of
-- the conversation, `parloir-typing:<conversation id>`. Realtime Authorization (RLS on
-- realtime.messages, the topic in realtime.topic()) lets only the two members of the
-- conversation join it, listen and send; a blocked pair is refused, like the messages
-- themselves (private.can_read_conversation). Every other private topic stays closed.

-- The topic names a conversation the member reads; anything else (another topic, a malformed
-- id) is refused without an error.
create function private.can_use_typing_channel(p_topic text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if p_topic is null
     or p_topic !~ '^parloir-typing:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.can_read_conversation(substring(p_topic from 16)::uuid);
end;
$$;
revoke execute on function private.can_use_typing_channel(text) from public, anon;
grant execute on function private.can_use_typing_channel(text) to authenticated;

create policy "parloir typing: the two members listen" on realtime.messages
  for select to authenticated
  using (realtime.messages.extension = 'broadcast'
         and (select private.can_use_typing_channel((select realtime.topic()))));

create policy "parloir typing: the two members send" on realtime.messages
  for insert to authenticated
  with check (realtime.messages.extension = 'broadcast'
              and (select private.can_use_typing_channel((select realtime.topic()))));
