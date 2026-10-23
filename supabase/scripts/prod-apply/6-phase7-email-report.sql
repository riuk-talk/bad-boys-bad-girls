-- bad-boys-prod (hmmobtyherwuhrhymfbk). Script 6 sur 9, à lancer dans l'ordre, dans le SQL Editor.
-- Généré par scripts/build-prod-apply.mjs (ne pas modifier à la main). Une seule transaction :
-- en cas d'erreur, rien n'est appliqué ; relancer le même script après correction.
-- Migrations (texte exact des fichiers, puis leur ligne d'historique) :
--   20261020130000_phase7e_email.sql
--   20261020140000_phase7f_report_message.sql
-- Aucun mot destructif.

begin;

-- Garde : la base est à l'étape précédente, et ce script n'a pas déjà été lancé.
do $guard$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261020120000') then
    raise exception 'étape précédente absente (20261020120000) : lancer les scripts dans l''ordre';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version >= '20261020130000') then
    raise exception 'déjà appliqué (20261020130000 ou plus récent présent)';
  end if;
end
$guard$;

-- ===== 20261020130000_phase7e_email.sql =====
-- Phase 7e: les e-mails (SPEC §16), sent by /api/cron/email through the HTTP API of Brevo (free
-- plan, no SDK). The queue email_outbox is fed by the database: requests received or accepted
-- (one e-mail a day at most), visit reminder (only if switched on), Cavale accepted, Permis
-- délivré, quartier opened, Fiche en veille, the single reminder of an unfinished onboarding (J+7,
-- lowest priority), the exposé des motifs of a ban, the admins. The daily quota keeps a reserve
-- for the Auth e-mails; what does not fit waits for the next day, except visit reminders, which
-- are dropped once the visit has started. Neutral texts only (no pseudo, no message).

------------------------------------------------------------------------------------------------
-- 1. Quota and lease
------------------------------------------------------------------------------------------------
create table public.email_quota_days (
  day date primary key,
  sent integer not null default 0 check (sent >= 0)
);
alter table public.email_quota_days enable row level security;
revoke all on public.email_quota_days from public, anon, authenticated;

alter table public.email_outbox add column claimed_until timestamptz;
create index email_outbox_due on public.email_outbox (priority, created_at) where status = 'queued';

------------------------------------------------------------------------------------------------
-- 2. Preferences: one switch per type (SPEC §16: désinscription par type)
------------------------------------------------------------------------------------------------
-- The switch of a kind, or null for the kinds that cannot be switched off (ban, admins).
create function private.email_allowed(p_user uuid, p_kind public.email_kind)
returns boolean language sql stable set search_path = '' as $$
  select case p_kind
    when 'request_digest' then np.email_request_digest
    when 'date_accepted' then np.email_date_accepted
    when 'zone_opened' then np.email_zone_opened
    when 'profile_dormant' then np.email_dormant
    when 'visit_reminder' then np.email_visit_reminder
    when 'permit_granted' then np.email_permit_granted
    when 'onboarding_reminder' then true
    else true end
  from (select 1) one
  left join public.notification_preferences np on np.user_id = p_user
$$;
revoke execute on function private.email_allowed(uuid, public.email_kind) from public, anon, authenticated, service_role;

-- Notifications that also go by e-mail (if the member wants it).
create function public.notifications_to_email()
returns trigger language plpgsql security definer set search_path = '' as $$
declare kind public.email_kind; prio smallint; payload jsonb := '{}';
begin
  case new.type
    when 'request_received', 'request_accepted' then kind := 'request_digest'; prio := 40;
    when 'date_accepted' then kind := 'date_accepted'; prio := 30;
    when 'permit_granted' then kind := 'permit_granted'; prio := 30;
    when 'visit_reminder_1h' then
      kind := 'visit_reminder'; prio := 10;
      payload := jsonb_build_object('starts_at',
        (select x.starts_at from public.visits x where x.id::text = new.payload ->> 'visit_id'));
    else return null;
  end case;
  if not coalesce(private.email_allowed(new.user_id, kind), true) then return null; end if;
  -- One digest a day per member (unique index email_outbox_one_per_day).
  insert into public.email_outbox (user_id, kind, payload, priority, not_before)
  values (new.user_id, kind, payload, prio, (now() at time zone 'Europe/Paris')::date)
  on conflict do nothing;
  return null;
end;
$$;
revoke execute on function public.notifications_to_email() from public, anon, authenticated;
create trigger notifications_to_email
  after insert on public.notifications
  for each row execute function public.notifications_to_email();

-- One-click unsubscribe (link of every e-mail, no session needed): the token of the member. Called
-- by the server with the secret key (anon executes no function at all).
create function public.unsubscribe_email(p_token uuid, p_kind text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_token is null then return false; end if;
  update public.notification_preferences set
    email_request_digest = case when p_kind = 'request_digest' then false else email_request_digest end,
    email_date_accepted = case when p_kind = 'date_accepted' then false else email_date_accepted end,
    email_zone_opened = case when p_kind = 'zone_opened' then false else email_zone_opened end,
    email_dormant = case when p_kind = 'profile_dormant' then false else email_dormant end,
    email_visit_reminder = case when p_kind = 'visit_reminder' then false else email_visit_reminder end,
    email_permit_granted = case when p_kind = 'permit_granted' then false else email_permit_granted end
  where unsubscribe_token = p_token
    and p_kind in ('request_digest', 'date_accepted', 'zone_opened', 'profile_dormant', 'visit_reminder', 'permit_granted');
  return found;
end;
$$;

------------------------------------------------------------------------------------------------
-- 3. The single reminder of an unfinished onboarding (J+7), every day
------------------------------------------------------------------------------------------------
create function public.enqueue_onboarding_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare queued integer;
begin
  insert into public.email_outbox (user_id, kind, priority)
  select p.id, 'onboarding_reminder', 90
  from public.profiles p
  where p.onboarding_completed_at is null and not p.is_seed and p.banned_at is null
    and p.created_at between now() - interval '8 days' and now() - interval '7 days'
  on conflict do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$$;

------------------------------------------------------------------------------------------------
-- 4. Sending (route /api/cron/email, secret key only)
------------------------------------------------------------------------------------------------
-- What may still be sent today: the daily quota minus the reserve for the Auth e-mails.
create function private.email_room_today()
returns integer language sql stable set search_path = '' as $$
  select greatest(0, s.email_daily_quota - s.email_auth_reserve
    - coalesce((select q.sent from public.email_quota_days q where q.day = (now() at time zone 'Europe/Paris')::date), 0))
  from public.app_settings s where s.id
$$;
revoke execute on function private.email_room_today() from public, anon, authenticated, service_role;

-- Claims up to p_limit e-mails (lease of 5 minutes), by priority, within today's room; drops the
-- visit reminders that came too late and the e-mails a member no longer wants or can receive.
create function public.email_claim(p_limit integer default 20)
returns table (email_id bigint, kind public.email_kind, recipient text, locale text, payload jsonb,
  unsubscribe_token uuid)
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Europe/Paris')::date; room integer; taken integer;
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
  insert into public.email_quota_days (day, sent) values (today, taken)
  on conflict (day) do update set sent = public.email_quota_days.sent + excluded.sent;
end;
$$;

-- Outcome of one e-mail: sent, or tried again (3 attempts at most); a failure gives its place in
-- today's quota back.
create function public.email_report(p_email bigint, p_sent boolean)
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
    where day = (now() at time zone 'Europe/Paris')::date;
  end if;
end;
$$;

-- Calls the route only when an e-mail is due and today's room is not used up.
create function public.email_dispatch()
returns boolean language plpgsql security definer set search_path = '' as $$
declare url text; secret text; bypass text; headers jsonb;
begin
  if private.email_room_today() <= 0 or not exists (
    select 1 from public.email_outbox o where o.status = 'queued'
      and o.not_before <= (now() at time zone 'Europe/Paris')::date
      and (o.claimed_until is null or o.claimed_until < now())) then
    return false;
  end if;
  select ds.decrypted_secret into url from vault.decrypted_secrets ds where ds.name = 'push_endpoint_url';
  select ds.decrypted_secret into secret from vault.decrypted_secrets ds where ds.name = 'push_cron_secret';
  select ds.decrypted_secret into bypass from vault.decrypted_secrets ds where ds.name = 'vercel_protection_bypass';
  if url is null or secret is null or url !~ '/api/cron/push$' then return false; end if;
  headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || secret);
  if bypass is not null then headers := headers || jsonb_build_object('x-vercel-protection-bypass', bypass); end if;
  perform net.http_post(url := regexp_replace(url, '/api/cron/push$', '/api/cron/email'), body := '{}'::jsonb,
    headers := headers, timeout_milliseconds := 30000);
  return true;
end;
$$;

------------------------------------------------------------------------------------------------
-- 5. Rights and schedule
------------------------------------------------------------------------------------------------
revoke execute on function public.unsubscribe_email(uuid, text), public.enqueue_onboarding_reminders(),
  public.email_claim(integer), public.email_report(bigint, boolean), public.email_dispatch()
  from public, anon, authenticated, service_role;
grant execute on function public.unsubscribe_email(uuid, text), public.email_claim(integer),
  public.email_report(bigint, boolean) to service_role;

select cron.schedule('onboarding-reminders', '50 7 * * *', 'select public.enqueue_onboarding_reminders()');
select cron.schedule('email-dispatch', '*/10 * * * *', 'select public.email_dispatch()');

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261020130000', 'phase7e_email', array[$mig$-- Phase 7e: les e-mails (SPEC §16), sent by /api/cron/email through the HTTP API of Brevo (free
-- plan, no SDK). The queue email_outbox is fed by the database: requests received or accepted
-- (one e-mail a day at most), visit reminder (only if switched on), Cavale accepted, Permis
-- délivré, quartier opened, Fiche en veille, the single reminder of an unfinished onboarding (J+7,
-- lowest priority), the exposé des motifs of a ban, the admins. The daily quota keeps a reserve
-- for the Auth e-mails; what does not fit waits for the next day, except visit reminders, which
-- are dropped once the visit has started. Neutral texts only (no pseudo, no message).

------------------------------------------------------------------------------------------------
-- 1. Quota and lease
------------------------------------------------------------------------------------------------
create table public.email_quota_days (
  day date primary key,
  sent integer not null default 0 check (sent >= 0)
);
alter table public.email_quota_days enable row level security;
revoke all on public.email_quota_days from public, anon, authenticated;

alter table public.email_outbox add column claimed_until timestamptz;
create index email_outbox_due on public.email_outbox (priority, created_at) where status = 'queued';

------------------------------------------------------------------------------------------------
-- 2. Preferences: one switch per type (SPEC §16: désinscription par type)
------------------------------------------------------------------------------------------------
-- The switch of a kind, or null for the kinds that cannot be switched off (ban, admins).
create function private.email_allowed(p_user uuid, p_kind public.email_kind)
returns boolean language sql stable set search_path = '' as $$
  select case p_kind
    when 'request_digest' then np.email_request_digest
    when 'date_accepted' then np.email_date_accepted
    when 'zone_opened' then np.email_zone_opened
    when 'profile_dormant' then np.email_dormant
    when 'visit_reminder' then np.email_visit_reminder
    when 'permit_granted' then np.email_permit_granted
    when 'onboarding_reminder' then true
    else true end
  from (select 1) one
  left join public.notification_preferences np on np.user_id = p_user
$$;
revoke execute on function private.email_allowed(uuid, public.email_kind) from public, anon, authenticated, service_role;

-- Notifications that also go by e-mail (if the member wants it).
create function public.notifications_to_email()
returns trigger language plpgsql security definer set search_path = '' as $$
declare kind public.email_kind; prio smallint; payload jsonb := '{}';
begin
  case new.type
    when 'request_received', 'request_accepted' then kind := 'request_digest'; prio := 40;
    when 'date_accepted' then kind := 'date_accepted'; prio := 30;
    when 'permit_granted' then kind := 'permit_granted'; prio := 30;
    when 'visit_reminder_1h' then
      kind := 'visit_reminder'; prio := 10;
      payload := jsonb_build_object('starts_at',
        (select x.starts_at from public.visits x where x.id::text = new.payload ->> 'visit_id'));
    else return null;
  end case;
  if not coalesce(private.email_allowed(new.user_id, kind), true) then return null; end if;
  -- One digest a day per member (unique index email_outbox_one_per_day).
  insert into public.email_outbox (user_id, kind, payload, priority, not_before)
  values (new.user_id, kind, payload, prio, (now() at time zone 'Europe/Paris')::date)
  on conflict do nothing;
  return null;
end;
$$;
revoke execute on function public.notifications_to_email() from public, anon, authenticated;
create trigger notifications_to_email
  after insert on public.notifications
  for each row execute function public.notifications_to_email();

-- One-click unsubscribe (link of every e-mail, no session needed): the token of the member. Called
-- by the server with the secret key (anon executes no function at all).
create function public.unsubscribe_email(p_token uuid, p_kind text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_token is null then return false; end if;
  update public.notification_preferences set
    email_request_digest = case when p_kind = 'request_digest' then false else email_request_digest end,
    email_date_accepted = case when p_kind = 'date_accepted' then false else email_date_accepted end,
    email_zone_opened = case when p_kind = 'zone_opened' then false else email_zone_opened end,
    email_dormant = case when p_kind = 'profile_dormant' then false else email_dormant end,
    email_visit_reminder = case when p_kind = 'visit_reminder' then false else email_visit_reminder end,
    email_permit_granted = case when p_kind = 'permit_granted' then false else email_permit_granted end
  where unsubscribe_token = p_token
    and p_kind in ('request_digest', 'date_accepted', 'zone_opened', 'profile_dormant', 'visit_reminder', 'permit_granted');
  return found;
end;
$$;

------------------------------------------------------------------------------------------------
-- 3. The single reminder of an unfinished onboarding (J+7), every day
------------------------------------------------------------------------------------------------
create function public.enqueue_onboarding_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare queued integer;
begin
  insert into public.email_outbox (user_id, kind, priority)
  select p.id, 'onboarding_reminder', 90
  from public.profiles p
  where p.onboarding_completed_at is null and not p.is_seed and p.banned_at is null
    and p.created_at between now() - interval '8 days' and now() - interval '7 days'
  on conflict do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$$;

------------------------------------------------------------------------------------------------
-- 4. Sending (route /api/cron/email, secret key only)
------------------------------------------------------------------------------------------------
-- What may still be sent today: the daily quota minus the reserve for the Auth e-mails.
create function private.email_room_today()
returns integer language sql stable set search_path = '' as $$
  select greatest(0, s.email_daily_quota - s.email_auth_reserve
    - coalesce((select q.sent from public.email_quota_days q where q.day = (now() at time zone 'Europe/Paris')::date), 0))
  from public.app_settings s where s.id
$$;
revoke execute on function private.email_room_today() from public, anon, authenticated, service_role;

-- Claims up to p_limit e-mails (lease of 5 minutes), by priority, within today's room; drops the
-- visit reminders that came too late and the e-mails a member no longer wants or can receive.
create function public.email_claim(p_limit integer default 20)
returns table (email_id bigint, kind public.email_kind, recipient text, locale text, payload jsonb,
  unsubscribe_token uuid)
language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Europe/Paris')::date; room integer; taken integer;
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
  insert into public.email_quota_days (day, sent) values (today, taken)
  on conflict (day) do update set sent = public.email_quota_days.sent + excluded.sent;
end;
$$;

-- Outcome of one e-mail: sent, or tried again (3 attempts at most); a failure gives its place in
-- today's quota back.
create function public.email_report(p_email bigint, p_sent boolean)
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
    where day = (now() at time zone 'Europe/Paris')::date;
  end if;
end;
$$;

-- Calls the route only when an e-mail is due and today's room is not used up.
create function public.email_dispatch()
returns boolean language plpgsql security definer set search_path = '' as $$
declare url text; secret text; bypass text; headers jsonb;
begin
  if private.email_room_today() <= 0 or not exists (
    select 1 from public.email_outbox o where o.status = 'queued'
      and o.not_before <= (now() at time zone 'Europe/Paris')::date
      and (o.claimed_until is null or o.claimed_until < now())) then
    return false;
  end if;
  select ds.decrypted_secret into url from vault.decrypted_secrets ds where ds.name = 'push_endpoint_url';
  select ds.decrypted_secret into secret from vault.decrypted_secrets ds where ds.name = 'push_cron_secret';
  select ds.decrypted_secret into bypass from vault.decrypted_secrets ds where ds.name = 'vercel_protection_bypass';
  if url is null or secret is null or url !~ '/api/cron/push$' then return false; end if;
  headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || secret);
  if bypass is not null then headers := headers || jsonb_build_object('x-vercel-protection-bypass', bypass); end if;
  perform net.http_post(url := regexp_replace(url, '/api/cron/push$', '/api/cron/email'), body := '{}'::jsonb,
    headers := headers, timeout_milliseconds := 30000);
  return true;
end;
$$;

------------------------------------------------------------------------------------------------
-- 5. Rights and schedule
------------------------------------------------------------------------------------------------
revoke execute on function public.unsubscribe_email(uuid, text), public.enqueue_onboarding_reminders(),
  public.email_claim(integer), public.email_report(bigint, boolean), public.email_dispatch()
  from public, anon, authenticated, service_role;
grant execute on function public.unsubscribe_email(uuid, text), public.email_claim(integer),
  public.email_report(bigint, boolean) to service_role;

select cron.schedule('onboarding-reminders', '50 7 * * *', 'select public.enqueue_onboarding_reminders()');
select cron.schedule('email-dispatch', '*/10 * * * *', 'select public.email_dispatch()');
$mig$]);

-- ===== 20261020140000_phase7f_report_message.sql =====
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

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261020140000', 'phase7f_report_message', array[$mig$-- Phase 7f: a message can be reported (SPEC §10 DSA: « Signaler sur … message »). The reporter must
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
$mig$]);

commit;

-- Empreintes (sans les blancs) : colonne attendu = colonne base.
select m.version, m.name, x.expected as attendu, md5(regexp_replace(array_to_string(m.statements, ';'), '\s', '', 'g')) as base
from supabase_migrations.schema_migrations m
join (values
  ('20261020130000', '478a08d326087450764b72e2aee90ba6'),
  ('20261020140000', '6364a1e05e1252cb9da2144175957ea2')
) as x (version, expected) on x.version = m.version
order by m.version;
