-- Phase 5c, complement validated by the owner (2026-10-18): after the Visitor's absence the Bad
-- may propose new slots (48 h, unchanged) or class the case; neither is required (without new
-- slots, the case is classed after 48 h by run_visit_schedule). The absence already counts in the
-- Visitor's « Visites honorées » (visitor_reputation, Phase 5c).
-- No DROP.

alter type public.case_close_reason add value if not exists 'closed_after_absence';

-- « Affaire classée » by the Bad after the Visitor missed the visit (absent = visitor or both).
create function public.close_after_absence(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.visit_requests; last public.visits;
begin
  select * into r from public.visit_requests where id = p_request for update;
  if not found or r.bad_id <> (select auth.uid()) then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into last from public.visits where request_id = r.id order by starts_at desc limit 1;
  if r.status <> 'accepted' or r.repropose_deadline is null or r.repropose_deadline <= now()
     or last.id is null or last.status <> 'no_show' or last.absent not in ('visitor', 'both') then
    raise exception 'not_expected' using errcode = '23514';
  end if;
  update public.visit_requests
  set status = 'closed', close_reason = 'closed_after_absence', closed_at = now(),
      choose_deadline = null, repropose_deadline = null
  where id = r.id;
  perform public.notify(r.visitor_id, 'request_dismissed', jsonb_build_object('request_id', r.id));
end;
$$;

-- The Courrier shows the choice (same signature, one more key).
create or replace function public.get_request_schedule(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.visit_requests; me uuid := (select auth.uid()); visit jsonb;
begin
  select * into r from public.visit_requests where id = p_request;
  if not found or me not in (r.bad_id, r.visitor_id) or public.is_blocked_between(r.bad_id, r.visitor_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select jsonb_build_object('id', v.id, 'starts_at', v.starts_at, 'ends_at', v.ends_at, 'status', v.status)
    into visit
  from public.visits v where v.request_id = r.id and v.status in ('scheduled', 'in_progress');
  return jsonb_build_object(
    'request_id', r.id,
    'status', r.status,
    'round', r.slots_round,
    'slots_declined', r.slots_declined,
    'choose_deadline', r.choose_deadline,
    'repropose_deadline', r.repropose_deadline,
    'visit', visit,
    -- The Bad may (re)propose: Phase 4 acceptance without slots, or within the 48 h after a refusal
    -- of the slots or a cancellation.
    'can_propose', me = r.bad_id and r.status = 'accepted' and visit is null
      and (r.slots_round = 0 or (r.repropose_deadline is not null and r.repropose_deadline > now())),
    -- After the Visitor's absence the Bad may also class the case (close_after_absence).
    'can_close_after_absence', me = r.bad_id and r.status = 'accepted' and visit is null
      and r.repropose_deadline is not null and r.repropose_deadline > now()
      and coalesce((select x.status = 'no_show' and x.absent in ('visitor', 'both') from public.visits x
                    where x.request_id = r.id order by x.starts_at desc limit 1), false),
    'slots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'status', s.status,
        'available', s.status = 'offered' and r.choose_deadline > now()
          and s.starts_at >= now() + interval '15 minutes'
          and not exists (select 1 from public.visits v
                          where v.status in ('scheduled', 'in_progress')
                            and (v.bad_id = r.bad_id or (me = r.visitor_id and v.visitor_id = r.visitor_id))
                            and tstzrange(v.starts_at, v.ends_at) && tstzrange(s.starts_at, s.ends_at)))
        order by s.starts_at)
      from public.visit_slots s where s.request_id = r.id and s.round = r.slots_round), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.close_after_absence(uuid) from public, anon;
grant execute on function public.close_after_absence(uuid) to authenticated;
