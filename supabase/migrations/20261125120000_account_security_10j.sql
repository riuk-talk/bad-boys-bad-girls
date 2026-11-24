-- 10j (owner's decision on question 10-22, 2026-11-24): change one's password and e-mail from
-- Ma fiche › Mon compte. Supabase Auth does the change and sends the e-mails (its SMTP is Resend,
-- whose free quota keeps 50 e-mails a day for Auth, 10-5). Here, what the database guards:
--  1. at most 3 changes of each kind a day per member (account_changes, claim_account_change),
--     so that the e-mails of Auth stay within the quota;
--  2. an address cannot become the address of an account while it is banned, nor the address of
--     a super admin change, whoever asks Supabase Auth (this page, or its API called directly):
--     a trigger on auth.users, like super_admin_account_protected (5a-ter). The database owner
--     (SQL Editor) is not concerned.

---------------------------------------------------------------------------------------------------
-- 1. The daily cap
create table public.account_changes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('password', 'email')),
  created_at timestamptz not null default now()
);
create index account_changes_user_kind on public.account_changes (user_id, kind, created_at);
alter table public.account_changes enable row level security;
revoke all on public.account_changes from public, anon, authenticated, service_role;

-- Called by the server once the current password is checked, before Supabase Auth is asked: counts
-- the changes of the last 24 hours (and forgets older ones), refuses the 4th.
create function public.claim_account_change(p_kind text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('password', 'email') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  -- One claim at a time per member: two tabs cannot both take the last place.
  perform pg_advisory_xact_lock(hashtextextended('account_changes:' || uid::text, 0));
  delete from public.account_changes where user_id = uid and created_at < now() - interval '1 day';
  if (select count(*) from public.account_changes where user_id = uid and kind = p_kind) >= 3 then
    raise exception 'too_many_changes' using errcode = 'P0001';
  end if;
  insert into public.account_changes (user_id, kind) values (uid, p_kind);
end;
$$;
revoke execute on function public.claim_account_change(text) from public, anon, authenticated, service_role;
grant execute on function public.claim_account_change(text) to authenticated;

---------------------------------------------------------------------------------------------------
-- 2. The address of an account
-- Reads the banned fingerprints whatever the caller's rights (the Auth service, the server).
create function private.email_is_banned(p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.banned_email_hashes b
    where b.hash = public.ban_email_hash(p_email) and b.expires_at > now())
$$;
revoke execute on function private.email_is_banned(text) from public, anon, authenticated;
grant execute on function private.email_is_banned(text) to supabase_auth_admin, service_role;

-- For the server, before asking Supabase Auth: a clear answer instead of its « database error ».
create function public.email_is_banned(p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.email_is_banned(p_email)
$$;
revoke execute on function public.email_is_banned(text) from public, anon, authenticated, service_role;
grant execute on function public.email_is_banned(text) to service_role;

-- Invoker rights on purpose (as the guards of 5a-ter): the owner check reads session_user and
-- current_user. Supabase Auth writes the requested address in email_change, then, once the links
-- are opened, moves it to email: both steps are checked.
create function public.guard_account_email()
returns trigger language plpgsql set search_path = '' as $$
begin
  if private.is_database_owner_session() then
    return new;
  end if;
  if (new.email_change is distinct from old.email_change and coalesce(new.email_change, '') <> '')
     or new.email is distinct from old.email then
    if private.is_super_admin_id(old.id) then
      raise exception 'super_admin_protected' using errcode = '42501';
    end if;
    if (new.email_change is distinct from old.email_change and coalesce(new.email_change, '') <> ''
        and private.email_is_banned(new.email_change))
       or (new.email is distinct from old.email and new.email is not null
           and private.email_is_banned(new.email)) then
      raise exception 'email_banned' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_account_email() from public, anon, authenticated, service_role;
create trigger account_email_guarded
  before update of email, email_change on auth.users
  for each row execute function public.guard_account_email();
