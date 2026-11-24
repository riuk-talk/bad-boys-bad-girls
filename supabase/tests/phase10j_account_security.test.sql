-- Phase 10j (pgTAP, owner's decision on question 10-22, 2026-11-24): changing one's password and
-- e-mail. The database guards (1) at most 3 changes of each kind a day per member, so that the
-- e-mails of Supabase Auth stay within the quota of Resend; (2) the address of an account: never a
-- banned one, never a new one for a super admin, whoever asks the Auth service; the database owner
-- is not concerned. The e-mails, the links and the
-- sessions are checked end to end by tests/e2e/account-security.spec.ts. Every test_* function
-- runs in its own rolled-back transaction.

create function pg_temp.new_user(p_email text default null) returns uuid language plpgsql as $$
declare uid uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    coalesce(p_email, uid || '@test.local'), '', now(), '{}', '{}', now(), now());
  return uid;
end $$;

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end $$;

create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
end $$;

-- A session that is not the database owner's, with the rights to write auth.users (the owner
-- cannot take the role of the Auth service here): an API role in the claims is enough for the
-- guard. The Auth service itself is checked end to end by the e2e journey.
create function pg_temp.as_auth() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
end $$;

create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('application_name', 'pgtap', true);
end $$;

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function pg_temp.ban(p_email text) returns void language plpgsql as $$
begin
  insert into public.banned_email_hashes (hash, expires_at)
  values (public.ban_email_hash(p_email), now() + interval '1 year');
end $$;

---------------------------------------------------------------------------------------------------
-- 1. The daily cap
create function pg_temp.test_cap_rights() returns setof text language plpgsql as $$
declare member uuid := pg_temp.new_user();
begin
  perform pg_temp.as_anon();
  return next matches(pg_temp.err('select public.claim_account_change(''password'')'), '^42501',
    'anonymous: refused');
  perform pg_temp.as_user(member);
  return next matches(pg_temp.err('select * from public.account_changes'), '^42501',
    'a member does not read the log');
  return next matches(pg_temp.err(format(
    'insert into public.account_changes (user_id, kind) values (%L, ''password'')', member)), '^42501',
    'nor writes it directly');
  return next matches(pg_temp.err('select public.claim_account_change(''role'')'), '^22023 invalid_kind',
    'an unknown kind is refused');
  return next matches(pg_temp.err('select public.claim_account_change(null)'), '^22023 invalid_kind',
    'no kind is refused');
  perform pg_temp.as_service();
  return next matches(pg_temp.err('select * from public.account_changes'), '^42501',
    'the secret key does not read it either');
  return next matches(pg_temp.err('select public.claim_account_change(''password'')'), '^42501',
    'nor claims (no member behind it)');
end $$;

create function pg_temp.test_cap_counts() returns setof text language plpgsql as $$
declare member uuid := pg_temp.new_user(); other uuid := pg_temp.new_user();
begin
  perform pg_temp.as_user(member);
  return next is(pg_temp.err('select public.claim_account_change(''password'')'), 'ok', '1st change');
  return next is(pg_temp.err('select public.claim_account_change(''password'')'), 'ok', '2nd change');
  return next is(pg_temp.err('select public.claim_account_change(''password'')'), 'ok', '3rd change');
  return next matches(pg_temp.err('select public.claim_account_change(''password'')'), '^P0001 too_many_changes',
    'the 4th in 24 hours is refused');
  return next is(pg_temp.err('select public.claim_account_change(''email'')'), 'ok',
    'each kind has its own count');
  perform pg_temp.as_user(other);
  return next is(pg_temp.err('select public.claim_account_change(''password'')'), 'ok',
    'each member has their own count');
  perform pg_temp.as_owner();
  update public.account_changes set created_at = now() - interval '25 hours'
  where user_id = member and kind = 'password';
  perform pg_temp.as_user(member);
  return next is(pg_temp.err('select public.claim_account_change(''password'')'), 'ok',
    'after 24 hours, the count starts again');
  perform pg_temp.as_owner();
  return next is((select count(*)::integer from public.account_changes where user_id = member and kind = 'password'),
    1, 'and the old changes are forgotten');
end $$;

---------------------------------------------------------------------------------------------------
-- 2. The address of an account
create function pg_temp.test_banned_lookup() returns setof text language plpgsql as $$
declare member uuid := pg_temp.new_user();
begin
  perform pg_temp.ban('Banni@Example.com ');
  perform pg_temp.as_service();
  return next ok(public.email_is_banned('banni@example.com'), 'the server sees a banned address (any case, any spaces)');
  return next ok(not public.email_is_banned('libre@example.com'), 'and a free one');
  perform pg_temp.as_user(member);
  return next matches(pg_temp.err('select public.email_is_banned(''banni@example.com'')'), '^42501',
    'a member cannot ask');
  return next matches(pg_temp.err('select private.email_is_banned(''banni@example.com'')'), '^42501',
    'not even through private');
  perform pg_temp.as_anon();
  return next matches(pg_temp.err('select public.email_is_banned(''banni@example.com'')'), '^42501',
    'nor anonymous');
end $$;

create function pg_temp.test_guard_banned() returns setof text language plpgsql as $$
declare member uuid := pg_temp.new_user('membre@example.com');
begin
  perform pg_temp.ban('banni@example.com');
  return next is((select count(*)::integer from pg_trigger where tgrelid = 'auth.users'::regclass
    and tgname = 'account_email_guarded'), 1, 'auth.users carries the guard');
  perform pg_temp.as_auth();
  return next matches(pg_temp.err(format(
    'update auth.users set email_change = %L where id = %L', 'BANNI@example.com', member)),
    '^42501 email_banned', 'the Auth service cannot record a request for a banned address');
  return next matches(pg_temp.err(format(
    'update auth.users set email = %L where id = %L', 'banni@example.com', member)),
    '^42501 email_banned', 'nor make it the address of the account');
  return next is(pg_temp.err(format(
    'update auth.users set email_change = %L where id = %L', 'nouvelle@example.com', member)),
    'ok', 'a free address can be requested');
  return next is(pg_temp.err(format(
    'update auth.users set email = email_change, email_change = '''' where id = %L', member)),
    'ok', 'and becomes the address once confirmed');
  return next is(pg_temp.err(format(
    'update auth.users set last_sign_in_at = now() where id = %L', member)),
    'ok', 'the rest of the account is not concerned');
  perform pg_temp.as_owner();
  return next is((select email from auth.users where id = member), 'nouvelle@example.com', 'the address changed');
end $$;

create function pg_temp.test_guard_super_admin() returns setof text language plpgsql as $$
declare sa uuid := pg_temp.new_user('chef@example.com'); member uuid := pg_temp.new_user();
begin
  insert into public.super_admins (user_id) values (sa);
  perform pg_temp.as_auth();
  return next matches(pg_temp.err(format(
    'update auth.users set email_change = %L where id = %L', 'autre@example.com', sa)),
    '^42501 super_admin_protected', 'no change of address is recorded for a super admin');
  return next matches(pg_temp.err(format(
    'update auth.users set email = %L where id = %L', 'autre@example.com', sa)),
    '^42501 super_admin_protected', 'nor is their address changed');
  return next is(pg_temp.err(format(
    'update auth.users set email_change = %L where id = %L', 'autre@example.com', member)),
    'ok', 'a member can');
  return next is(pg_temp.err(format(
    'update auth.users set last_sign_in_at = now() where id = %L', sa)),
    'ok', 'the super admin still signs in');
  perform pg_temp.as_owner();
  return next is(pg_temp.err(format(
    'update auth.users set email = %L where id = %L', 'chef2@example.com', sa)),
    'ok', 'the database owner can (SQL Editor)');
end $$;

select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
