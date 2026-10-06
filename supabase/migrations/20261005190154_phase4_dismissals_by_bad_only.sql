-- Phase 4a fix: only a refusal by the Bad counts towards the Visitor's consecutive dismissals
-- (advice after 3, SPEC §7). A case closed by a role change is not a refusal.
create or replace function public.visit_requests_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles
  set pending_requests_count = (select count(*) from public.visit_requests r
                                where r.bad_id = new.bad_id and r.status = 'pending')
  where id = new.bad_id;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'dismissed' and new.close_reason = 'dismissed_by_bad' then
      update public.profiles set consecutive_dismissals = consecutive_dismissals + 1 where id = new.visitor_id;
    elsif new.status = 'accepted' then
      update public.profiles set consecutive_dismissals = 0 where id = new.visitor_id;
    end if;
  end if;
  return null;
end;
$$;
