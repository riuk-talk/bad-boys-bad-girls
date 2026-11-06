-- 10b (2026-11-06): the e-mails of the app leave through Resend (free plan) instead of Brevo,
-- like the Auth e-mails (Supabase Auth SMTP). Resend's free plan allows 100 e-mails a day for the
-- whole account (Auth included), counted per UTC calendar day, and 3,000 a month. So:
--  - the daily quota becomes 100, of which 50 kept for the Auth e-mails (sign-up confirmation,
--    password) and 50 for the app (decision 10-5, to validate);
--  - the quota is counted per UTC day, Resend's day, instead of the Paris day; the « not before »
--    date of an e-mail (a Paris day, a product rule) does not change.
-- 100 a day for 30 days is the 3,000 of the month: the monthly limit needs nothing more.
alter table public.app_settings alter column email_daily_quota set default 100;
alter table public.app_settings alter column email_auth_reserve set default 50;
update public.app_settings set email_daily_quota = 100, email_auth_reserve = 50 where id;

-- The day of the sending quota: Resend's, a UTC calendar day.
create function private.email_quota_day()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'UTC')::date
$$;
revoke execute on function private.email_quota_day() from public, anon, authenticated, service_role;

create or replace function private.email_room_today()
returns integer language sql stable set search_path = '' as $$
  select greatest(0, s.email_daily_quota - s.email_auth_reserve
    - coalesce((select q.sent from public.email_quota_days q where q.day = private.email_quota_day()), 0))
  from public.app_settings s where s.id
$$;
revoke execute on function private.email_room_today() from public, anon, authenticated, service_role;

-- Claims up to p_limit e-mails (lease of 5 minutes), by priority, within today's room; drops the
-- visit reminders that came too late and the e-mails a member no longer wants or can receive.
create or replace function public.email_claim(p_limit integer default 20)
returns table (email_id bigint, kind public.email_kind, recipient text, locale text, payload jsonb,
  unsubscribe_token uuid)
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Europe/Paris')::date; quota_day date := private.email_quota_day();
  room integer; taken integer;
begin
  update public.email_outbox o set status = 'skipped'
  where o.status = 'queued' and (
    (o.kind = 'visit_reminder' and coalesce((o.payload ->> 'starts_at')::timestamptz, now()) <= now())
    or (o.user_id is not null and not coalesce(private.email_allowed(o.user_id, o.kind), true))
    or (o.user_id is not null and o.kind <> 'moderation_decision'
        and exists (select 1 from public.profiles p where p.id = o.user_id and p.banned_at is not null)));
  room := least(private.email_room_today(), greatest(coalesce(p_limit, 20), 1), 100);
  if room <= 0 then return; end if;
  return query
    with picked as (
      select o.id from public.email_outbox o
      where o.status = 'queued' and o.not_before <= today and (o.claimed_until is null or o.claimed_until < now())
      order by o.priority, o.created_at
      limit room
      for update skip locked
    ), leased as (
      update public.email_outbox o set claimed_until = now() + interval '5 minutes', attempts = o.attempts + 1
      from picked where o.id = picked.id
      returning o.*
    )
    select l.id, l.kind,
      (select u.email::text from auth.users u
       where u.id = coalesce(l.user_id, nullif(l.payload ->> 'admin_id', '')::uuid)),
      coalesce((select s.locale from public.push_subscriptions s where s.user_id = l.user_id
                order by s.created_at desc limit 1), 'fr'),
      l.payload,
      (select np.unsubscribe_token from public.notification_preferences np where np.user_id = l.user_id)
    from leased l;
  get diagnostics taken = row_count;
  insert into public.email_quota_days (day, sent) values (quota_day, taken)
  on conflict (day) do update set sent = public.email_quota_days.sent + excluded.sent;
end;
$$;

-- Outcome of one e-mail: sent, or tried again (3 attempts at most); a failure gives its place in
-- today's quota back.
create or replace function public.email_report(p_email bigint, p_sent boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.email_outbox;
begin
  select * into o from public.email_outbox where id = p_email for update;
  if not found or o.status <> 'queued' then return; end if;
  if p_sent then
    update public.email_outbox set status = 'sent', sent_at = now(), claimed_until = null where id = p_email;
  else
    update public.email_outbox
    set status = case when o.attempts >= 3 then 'failed' else 'queued' end, claimed_until = null
    where id = p_email;
    update public.email_quota_days set sent = greatest(sent - 1, 0)
    where day = private.email_quota_day();
  end if;
end;
$$;
