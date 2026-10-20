-- Phase 7f: a message can be reported (SPEC §10 DSA: « Signaler sur … message »). The reporter must
-- be in the conversation and the message must be the other member's; the Greffe then sees the
-- reported message alone (admin_report_queue, Phase 7a). Same function otherwise.

create or replace function public.report(p_target_type public.report_target, p_target_id text,
  p_category public.report_category, p_comment text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  target_user uuid;
  report_id bigint;
begin
  if me is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if (select count(*) from public.reports where reporter_id = me and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'report_limit' using errcode = '23514';
  end if;
  target_user := case p_target_type
    when 'profile' then (select id from public.profiles where id::text = p_target_id)
    when 'permit' then (select id from public.profiles where id::text = p_target_id)
    when 'casier' then (select profile_id from public.casier_charges where profile_id::text = p_target_id)
    when 'photo' then (select owner_id from public.photos where id::text = p_target_id)
    when 'visit_request' then (select case when r.visitor_id = me then r.bad_id else r.visitor_id end
                               from public.visit_requests r where r.id::text = p_target_id
                                 and me in (r.visitor_id, r.bad_id))
    -- A message of the other member, in a conversation of the reporter (Phase 7f).
    when 'message' then (select m.sender_id from public.messages m
                         join public.conversations c on c.id = m.conversation_id
                         where m.id::text = p_target_id and m.kind = 'text' and m.sender_id <> me
                           and me in (c.bad_id, c.visitor_id))
    else null end;
  -- Same answer whether the target does not exist or is out of the reporter's reach.
  if target_user is null or not public.can_report(me, target_user) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.reports (reporter_id, target_user_id, target_type, target_id, category, comment)
  values (me, target_user, p_target_type, p_target_id, p_category, left(nullif(btrim(p_comment), ''), 500))
  returning id into report_id;
  -- « Mineur » (protection first): hidden at once after 2 distinct established reporters, or
  -- 1 Bad with Bonne conduite. Accounts without a validated photo or younger than 7 days do not count.
  if p_category = 'minor' and (
       (select count(distinct r.reporter_id) from public.reports r
        where r.target_user_id = target_user and r.category = 'minor' and r.status = 'open'
          and public.is_trusted_reporter(r.reporter_id)) >= 2
       or exists (select 1 from public.profiles where id = me and role = 'bad' and is_reglo)) then
    update public.profiles set hidden_reason = 'minor_report' where id = target_user and hidden_reason is null;
  end if;
  return report_id;
end;
$$;
