-- Phase 4: in-app notifications only. Opening the Courrier (or Mes demandes, or the Promenade)
-- marks as read the notifications of that screen, and only those; the Greffe's stay until read.
create function public.mark_notifications_read(p_types public.notification_type[])
returns void language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now()
  where user_id = (select auth.uid()) and read_at is null and type = any (p_types)
$$;
revoke execute on function public.mark_notifications_read(public.notification_type[]) from public, anon, authenticated;
grant execute on function public.mark_notifications_read(public.notification_type[]) to authenticated;
