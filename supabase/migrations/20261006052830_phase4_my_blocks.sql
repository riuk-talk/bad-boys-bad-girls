-- Phase 4e: the list of members I blocked, to unblock them from Ma Fiche. Other profiles are not
-- readable (RLS), so the pseudo comes from this function: my own blocks only, nothing else.
create function public.get_my_blocks()
returns table (blocked_id uuid, pseudo text, blocked_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select bl.blocked_id, p.pseudo::text, bl.created_at
  from public.blocks bl
  join public.profiles p on p.id = bl.blocked_id
  where bl.blocker_id = (select auth.uid()) and bl.unblocked_at is null
  order by bl.created_at desc
$$;
revoke execute on function public.get_my_blocks() from public, anon, authenticated;
grant execute on function public.get_my_blocks() to authenticated;
