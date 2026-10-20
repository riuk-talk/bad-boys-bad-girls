-- bad-boys-preview (chvnmzmvcjvhxlnfmlvv) seulement. Applique la migration 20261020110000_phase7c_jobs.sql, texte exact du fichier, puis enregistre sa ligne d'historique.
-- MD5 attendu du texte : 6e883863984fa13f247796199949e564

-- Phase 7c: les tâches planifiées (SPEC §3, §5, §11, §14, SCHEMA §3.5). Every day: Bonne conduite,
-- Fiches en veille, automatic opening of the quartiers, clean-up. What touches files or Auth
-- accounts is done by the route /api/cron/cleanup (secret key), called through pg_net only when
-- there is something to do; the super admin and the admins are never purged.

------------------------------------------------------------------------------------------------
-- 1. Bonne conduite (SPEC §14), every day
------------------------------------------------------------------------------------------------
-- A Bad gets it with: an account older than 30 days, at least 3 visits where they were there, no
-- report ever upheld against them, no absence and no late cancellation in the last 30 days, and
-- no warning, suspension, hidden Fiche or withdrawal of the badge in the last 30 days.
create function public.compute_good_conduct()
returns integer language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  with verdict as (
    select p.id,
      p.created_at < now() - interval '30 days'
      and public.is_member_active(p)
      and (select count(*) from public.visits x
           where x.bad_id = p.id and x.status in ('ended', 'no_show') and x.bad_joined_at is not null) >= 3
      and not exists (select 1 from public.reports r where r.target_user_id = p.id and r.status = 'upheld')
      and not exists (select 1 from public.visits x
                      where x.bad_id = p.id and x.starts_at > now() - interval '30 days'
                        and (x.absent in ('bad', 'both')
                             or (x.status = 'cancelled' and x.cancelled_late and x.cancelled_by = p.id)))
      and not exists (select 1 from public.moderation_actions m
                      where m.target_user_id = p.id and m.created_at > now() - interval '30 days'
                        and m.action in ('warn', 'suspend', 'ban', 'hide_profile', 'revoke_good_conduct')) as ok
    from public.profiles p
    where p.role = 'bad' and not p.is_seed
  )
  update public.profiles p set is_reglo = v.ok
  from verdict v where p.id = v.id and p.is_reglo is distinct from v.ok;
  get diagnostics changed = row_count;
  -- The badge belongs to Bads only (a role change takes it away).
  update public.profiles set is_reglo = false where role is distinct from 'bad' and is_reglo and not is_seed;
  return changed;
end;
$$;

------------------------------------------------------------------------------------------------
-- 2. Fiches en veille (SPEC §5): 90 days without signing in → hidden everywhere (is_bad_visible
--    already), told once (notification + e-mail « Ta Fiche est en veille »); back on sign-in.
--    21 days: out of the Promenade, last in the Découverte (migration phase7c_inactive_fiches).
------------------------------------------------------------------------------------------------
create function public.process_inactive_profiles()
returns integer language plpgsql security definer set search_path = '' as $$
declare slept integer;
begin
  with dormant as (
    update public.profiles p set dormant_since = now()
    where p.role = 'bad' and p.onboarding_completed_at is not null and not p.is_seed
      and p.banned_at is null and p.dormant_since is null
      and coalesce(p.last_seen_at, p.created_at) < now() - interval '90 days'
    returning p.id
  ), told as (
    insert into public.notifications (user_id, type, payload)
    select d.id, 'profile_dormant', '{}' from dormant d
    returning user_id
  )
  insert into public.email_outbox (user_id, kind, payload, priority)
  select t.user_id, 'profile_dormant', '{}', 30 from told t;
  get diagnostics slept = row_count;
  return slept;
end;
$$;

-- Last activity, at most one write per hour, the day of activity with it, and a sleeping Fiche
-- wakes up.
create or replace function public.touch_activity()
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  update public.profiles set last_seen_at = now(), dormant_since = null
  where id = me and (last_seen_at is null or last_seen_at < now() - interval '1 hour');
  if found then
    insert into public.activity_days (user_id, day)
    values (me, (now() at time zone 'Europe/Paris')::date)
    on conflict do nothing;
  end if;
end;
$$;

------------------------------------------------------------------------------------------------
-- 3. Quartiers (SPEC §3): ready_at the first time the thresholds are reached (the admins are told
--    once, by e-mail), opened by itself when auto_open is set
------------------------------------------------------------------------------------------------
-- Opening a quartier: its members are told (notification, e-mail sent in Phase 7e).
create function private.open_zone(p_zone smallint)
returns void language plpgsql set search_path = '' as $$
begin
  update public.launch_zones set status = 'open', opened_at = now() where id = p_zone and status <> 'open';
  if not found then return; end if;
  insert into public.notifications (user_id, type, payload)
  select p.id, 'zone_opened', jsonb_build_object('zone_id', p_zone)
  from public.profiles p
  where p.zone_id = p_zone and p.onboarding_completed_at is not null and p.banned_at is null and not p.is_seed;
  insert into public.email_outbox (user_id, kind, payload, priority)
  select p.id, 'zone_opened', jsonb_build_object('zone_id', p_zone), 40
  from public.profiles p
  where p.zone_id = p_zone and p.onboarding_completed_at is not null and p.banned_at is null and not p.is_seed;
end;
$$;
revoke execute on function private.open_zone(smallint) from public, anon, authenticated, service_role;

create or replace function public.admin_set_zone_status(p_zone smallint, p_status public.zone_status)
returns void language plpgsql security definer set search_path = '' as $$
declare z public.launch_zones;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into z from public.launch_zones where id = p_zone for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if z.status = p_status then raise exception 'same_status' using errcode = '23514'; end if;
  if p_status = 'open' then
    perform private.open_zone(p_zone);
  else
    update public.launch_zones set status = p_status where id = p_zone;
  end if;
end;
$$;

create function public.auto_open_zones()
returns integer language plpgsql security definer set search_path = '' as $$
declare z record; opened integer := 0;
begin
  for z in select lz.id, lz.auto_open, lz.ready_at from public.launch_zones lz where lz.status = 'waitlist' loop
    if (private.zone_gauge(z.id) ->> 'ready')::boolean then
      if z.ready_at is null then
        update public.launch_zones set ready_at = now() where id = z.id;
        -- The admins have no member profile necessarily: the e-mail carries their id.
        insert into public.email_outbox (user_id, kind, payload, priority)
        select null, 'admin_zone_ready', jsonb_build_object('zone_id', z.id, 'admin_id', a.user_id), 5
        from (select user_id from public.admin_users union select user_id from public.super_admins) a;
      end if;
      if z.auto_open then
        perform private.open_zone(z.id);
        opened := opened + 1;
      end if;
    end if;
  end loop;
  return opened;
end;
$$;

------------------------------------------------------------------------------------------------
-- 4. Clean-up (rows), every day
------------------------------------------------------------------------------------------------
-- Queues already handled (30 days), expired e-mail fingerprints, days of activity older than 400
-- days (retention needs J30 at most).
create function public.cleanup_rows()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pushes integer; emails integer; hashes integer; days integer;
begin
  delete from public.push_outbox where status in ('sent', 'failed', 'skipped') and created_at < now() - interval '30 days';
  get diagnostics pushes = row_count;
  delete from public.email_outbox where status in ('sent', 'failed', 'skipped') and created_at < now() - interval '30 days';
  get diagnostics emails = row_count;
  delete from public.banned_email_hashes where expires_at < now();
  get diagnostics hashes = row_count;
  delete from public.activity_days where day < current_date - 400;
  get diagnostics days = row_count;
  return jsonb_build_object('push_outbox', pushes, 'email_outbox', emails, 'banned_email_hashes', hashes,
    'activity_days', days);
end;
$$;

------------------------------------------------------------------------------------------------
-- 5. Clean-up (files and Auth accounts), done by /api/cron/cleanup with the secret key
------------------------------------------------------------------------------------------------
-- Photo path rotation (SPEC §11): after 30 days of pause and at a ban, the public files get a new
-- random name and the old ones are erased, so that old links stop working.
alter table public.photos add column path_rotated_at timestamptz;

-- Accounts whose onboarding is not finished 30 days after sign-up (SPEC §4): never an admin,
-- never the super admin.
create function public.cleanup_accounts_due(p_limit integer default 50)
returns table (user_id uuid, pending_paths text[], public_paths text[])
language sql stable security definer set search_path = '' as $$
  select u.id,
    coalesce((select array_agg(ph.pending_path) from public.photos ph where ph.owner_id = u.id and ph.pending_path is not null), '{}'),
    coalesce((select array_agg(x.path) from public.photos ph
              cross join lateral (values (ph.public_path_large), (ph.public_path_small)) x(path)
              where ph.owner_id = u.id and x.path is not null), '{}')
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.created_at < now() - interval '30 days'
    and (p.id is null or p.onboarding_completed_at is null)
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not exists (select 1 from public.super_admins s where s.user_id = u.id)
  order by u.created_at
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

create function public.cleanup_photos_due(p_limit integer default 50)
returns table (photo_id uuid, public_path_large text, public_path_small text)
language sql stable security definer set search_path = '' as $$
  select ph.id, ph.public_path_large, ph.public_path_small
  from public.photos ph join public.profiles p on p.id = ph.owner_id
  where ph.status = 'approved' and ph.public_path_large is not null and ph.public_path_small is not null
    and ((p.banned_at is not null and (ph.path_rotated_at is null or ph.path_rotated_at < p.banned_at))
      or (p.is_paused and p.paused_at < now() - interval '30 days'
          and (ph.path_rotated_at is null or ph.path_rotated_at < p.paused_at + interval '30 days')))
  order by ph.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

-- Records the new names once the files are copied; refused if the photo changed meanwhile.
create function public.cleanup_photo_rotated(p_photo uuid, p_old_large text, p_new_large text, p_new_small text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_new_large is null or p_new_small is null
     or p_new_large !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
     or p_new_small !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-s\.webp$' then
    raise exception 'invalid_public_path' using errcode = '22023';
  end if;
  update public.photos
  set public_path_large = p_new_large, public_path_small = p_new_small, path_rotated_at = now()
  where id = p_photo and public_path_large = p_old_large and status = 'approved';
  return found;
end;
$$;

-- Calls the route only when there is a file or an account to deal with (same secret and host as
-- the push route).
create function public.cleanup_dispatch()
returns boolean language plpgsql security definer set search_path = '' as $$
declare url text; secret text; bypass text; headers jsonb;
begin
  if not exists (select 1 from public.cleanup_accounts_due(1)) and not exists (select 1 from public.cleanup_photos_due(1)) then
    return false;
  end if;
  select ds.decrypted_secret into url from vault.decrypted_secrets ds where ds.name = 'push_endpoint_url';
  select ds.decrypted_secret into secret from vault.decrypted_secrets ds where ds.name = 'push_cron_secret';
  select ds.decrypted_secret into bypass from vault.decrypted_secrets ds where ds.name = 'vercel_protection_bypass';
  if url is null or secret is null or url !~ '/api/cron/push$' then return false; end if;
  headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || secret);
  if bypass is not null then headers := headers || jsonb_build_object('x-vercel-protection-bypass', bypass); end if;
  perform net.http_post(url := regexp_replace(url, '/api/cron/push$', '/api/cron/cleanup'), body := '{}'::jsonb,
    headers := headers, timeout_milliseconds := 60000);
  return true;
end;
$$;

------------------------------------------------------------------------------------------------
-- 6. Rights and schedule (times in UTC, at night in France)
------------------------------------------------------------------------------------------------
revoke execute on function public.compute_good_conduct(), public.process_inactive_profiles(),
  public.auto_open_zones(), public.cleanup_rows(), public.cleanup_dispatch(),
  public.cleanup_accounts_due(integer), public.cleanup_photos_due(integer),
  public.cleanup_photo_rotated(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_accounts_due(integer), public.cleanup_photos_due(integer),
  public.cleanup_photo_rotated(uuid, text, text, text) to service_role;

select cron.schedule('good-conduct', '10 2 * * *', 'select public.compute_good_conduct()');
select cron.schedule('inactive-profiles', '20 2 * * *', 'select public.process_inactive_profiles()');
select cron.schedule('auto-open-zones', '30 2 * * *', 'select public.auto_open_zones()');
select cron.schedule('cleanup', '40 2 * * *', 'select public.cleanup_rows(); select public.cleanup_dispatch()');

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261020110000', 'phase7c_jobs', array[$mig$-- Phase 7c: les tâches planifiées (SPEC §3, §5, §11, §14, SCHEMA §3.5). Every day: Bonne conduite,
-- Fiches en veille, automatic opening of the quartiers, clean-up. What touches files or Auth
-- accounts is done by the route /api/cron/cleanup (secret key), called through pg_net only when
-- there is something to do; the super admin and the admins are never purged.

------------------------------------------------------------------------------------------------
-- 1. Bonne conduite (SPEC §14), every day
------------------------------------------------------------------------------------------------
-- A Bad gets it with: an account older than 30 days, at least 3 visits where they were there, no
-- report ever upheld against them, no absence and no late cancellation in the last 30 days, and
-- no warning, suspension, hidden Fiche or withdrawal of the badge in the last 30 days.
create function public.compute_good_conduct()
returns integer language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  with verdict as (
    select p.id,
      p.created_at < now() - interval '30 days'
      and public.is_member_active(p)
      and (select count(*) from public.visits x
           where x.bad_id = p.id and x.status in ('ended', 'no_show') and x.bad_joined_at is not null) >= 3
      and not exists (select 1 from public.reports r where r.target_user_id = p.id and r.status = 'upheld')
      and not exists (select 1 from public.visits x
                      where x.bad_id = p.id and x.starts_at > now() - interval '30 days'
                        and (x.absent in ('bad', 'both')
                             or (x.status = 'cancelled' and x.cancelled_late and x.cancelled_by = p.id)))
      and not exists (select 1 from public.moderation_actions m
                      where m.target_user_id = p.id and m.created_at > now() - interval '30 days'
                        and m.action in ('warn', 'suspend', 'ban', 'hide_profile', 'revoke_good_conduct')) as ok
    from public.profiles p
    where p.role = 'bad' and not p.is_seed
  )
  update public.profiles p set is_reglo = v.ok
  from verdict v where p.id = v.id and p.is_reglo is distinct from v.ok;
  get diagnostics changed = row_count;
  -- The badge belongs to Bads only (a role change takes it away).
  update public.profiles set is_reglo = false where role is distinct from 'bad' and is_reglo and not is_seed;
  return changed;
end;
$$;

------------------------------------------------------------------------------------------------
-- 2. Fiches en veille (SPEC §5): 90 days without signing in → hidden everywhere (is_bad_visible
--    already), told once (notification + e-mail « Ta Fiche est en veille »); back on sign-in.
--    21 days: out of the Promenade, last in the Découverte (migration phase7c_inactive_fiches).
------------------------------------------------------------------------------------------------
create function public.process_inactive_profiles()
returns integer language plpgsql security definer set search_path = '' as $$
declare slept integer;
begin
  with dormant as (
    update public.profiles p set dormant_since = now()
    where p.role = 'bad' and p.onboarding_completed_at is not null and not p.is_seed
      and p.banned_at is null and p.dormant_since is null
      and coalesce(p.last_seen_at, p.created_at) < now() - interval '90 days'
    returning p.id
  ), told as (
    insert into public.notifications (user_id, type, payload)
    select d.id, 'profile_dormant', '{}' from dormant d
    returning user_id
  )
  insert into public.email_outbox (user_id, kind, payload, priority)
  select t.user_id, 'profile_dormant', '{}', 30 from told t;
  get diagnostics slept = row_count;
  return slept;
end;
$$;

-- Last activity, at most one write per hour, the day of activity with it, and a sleeping Fiche
-- wakes up.
create or replace function public.touch_activity()
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  update public.profiles set last_seen_at = now(), dormant_since = null
  where id = me and (last_seen_at is null or last_seen_at < now() - interval '1 hour');
  if found then
    insert into public.activity_days (user_id, day)
    values (me, (now() at time zone 'Europe/Paris')::date)
    on conflict do nothing;
  end if;
end;
$$;

------------------------------------------------------------------------------------------------
-- 3. Quartiers (SPEC §3): ready_at the first time the thresholds are reached (the admins are told
--    once, by e-mail), opened by itself when auto_open is set
------------------------------------------------------------------------------------------------
-- Opening a quartier: its members are told (notification, e-mail sent in Phase 7e).
create function private.open_zone(p_zone smallint)
returns void language plpgsql set search_path = '' as $$
begin
  update public.launch_zones set status = 'open', opened_at = now() where id = p_zone and status <> 'open';
  if not found then return; end if;
  insert into public.notifications (user_id, type, payload)
  select p.id, 'zone_opened', jsonb_build_object('zone_id', p_zone)
  from public.profiles p
  where p.zone_id = p_zone and p.onboarding_completed_at is not null and p.banned_at is null and not p.is_seed;
  insert into public.email_outbox (user_id, kind, payload, priority)
  select p.id, 'zone_opened', jsonb_build_object('zone_id', p_zone), 40
  from public.profiles p
  where p.zone_id = p_zone and p.onboarding_completed_at is not null and p.banned_at is null and not p.is_seed;
end;
$$;
revoke execute on function private.open_zone(smallint) from public, anon, authenticated, service_role;

create or replace function public.admin_set_zone_status(p_zone smallint, p_status public.zone_status)
returns void language plpgsql security definer set search_path = '' as $$
declare z public.launch_zones;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into z from public.launch_zones where id = p_zone for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if z.status = p_status then raise exception 'same_status' using errcode = '23514'; end if;
  if p_status = 'open' then
    perform private.open_zone(p_zone);
  else
    update public.launch_zones set status = p_status where id = p_zone;
  end if;
end;
$$;

create function public.auto_open_zones()
returns integer language plpgsql security definer set search_path = '' as $$
declare z record; opened integer := 0;
begin
  for z in select lz.id, lz.auto_open, lz.ready_at from public.launch_zones lz where lz.status = 'waitlist' loop
    if (private.zone_gauge(z.id) ->> 'ready')::boolean then
      if z.ready_at is null then
        update public.launch_zones set ready_at = now() where id = z.id;
        -- The admins have no member profile necessarily: the e-mail carries their id.
        insert into public.email_outbox (user_id, kind, payload, priority)
        select null, 'admin_zone_ready', jsonb_build_object('zone_id', z.id, 'admin_id', a.user_id), 5
        from (select user_id from public.admin_users union select user_id from public.super_admins) a;
      end if;
      if z.auto_open then
        perform private.open_zone(z.id);
        opened := opened + 1;
      end if;
    end if;
  end loop;
  return opened;
end;
$$;

------------------------------------------------------------------------------------------------
-- 4. Clean-up (rows), every day
------------------------------------------------------------------------------------------------
-- Queues already handled (30 days), expired e-mail fingerprints, days of activity older than 400
-- days (retention needs J30 at most).
create function public.cleanup_rows()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pushes integer; emails integer; hashes integer; days integer;
begin
  delete from public.push_outbox where status in ('sent', 'failed', 'skipped') and created_at < now() - interval '30 days';
  get diagnostics pushes = row_count;
  delete from public.email_outbox where status in ('sent', 'failed', 'skipped') and created_at < now() - interval '30 days';
  get diagnostics emails = row_count;
  delete from public.banned_email_hashes where expires_at < now();
  get diagnostics hashes = row_count;
  delete from public.activity_days where day < current_date - 400;
  get diagnostics days = row_count;
  return jsonb_build_object('push_outbox', pushes, 'email_outbox', emails, 'banned_email_hashes', hashes,
    'activity_days', days);
end;
$$;

------------------------------------------------------------------------------------------------
-- 5. Clean-up (files and Auth accounts), done by /api/cron/cleanup with the secret key
------------------------------------------------------------------------------------------------
-- Photo path rotation (SPEC §11): after 30 days of pause and at a ban, the public files get a new
-- random name and the old ones are erased, so that old links stop working.
alter table public.photos add column path_rotated_at timestamptz;

-- Accounts whose onboarding is not finished 30 days after sign-up (SPEC §4): never an admin,
-- never the super admin.
create function public.cleanup_accounts_due(p_limit integer default 50)
returns table (user_id uuid, pending_paths text[], public_paths text[])
language sql stable security definer set search_path = '' as $$
  select u.id,
    coalesce((select array_agg(ph.pending_path) from public.photos ph where ph.owner_id = u.id and ph.pending_path is not null), '{}'),
    coalesce((select array_agg(x.path) from public.photos ph
              cross join lateral (values (ph.public_path_large), (ph.public_path_small)) x(path)
              where ph.owner_id = u.id and x.path is not null), '{}')
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.created_at < now() - interval '30 days'
    and (p.id is null or p.onboarding_completed_at is null)
    and not exists (select 1 from public.admin_users a where a.user_id = u.id)
    and not exists (select 1 from public.super_admins s where s.user_id = u.id)
  order by u.created_at
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

create function public.cleanup_photos_due(p_limit integer default 50)
returns table (photo_id uuid, public_path_large text, public_path_small text)
language sql stable security definer set search_path = '' as $$
  select ph.id, ph.public_path_large, ph.public_path_small
  from public.photos ph join public.profiles p on p.id = ph.owner_id
  where ph.status = 'approved' and ph.public_path_large is not null and ph.public_path_small is not null
    and ((p.banned_at is not null and (ph.path_rotated_at is null or ph.path_rotated_at < p.banned_at))
      or (p.is_paused and p.paused_at < now() - interval '30 days'
          and (ph.path_rotated_at is null or ph.path_rotated_at < p.paused_at + interval '30 days')))
  order by ph.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

-- Records the new names once the files are copied; refused if the photo changed meanwhile.
create function public.cleanup_photo_rotated(p_photo uuid, p_old_large text, p_new_large text, p_new_small text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_new_large is null or p_new_small is null
     or p_new_large !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
     or p_new_small !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-s\.webp$' then
    raise exception 'invalid_public_path' using errcode = '22023';
  end if;
  update public.photos
  set public_path_large = p_new_large, public_path_small = p_new_small, path_rotated_at = now()
  where id = p_photo and public_path_large = p_old_large and status = 'approved';
  return found;
end;
$$;

-- Calls the route only when there is a file or an account to deal with (same secret and host as
-- the push route).
create function public.cleanup_dispatch()
returns boolean language plpgsql security definer set search_path = '' as $$
declare url text; secret text; bypass text; headers jsonb;
begin
  if not exists (select 1 from public.cleanup_accounts_due(1)) and not exists (select 1 from public.cleanup_photos_due(1)) then
    return false;
  end if;
  select ds.decrypted_secret into url from vault.decrypted_secrets ds where ds.name = 'push_endpoint_url';
  select ds.decrypted_secret into secret from vault.decrypted_secrets ds where ds.name = 'push_cron_secret';
  select ds.decrypted_secret into bypass from vault.decrypted_secrets ds where ds.name = 'vercel_protection_bypass';
  if url is null or secret is null or url !~ '/api/cron/push$' then return false; end if;
  headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || secret);
  if bypass is not null then headers := headers || jsonb_build_object('x-vercel-protection-bypass', bypass); end if;
  perform net.http_post(url := regexp_replace(url, '/api/cron/push$', '/api/cron/cleanup'), body := '{}'::jsonb,
    headers := headers, timeout_milliseconds := 60000);
  return true;
end;
$$;

------------------------------------------------------------------------------------------------
-- 6. Rights and schedule (times in UTC, at night in France)
------------------------------------------------------------------------------------------------
revoke execute on function public.compute_good_conduct(), public.process_inactive_profiles(),
  public.auto_open_zones(), public.cleanup_rows(), public.cleanup_dispatch(),
  public.cleanup_accounts_due(integer), public.cleanup_photos_due(integer),
  public.cleanup_photo_rotated(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_accounts_due(integer), public.cleanup_photos_due(integer),
  public.cleanup_photo_rotated(uuid, text, text, text) to service_role;

select cron.schedule('good-conduct', '10 2 * * *', 'select public.compute_good_conduct()');
select cron.schedule('inactive-profiles', '20 2 * * *', 'select public.process_inactive_profiles()');
select cron.schedule('auto-open-zones', '30 2 * * *', 'select public.auto_open_zones()');
select cron.schedule('cleanup', '40 2 * * *', 'select public.cleanup_rows(); select public.cleanup_dispatch()');
$mig$])
returning version, name, md5(array_to_string(statements, ';')) as md5_statements;
