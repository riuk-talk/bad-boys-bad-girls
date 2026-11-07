-- 10c (owner's request 2026-11-07): the navigation of /admin. Three read-only functions for an
-- admin with the second factor (is_admin(): admin role and aal2); none of them writes anything.
--  - admin_counts(): the live counters of the menu (photos waiting at the Greffe, open reports,
--    open flagged texts), numbers only;
--  - admin_dashboard(): the figures of the dashboard (/admin) and the 10 oldest items waiting;
--  - admin_search_members(q): the account search of the admin bar.
-- The waiting items are counted exactly as their own pages list them (admin_photo_queue,
-- admin_report_queue, admin_flag_queue). Seed profiles (is_seed) are left out of the figures.

-- The counters of the menu: numbers only.
create function public.admin_counts()
returns table (photos_pending integer, reports_open integer, flags_open integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select
      (select count(*)::integer from public.photos ph join public.profiles pr on pr.id = ph.owner_id
        where ph.status = 'pending' and ph.pending_path is not null and pr.banned_at is null),
      (select count(*)::integer from public.reports r where r.status = 'open'),
      (select count(*)::integer from public.flagged_texts f where f.status = 'open');
end;
$$;

-- The dashboard: real figures only, then the 10 oldest items waiting (with what their page shows).
create function public.admin_dashboard()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  counts record;
  s public.app_settings;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into counts from public.admin_counts();
  select * into s from public.app_settings where id;
  return jsonb_build_object(
    'bads_registered', (select count(*) from public.profiles p where p.role = 'bad' and not p.is_seed),
    'bads_complete', (select count(*) from public.profiles p
      where p.role = 'bad' and not p.is_seed and p.onboarding_completed_at is not null),
    'bads_visible', (select count(*) from public.profiles p
      where p.role = 'bad' and not p.is_seed and public.is_bad_visible(p)),
    'visitors_registered', (select count(*) from public.profiles p where p.role = 'visitor' and not p.is_seed),
    'visitors_complete', (select count(*) from public.profiles p
      where p.role = 'visitor' and not p.is_seed and p.onboarding_completed_at is not null),
    'photos_pending', counts.photos_pending,
    'reports_open', counts.reports_open,
    'flags_open', counts.flags_open,
    'zones_open', (select count(*) from public.launch_zones z where z.status = 'open'),
    'zones_waitlist', (select count(*) from public.launch_zones z where z.status = 'waitlist'),
    'emails_sent_today', (select q.sent from public.email_quota_days q where q.day = private.email_quota_day()),
    'emails_app_quota', case when s.id then s.email_daily_quota - s.email_auth_reserve end,
    'push_queued', (select count(*) from public.push_outbox o where o.status = 'queued'),
    'todo', coalesce((
      select jsonb_agg(jsonb_build_object('kind', t.kind, 'created_at', t.created_at, 'pseudo', t.pseudo,
        'detail', t.detail) order by t.created_at)
      from (
        select * from (
          select 'photo'::text as kind, ph.created_at, pr.pseudo::text as pseudo, ph.position::text as detail
          from public.photos ph join public.profiles pr on pr.id = ph.owner_id
          where ph.status = 'pending' and ph.pending_path is not null and pr.banned_at is null
          union all
          select 'report', r.created_at, t.pseudo::text, r.category::text
          from public.reports r left join public.profiles t on t.id = r.target_user_id
          where r.status = 'open'
          union all
          select 'flag', f.created_at, p.pseudo::text, f.source::text
          from public.flagged_texts f left join public.profiles p on p.id = f.user_id
          where f.status = 'open'
        ) waiting
        order by created_at
        limit 10
      ) t), '[]'::jsonb)
  );
end;
$$;

-- The account search: by pseudo (part of it) or N° d'écrou (part of it, digits), or by e-mail, exact
-- only (an e-mail is never searched by part). At most 20 results, with what the Membres page shows
-- in its list; the N° d'écrou is used to find a Bad, never returned.
create function public.admin_search_members(p_query text)
returns table (user_id uuid, pseudo text, role public.member_role, state text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  q text := btrim(coalesce(p_query, ''));
  pattern text;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if char_length(q) < 2 or char_length(q) > 254 then return; end if;
  if position('@' in q) > 0 then
    return query
      select p.id, p.pseudo::text, p.role, private.member_state(p), p.created_at
      from public.profiles p
      where p.id = (select u.id from auth.users u where lower(u.email) = lower(q) limit 1);
    return;
  end if;
  pattern := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select p.id, p.pseudo::text, p.role, private.member_state(p), p.created_at
    from public.profiles p
    where p.pseudo::text ilike pattern
       or (q ~ '^[0-9]{2,6}$' and p.ecrou like pattern)
    order by (lower(p.pseudo::text) = lower(q)) desc, p.pseudo
    limit 20;
end;
$$;

revoke execute on function public.admin_counts() from public, anon, authenticated, service_role;
revoke execute on function public.admin_dashboard() from public, anon, authenticated, service_role;
revoke execute on function public.admin_search_members(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_counts() to authenticated;
grant execute on function public.admin_dashboard() to authenticated;
grant execute on function public.admin_search_members(text) to authenticated;
