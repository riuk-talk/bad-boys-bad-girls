-- Phase 5a: Web Push (SPEC §7 quater, SCHEMA §2.4).
-- A notification written by SQL (public.notifications) is copied into push_outbox when the member
-- has an active subscription and has not turned that kind off. Every minute, push_dispatch() calls
-- the app route /api/cron/push through pg_net (shared secret, URL and preview bypass token read from
-- the Vault), and only when something is due. The route signs with the VAPID keys and reports back.
-- The payload is a type and an internal path only: the texts are in the service worker, neutral
-- (never a pseudo, a photo or a message).
-- No row is ever removed here: an expired or withdrawn subscription is revoked (address and keys
-- erased, revoked_at set); account deletion removes the rest (on delete cascade).

------------------------------------------------------------------------------------------------
-- 1. Subscriptions: one per browser, 5 active at most per member
------------------------------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text check (char_length(p256dh) between 40 and 200),
  auth text check (char_length(auth) between 10 and 100),
  locale text not null default 'fr' check (locale in ('fr', 'en')),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count smallint not null default 0,
  revoked_at timestamptz,
  check ((revoked_at is null) = (endpoint is not null and p256dh is not null and auth is not null))
);
create index push_subscriptions_user on public.push_subscriptions (user_id, created_at) where revoked_at is null;
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
-- Members never read or write the table: save_push_subscription / revoke_push_subscription only.

-- Revokes a subscription: the address and the browser keys are erased.
create function public.revoke_push_row(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.push_subscriptions
  set endpoint = null, p256dh = null, auth = null, revoked_at = now()
  where id = p_id and revoked_at is null
$$;

create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_locale text default 'fr')
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); old_id uuid;
begin
  if me is null or not exists (select 1 from public.profiles p where p.id = me) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000
     or char_length(coalesce(p_p256dh, '')) not between 40 and 200
     or char_length(coalesce(p_auth, '')) not between 10 and 100 then
    raise exception 'invalid_subscription' using errcode = '22023';
  end if;
  -- Same browser, maybe another account: the subscription moves to the member signed in now.
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, locale)
  values (me, p_endpoint, p_p256dh, p_auth, case when p_locale = 'en' then 'en' else 'fr' end)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        locale = excluded.locale, created_at = now(), failure_count = 0;
  -- 5 active subscriptions at most: the oldest are revoked.
  for old_id in
    select s.id from public.push_subscriptions s
    where s.user_id = me and s.revoked_at is null
    order by s.created_at desc, s.id offset 5
  loop
    perform public.revoke_push_row(old_id);
  end loop;
end;
$$;

create function public.revoke_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = '' as $$
declare sub uuid;
begin
  select s.id into sub from public.push_subscriptions s
  where s.endpoint = p_endpoint and s.user_id = (select auth.uid()) and s.revoked_at is null;
  if sub is not null then perform public.revoke_push_row(sub); end if;
end;
$$;

-- Number of browsers that receive the member's notifications (Ma Fiche).
create function public.push_device_count()
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.push_subscriptions s
  where s.user_id = (select auth.uid()) and s.revoked_at is null
$$;

------------------------------------------------------------------------------------------------
-- 2. Outbox: written by SQL only, read by the route with the secret key only
------------------------------------------------------------------------------------------------
create table public.push_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  type public.notification_type not null,
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  dedupe_key text not null,
  not_before timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  attempts smallint not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, type, dedupe_key)
);
create index push_outbox_due on public.push_outbox (not_before) where status = 'queued';
alter table public.push_outbox enable row level security;
revoke all on public.push_outbox from public, anon, authenticated;

-- Internal path opened by a click on the notification, per type (Phase 5b and 5c add theirs).
create function public.push_path(p_type public.notification_type)
returns text language sql immutable set search_path = '' as $$
  select case p_type
    when 'request_received' then '/courrier'
    when 'request_accepted' then '/demandes'
    when 'request_dismissed' then '/demandes'
    when 'promenade_open' then '/promenade'
    when 'permit_granted' then '/ma-fiche'
    when 'moderation_decision' then '/ma-fiche'
  end
$$;

create function public.notifications_to_push()
returns trigger language plpgsql security definer set search_path = '' as $$
declare path text := public.push_path(new.type); allowed boolean;
begin
  if path is null then return null; end if;
  select case
      when new.type in ('request_received', 'request_accepted', 'request_dismissed') then np.push_requests
      when new.type = 'promenade_open' then np.push_promenade
      else np.push_visits end
    into allowed
  from public.notification_preferences np where np.user_id = new.user_id;
  if not coalesce(allowed, true) then return null; end if;
  if not exists (select 1 from public.push_subscriptions s where s.user_id = new.user_id and s.revoked_at is null) then
    return null;
  end if;
  insert into public.push_outbox (user_id, type, payload, dedupe_key)
  values (new.user_id, new.type, jsonb_build_object('path', path),
          -- The Greffe decides photo by photo: one notification a day is enough.
          case when new.type = 'moderation_decision' then 'greffe-' || current_date::text else new.id::text end)
  on conflict (user_id, type, dedupe_key) do nothing;
  return null;
end;
$$;
create trigger notifications_to_push
  after insert on public.notifications
  for each row execute function public.notifications_to_push();

-- The route takes the due messages (a 5-minute lease: a crashed run is retried) with the active
-- subscriptions of each member. Secret key only.
create function public.push_claim(p_limit integer default 100)
returns table (id bigint, type public.notification_type, payload jsonb, attempts smallint, subscriptions jsonb)
language sql security definer set search_path = '' as $$
  with due as (
    select o.id from public.push_outbox o
    where o.status = 'queued' and o.not_before <= now()
    order by o.not_before, o.id
    limit least(greatest(p_limit, 1), 500)
    for update skip locked
  ),
  claimed as (
    update public.push_outbox o
    set attempts = o.attempts + 1, not_before = now() + interval '5 minutes'
    from due where o.id = due.id
    returning o.id, o.user_id, o.type, o.payload, o.attempts
  )
  select c.id, c.type, c.payload, c.attempts,
    coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh,
                                                  'auth', s.auth, 'locale', s.locale) order by s.created_at)
              from public.push_subscriptions s where s.user_id = c.user_id and s.revoked_at is null), '[]')
  from claimed c
$$;

-- What the route reports: {"sent": [outbox ids], "retry": [...], "skipped": [...],
-- "delivered": [subscription ids], "gone": [...], "failed": [...]}.
create function public.push_report(p_report jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare sub uuid;
begin
  update public.push_outbox set status = 'sent', sent_at = now()
  where id in (select jsonb_array_elements_text(coalesce(p_report -> 'sent', '[]'))::bigint);
  update public.push_outbox set status = 'skipped'
  where id in (select jsonb_array_elements_text(coalesce(p_report -> 'skipped', '[]'))::bigint);
  -- A message that failed 3 times is given up; otherwise it is retried after its lease.
  update public.push_outbox set status = case when attempts >= 3 then 'failed' else 'queued' end
  where id in (select jsonb_array_elements_text(coalesce(p_report -> 'retry', '[]'))::bigint) and status = 'queued';
  update public.push_subscriptions set last_success_at = now(), failure_count = 0
  where id in (select jsonb_array_elements_text(coalesce(p_report -> 'delivered', '[]'))::uuid);
  update public.push_subscriptions set failure_count = failure_count + 1
  where id in (select jsonb_array_elements_text(coalesce(p_report -> 'failed', '[]'))::uuid) and revoked_at is null;
  -- 404/410 from the push service, or 5 failures in a row: the subscription is revoked.
  for sub in
    select s.id from public.push_subscriptions s
    where s.revoked_at is null
      and (s.id in (select jsonb_array_elements_text(coalesce(p_report -> 'gone', '[]'))::uuid) or s.failure_count >= 5)
  loop
    perform public.revoke_push_row(sub);
  end loop;
end;
$$;

------------------------------------------------------------------------------------------------
-- 3. Every minute: wake the route only when something is due
------------------------------------------------------------------------------------------------
create function public.push_dispatch()
returns boolean language plpgsql security definer set search_path = '' as $$
declare url text; secret text; bypass text; headers jsonb;
begin
  if not exists (select 1 from public.push_outbox o where o.status = 'queued' and o.not_before <= now()) then
    return false;
  end if;
  select ds.decrypted_secret into url from vault.decrypted_secrets ds where ds.name = 'push_endpoint_url';
  select ds.decrypted_secret into secret from vault.decrypted_secrets ds where ds.name = 'push_cron_secret';
  select ds.decrypted_secret into bypass from vault.decrypted_secrets ds where ds.name = 'vercel_protection_bypass';
  if url is null or secret is null then return false; end if;
  headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || secret);
  if bypass is not null then headers := headers || jsonb_build_object('x-vercel-protection-bypass', bypass); end if;
  perform net.http_post(url := url, body := '{}'::jsonb, headers := headers, timeout_milliseconds := 30000);
  return true;
end;
$$;

-- Writes one of the three push secrets into the Vault (secret key only, from a server shell:
-- the values never go through a chat, a log or a migration).
create function public.set_push_secret(p_name text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare existing uuid;
begin
  if p_name not in ('push_endpoint_url', 'push_cron_secret', 'vercel_protection_bypass') then
    raise exception 'unknown_secret' using errcode = '22023';
  end if;
  if p_value is null or char_length(p_value) < 16 then
    raise exception 'invalid_secret' using errcode = '22023';
  end if;
  select s.id into existing from vault.secrets s where s.name = p_name;
  if existing is null then
    perform vault.create_secret(p_value, p_name, 'Phase 5a Web Push');
  else
    perform vault.update_secret(existing, p_value);
  end if;
end;
$$;

-- Rights: members call three functions; the route (secret key) claims and reports; nobody else.
revoke execute on function public.revoke_push_row(uuid), public.save_push_subscription(text, text, text, text),
  public.revoke_push_subscription(text), public.push_device_count(), public.push_path(public.notification_type),
  public.notifications_to_push(), public.push_claim(integer), public.push_report(jsonb), public.push_dispatch(),
  public.set_push_secret(text, text)
  from public, anon, authenticated;
grant execute on function public.save_push_subscription(text, text, text, text),
  public.revoke_push_subscription(text), public.push_device_count() to authenticated;
grant execute on function public.push_claim(integer), public.push_report(jsonb), public.set_push_secret(text, text)
  to service_role;

select cron.schedule('push-dispatch', '* * * * *', 'select public.push_dispatch()');
