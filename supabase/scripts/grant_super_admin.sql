-- Grants the super admin role (Phase 5a-ter). Run BY HAND, as the database owner (postgres), in the
-- Supabase SQL editor. Nothing else can grant, remove or bypass this role (see the migration
-- 20261007100308_phase5a_ter_super_admin and its pgTAP tests).
--
-- 1. Sign up on the site with the super admin's e-mail and confirm it. Do NOT fill the onboarding:
--    a super admin has no profile (never a Bad or a Visitor, invisible everywhere).
-- 2. Copy the account id (Authentication > Users), put it below, run this file.
-- 3. Sign in: the site sends you to /admin, which asks you to set up the second factor (TOTP).
-- Idempotent. Refuses if the account does not exist or already has a profile.
do $$
declare
  target uuid := '00000000-0000-0000-0000-000000000000';
begin
  if not private.is_database_owner_session() then
    raise exception 'Refused: run this file as the database owner (SQL editor), not through the API.';
  end if;
  if not exists (select 1 from auth.users where id = target) then
    raise exception 'No account with id %: sign up and confirm the address first.', target;
  end if;
  if exists (select 1 from public.profiles where id = target) then
    raise exception 'Account % already has a profile: a super admin has none. Use another account.', target;
  end if;
  insert into public.super_admins (user_id, note) values (target, 'granted by hand')
  on conflict (user_id) do nothing;
  raise notice 'Super admin granted to %', target;
end;
$$;
