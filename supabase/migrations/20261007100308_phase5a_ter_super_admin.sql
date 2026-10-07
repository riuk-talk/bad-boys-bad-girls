-- Phase 5a-ter: the super admin (decision of the owner, 2026-10-07).
-- A role distinct from admin, granted by hand (supabase/scripts/grant_super_admin.sql) on an account
-- the owner creates. Nobody but the database owner may delete that account (auth.users), take the
-- role away, ban it or give it a profile (so it can be neither suspended nor shown anywhere):
-- not the super admin themself, not another admin, not the Auth service, not the secret key, not
-- a scheduled job. Every admin function also requires a second factor (aal2).

------------------------------------------------------------------------------------------------
-- 1. Who may touch the super admin: the database owner, in person
------------------------------------------------------------------------------------------------
-- The guards run with the caller's rights (a member, the Auth service, the secret key), so their
-- helpers must be executable by those roles; schema "private" is not exposed by the API, so a
-- member still cannot ask whether an id is a super admin.
create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role, supabase_auth_admin;

-- Invoker rights on purpose (never security definer): inside a security definer function owned by
-- postgres, current_user is postgres but session_user is still the API role, and the JWT claims
-- of the member are set; both are checked. pg_cron runs as postgres too: refused as well, so that
-- no future purge job can reach this account.
create function private.is_database_owner_session()
returns boolean language sql stable set search_path = '' as $$
  select session_user = 'postgres'
    and current_user = 'postgres'
    and coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'sub' is null
    and coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'role' is null
    and coalesce(current_setting('application_name', true), '') <> 'pg_cron'
$$;

------------------------------------------------------------------------------------------------
-- 2. The role
------------------------------------------------------------------------------------------------
create table public.super_admins (
  user_id uuid primary key references auth.users (id) on delete restrict,
  note text,
  created_at timestamptz not null default now()
);
alter table public.super_admins enable row level security;
revoke all on public.super_admins from public, anon, authenticated, service_role;

-- Reads the table for the guards below, whatever the caller's rights.
create function private.is_super_admin_id(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.super_admins s where s.user_id = p_user)
$$;

create function private.is_super_admin_email_hash(p_hash bytea)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.super_admins s join auth.users u on u.id = s.user_id
    where u.email is not null and public.ban_email_hash(u.email) = p_hash)
$$;

------------------------------------------------------------------------------------------------
-- 3. Guards (triggers run with the caller's rights, see §1)
------------------------------------------------------------------------------------------------
create function public.guard_super_admins_table()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not private.is_database_owner_session() then
    raise exception 'super_admin_protected' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger super_admins_owner_only
  before insert or update or delete on public.super_admins
  for each row execute function public.guard_super_admins_table();
create trigger super_admins_owner_only_truncate
  before truncate on public.super_admins
  for each statement execute function public.guard_super_admins_table();

-- auth.users: no deletion (hard or soft) and no ban of a super admin.
create function public.guard_super_admin_account()
returns trigger language plpgsql set search_path = '' as $$
begin
  if private.is_database_owner_session() or not private.is_super_admin_id(old.id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE'
     or (new.banned_until is not null and new.banned_until > now()
         and new.banned_until is distinct from old.banned_until)
     or new.deleted_at is distinct from old.deleted_at then
    raise exception 'super_admin_protected' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger super_admin_account_protected
  before update or delete on auth.users
  for each row execute function public.guard_super_admin_account();

-- No profile for a super admin: never a Bad or a Visitor, invisible everywhere, and nothing to
-- suspend, hide or ban (profiles.suspended_until, hidden_reason, banned_at).
create function public.guard_super_admin_profile()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not private.is_database_owner_session()
     and private.is_super_admin_id(case when tg_op = 'DELETE' then old.id else new.id end) then
    raise exception 'super_admin_protected' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger super_admin_no_profile
  before insert or update or delete on public.profiles
  for each row execute function public.guard_super_admin_profile();

-- No ban by e-mail fingerprint either (the "Before User Created" hook would refuse the address).
create function public.guard_super_admin_email_ban()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not private.is_database_owner_session() and private.is_super_admin_email_hash(new.hash) then
    raise exception 'super_admin_protected' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger super_admin_email_not_banned
  before insert or update on public.banned_email_hashes
  for each row execute function public.guard_super_admin_email_ban();

-- Trigger functions are never called directly (PostgreSQL does not check this right when firing).
revoke execute on function public.guard_super_admins_table(), public.guard_super_admin_account(),
  public.guard_super_admin_profile(), public.guard_super_admin_email_ban() from public, anon, authenticated;
revoke execute on all functions in schema private from public;
grant execute on all functions in schema private to authenticated, service_role, supabase_auth_admin;

------------------------------------------------------------------------------------------------
-- 4. Admin rights need a second factor (aal2); the header only needs to know the role
------------------------------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'aal') = 'aal2', false)
    and (exists (select 1 from public.admin_users where user_id = (select auth.uid()))
         or exists (select 1 from public.super_admins where user_id = (select auth.uid())))
$$;

-- 'super_admin' | 'admin' | 'none' for the signed-in member, whatever the factor level: shows the
-- Admin link and sends a super admin to /admin instead of the onboarding. Grants nothing.
create function public.my_admin_role()
returns text language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.super_admins where user_id = (select auth.uid())) then 'super_admin'
    when exists (select 1 from public.admin_users where user_id = (select auth.uid())) then 'admin'
    else 'none' end
$$;
revoke execute on function public.my_admin_role() from public, anon;
grant execute on function public.my_admin_role() to authenticated;
