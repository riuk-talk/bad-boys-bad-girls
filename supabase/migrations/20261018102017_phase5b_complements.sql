-- Phase 5b, complements validated by the owner (2026-10-18):
--   1. After a cancelled visit the Bad may propose new slots once (48 h). A second cancellation in
--      the same case classes it (close_reason second_cancellation), with the neutral message.
--   2. « Visites honorées » counts the Visitor's late cancellations (less than 2 h before) as visits
--      due and not honored (SPEC §5 bis, §7 bis 4). Phase 5c adds presence and absences.
-- No DROP: functions are replaced with the same signatures.

alter type public.case_close_reason add value if not exists 'second_cancellation';

create or replace function public.cancel_visit(p_visit uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.visits; me uuid := (select auth.uid()); other uuid; earlier integer;
begin
  select * into v from public.visits where id = p_visit for update;
  if not found or me not in (v.bad_id, v.visitor_id) then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v.status <> 'scheduled' or v.starts_at <= now() then raise exception 'not_cancellable' using errcode = '23514'; end if;
  -- Cancellations by a participant before this one (a case classed by the system does not count).
  select count(*) into earlier from public.visits x
  where x.request_id = v.request_id and x.id <> v.id and x.status = 'cancelled' and x.cancelled_by is not null;
  update public.visits
  set status = 'cancelled', cancelled_by = me, cancelled_at = now(),
      cancelled_late = v.starts_at - now() < interval '2 hours'
  where id = v.id;
  other := case when me = v.bad_id then v.visitor_id else v.bad_id end;
  perform public.notify(other, 'visit_cancelled', jsonb_build_object('request_id', v.request_id, 'visit_id', v.id));
  if earlier = 0 then
    -- First cancellation: the Bad has 48 h to propose new slots, once.
    update public.visit_requests set repropose_deadline = now() + interval '48 hours', choose_deadline = null
    where id = v.request_id and status = 'accepted';
  else
    -- Second cancellation: the case is classed, neutral message to the Visitor.
    update public.visit_requests
    set status = 'closed', close_reason = 'second_cancellation', closed_at = now(),
        choose_deadline = null, repropose_deadline = null
    where id = v.request_id and status = 'accepted';
    if found then
      perform public.notify(v.visitor_id, 'request_dismissed', jsonb_build_object('request_id', v.request_id));
    end if;
  end if;
end;
$$;

-- « Casier vierge » unchanged; « Visites honorées X/Y »: visits held, out of visits held plus the
-- Visitor's late cancellations.
create or replace function public.visitor_reputation(p_visitor uuid)
returns table (clean_record boolean, honored integer, due integer)
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.reports r where r.target_user_id = p_visitor and r.status = 'upheld'
                       and r.created_at > now() - interval '12 months')
     and not exists (select 1 from public.moderation_actions m where m.target_user_id = p_visitor
                       and m.action in ('warn', 'suspend', 'ban') and m.created_at > now() - interval '12 months'),
    (select count(*)::integer from public.visits x where x.visitor_id = p_visitor and x.status = 'ended'),
    (select count(*)::integer from public.visits x where x.visitor_id = p_visitor
       and (x.status = 'ended' or (x.status = 'cancelled' and x.cancelled_late and x.cancelled_by = p_visitor)))
$$;
