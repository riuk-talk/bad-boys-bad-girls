-- Creates the first administrator (SPEC §10: admin_users is never writable by members).
-- 1. Sign up on the site with the future admin's e-mail and confirm it.
-- 2. In the Supabase SQL editor (or with the CLI), replace the e-mail below and run this file.
-- Idempotent. Refuses if the account does not exist.
do $$
declare
  target_email text := 'admin@[DOMAINE]';
  target uuid;
begin
  select id into target from auth.users where lower(email) = lower(target_email);
  if target is null then
    raise exception 'No account with e-mail %: sign up and confirm the address first.', target_email;
  end if;
  insert into public.admin_users (user_id, note) values (target, 'first admin')
  on conflict (user_id) do nothing;
  raise notice 'Admin granted to %', target_email;
end;
$$;
