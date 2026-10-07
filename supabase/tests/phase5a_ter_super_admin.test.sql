-- Phase 5a-ter (pgTAP): the super admin cannot be deleted, demoted, banned, suspended or given a
-- profile by anyone but the database owner — not by themself, not by another admin, not by the
-- secret key, not through a security definer function, not by a scheduled job.
-- Every test_* function runs in its own rolled-back transaction (runtests), so nothing persists.
-- The Auth service itself (session supabase_auth_admin) is checked end to end against the local
-- stack by tests/e2e/super-admin.spec.ts (deleteUser, ban_duration).

----------------------------------------------------------------------------------------------
-- Helpers
----------------------------------------------------------------------------------------------
create function pg_temp.new_user(p_email text) returns uuid language plpgsql as $$
declare uid uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', p_email, '',
    now(), '{}', '{}', now(), now());
  return uid;
end $$;

create function pg_temp.new_super_admin() returns uuid language plpgsql as $$
declare uid uuid := pg_temp.new_user('super@test.local');
begin
  insert into public.super_admins (user_id, note) values (uid, 'test');
  return uid;
end $$;

create function pg_temp.new_admin() returns uuid language plpgsql as $$
declare uid uuid := pg_temp.new_user('admin@test.local');
begin
  insert into public.admin_users (user_id, note) values (uid, 'test');
  return uid;
end $$;

-- A signed-in account, with or without the second factor.
create function pg_temp.as_user(p_uid uuid, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, true);
  execute 'set local role authenticated';
end $$;

-- The secret key (server side of the site).
create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
end $$;

create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('application_name', 'pgtap', true);
end $$;

-- A scheduled job: same owner role, but run by pg_cron.
create function pg_temp.as_cron() returns void language plpgsql as $$
begin
  perform pg_temp.as_owner();
  perform set_config('application_name', 'pg_cron', true);
end $$;

create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- Any security definer function owned by the owner, called by a member: current_user is the
-- owner there, which must not be enough.
create function pg_temp.definer(p_sql text) returns void language plpgsql security definer as $$
begin
  execute p_sql;
end $$;
grant execute on function pg_temp.definer(text) to authenticated, service_role;

create function pg_temp.refused(p_sql text) returns text language plpgsql as $$
begin
  return coalesce(pg_temp.try(p_sql), 'ok');
end $$;

----------------------------------------------------------------------------------------------
-- Structure
----------------------------------------------------------------------------------------------
create function pg_temp.test_super_admin_structure() returns setof text language plpgsql as $$
begin
  return next ok((select relrowsecurity from pg_class where oid = 'public.super_admins'::regclass),
    'RLS is on for super_admins');
  return next ok(not has_table_privilege('anon', 'public.super_admins', 'select,insert,update,delete')
    and not has_table_privilege('authenticated', 'public.super_admins', 'select,insert,update,delete')
    and not has_table_privilege('service_role', 'public.super_admins', 'select,insert,update,delete'),
    'no role but the owner has any right on super_admins');
  return next hasnt_function('public', 'is_super_admin_id', 'the lookup is not in the API schema');
  return next ok(not has_schema_privilege('anon', 'private', 'usage'), 'anon cannot use schema private');
  return next is((select count(*)::integer from pg_trigger where tgrelid = 'auth.users'::regclass
    and tgname = 'super_admin_account_protected'), 1, 'auth.users carries the guard');
  return next ok(has_function_privilege('authenticated', 'public.my_admin_role()', 'execute')
    and not has_function_privilege('anon', 'public.my_admin_role()', 'execute'),
    'members (not anon) can ask their own admin role');
end $$;

----------------------------------------------------------------------------------------------
-- Granting the role: the owner only
----------------------------------------------------------------------------------------------
create function pg_temp.test_super_admin_grant_owner_only() returns setof text language plpgsql as $$
declare
  m uuid := pg_temp.new_user('member@test.local');
  adm uuid := pg_temp.new_admin();
  sql text;
begin
  sql := format('insert into public.super_admins (user_id) values (%L)', m);
  perform pg_temp.as_user(m, 'aal2');
  return next matches(pg_temp.refused(sql), '^42501', 'a member cannot make themself super admin');
  return next matches(pg_temp.refused(format('select pg_temp.definer(%L)', sql)), '^42501',
    'not even through a security definer function');
  perform pg_temp.as_user(adm, 'aal2');
  return next matches(pg_temp.refused(format('select pg_temp.definer(%L)', sql)), '^42501',
    'an admin cannot grant it');
  perform pg_temp.as_service();
  return next matches(pg_temp.refused(sql), '^42501', 'the secret key cannot grant it');
  perform pg_temp.as_cron();
  return next matches(pg_temp.refused(sql), 'super_admin_protected', 'a scheduled job cannot grant it');
  perform pg_temp.as_owner();
  return next is(pg_temp.try(sql), null, 'the owner grants it');
end $$;

----------------------------------------------------------------------------------------------
-- Taking the role away
----------------------------------------------------------------------------------------------
create function pg_temp.test_super_admin_role_cannot_be_removed() returns setof text language plpgsql as $$
declare
  sa uuid := pg_temp.new_super_admin();
  adm uuid := pg_temp.new_admin();
  del text := format('delete from public.super_admins where user_id = %L', sa);
  upd text := format('update public.super_admins set note = ''demoted'' where user_id = %L', sa);
begin
  perform pg_temp.as_user(sa, 'aal2');
  return next matches(pg_temp.refused(format('select pg_temp.definer(%L)', del)), 'super_admin_protected',
    'the super admin cannot remove their own role');
  perform pg_temp.as_user(adm, 'aal2');
  return next matches(pg_temp.refused(format('select pg_temp.definer(%L)', del)), 'super_admin_protected',
    'another admin cannot remove it');
  return next matches(pg_temp.refused(format('select pg_temp.definer(%L)', upd)), 'super_admin_protected',
    'nor change it');
  perform pg_temp.as_service();
  return next matches(pg_temp.refused(del), '^42501', 'the secret key cannot remove it');
  perform pg_temp.as_cron();
  return next matches(pg_temp.refused(del), 'super_admin_protected', 'a scheduled job cannot remove it');
  return next matches(pg_temp.refused('truncate public.super_admins'), 'super_admin_protected',
    'nor empty the table');
  perform pg_temp.as_owner();
  return next is((select count(*)::integer from public.super_admins where user_id = sa), 1, 'the role is still there');
  return next is(pg_temp.try(del), null, 'the owner can remove it');
end $$;

----------------------------------------------------------------------------------------------
-- Deleting the account (auth.users), hard or soft
----------------------------------------------------------------------------------------------
create function pg_temp.test_super_admin_account_cannot_be_deleted() returns setof text language plpgsql as $$
declare
  sa uuid := pg_temp.new_super_admin();
  adm uuid := pg_temp.new_admin();
  other uuid := pg_temp.new_user('other@test.local');
  del text := format('delete from auth.users where id = %L', sa);
  soft text := format('update auth.users set deleted_at = now() where id = %L', sa);
begin
  perform pg_temp.as_user(sa, 'aal2');
  return next matches(pg_temp.refused(format('select pg_temp.definer(%L)', del)), 'super_admin_protected',
    'the super admin cannot delete their own account');
  perform pg_temp.as_user(adm, 'aal2');
  return next matches(pg_temp.refused(format('select pg_temp.definer(%L)', del)), 'super_admin_protected',
    'another admin cannot delete it');
  return next matches(pg_temp.refused(format('select pg_temp.definer(%L)', soft)), 'super_admin_protected',
    'nor soft-delete it');
  perform pg_temp.as_service();
  return next matches(pg_temp.refused(del), '^42501', 'the secret key cannot delete it');
  perform pg_temp.as_cron();
  return next matches(pg_temp.refused(del), 'super_admin_protected', 'a scheduled job cannot delete it');
  perform pg_temp.as_owner();
  return next is((select count(*)::integer from auth.users where id = sa), 1, 'the account is still there');
  -- Control: the guard concerns the super admin only.
  perform pg_temp.as_user(adm, 'aal2');
  return next is(pg_temp.try(format('select pg_temp.definer(%L)',
    format('delete from auth.users where id = %L', other))), null, 'other accounts are not concerned');
  perform pg_temp.as_owner();
  return next is(pg_temp.try(format('delete from public.super_admins where user_id = %L', sa)), null,
    'the owner first removes the role');
  return next is(pg_temp.try(del), null, 'then can delete the account');
end $$;

----------------------------------------------------------------------------------------------
-- Banning (auth ban, e-mail fingerprint)
----------------------------------------------------------------------------------------------
create function pg_temp.test_super_admin_cannot_be_banned() returns setof text language plpgsql as $$
declare
  sa uuid := pg_temp.new_super_admin();
  adm uuid := pg_temp.new_admin();
  ban text := format('update auth.users set banned_until = now() + interval ''100 years'' where id = %L', sa);
  hash text := format('insert into public.banned_email_hashes (hash, expires_at) values (public.ban_email_hash(%L), now() + interval ''1 year'')',
    'SUPER@test.local ');
begin
  perform pg_temp.as_user(sa, 'aal2');
  return next matches(pg_temp.refused(format('select pg_temp.definer(%L)', ban)), 'super_admin_protected',
    'the super admin cannot ban themself');
  perform pg_temp.as_user(adm, 'aal2');
  return next matches(pg_temp.refused(format('select pg_temp.definer(%L)', ban)), 'super_admin_protected',
    'another admin cannot ban them');
  return next matches(pg_temp.refused(format('select pg_temp.definer(%L)', hash)), 'super_admin_protected',
    'nor ban their e-mail (any case, any spaces)');
  return next is(pg_temp.try(format('select pg_temp.definer(%L)',
    'insert into public.banned_email_hashes (hash, expires_at) values (public.ban_email_hash(''someone@test.local''), now() + interval ''1 year'')')),
    null, 'other e-mails can still be banned');
  perform pg_temp.as_cron();
  return next matches(pg_temp.refused(ban), 'super_admin_protected', 'a scheduled job cannot ban them');
  perform pg_temp.as_owner();
  return next is((select banned_until from auth.users where id = sa), null, 'the account is not banned');
end $$;

----------------------------------------------------------------------------------------------
-- No profile: never a Bad or a Visitor, invisible, nothing to suspend or hide
----------------------------------------------------------------------------------------------
create function pg_temp.test_super_admin_has_no_profile() returns setof text language plpgsql as $$
declare
  sa uuid := pg_temp.new_super_admin();
  adm uuid := pg_temp.new_admin();
  ins text := format('insert into public.profiles (id, pseudo, birthdate, gender, seeking_genders) values (%L, ''Superviseur'', ''1980-01-01'', ''man'', ''{woman}'')', sa);
begin
  perform pg_temp.as_user(sa, 'aal2');
  return next matches(pg_temp.refused(ins), '^42501', 'the super admin cannot create a profile (onboarding)');
  perform pg_temp.as_user(adm, 'aal2');
  return next matches(pg_temp.refused(format('select pg_temp.definer(%L)', ins)), 'super_admin_protected',
    'nor can another admin create one for them');
  perform pg_temp.as_service();
  return next matches(pg_temp.refused(ins), '^42501', 'nor the secret key');
  perform pg_temp.as_owner();
  return next is((select count(*)::integer from public.profiles where id = sa), 0, 'no profile, so invisible everywhere');
  -- A profile the owner would have left there still cannot be suspended, hidden or banned.
  perform pg_temp.try(ins);
  perform pg_temp.as_user(adm, 'aal2');
  return next matches(pg_temp.refused(format('select pg_temp.definer(%L)',
    format('update public.profiles set suspended_until = now() + interval ''7 days'' where id = %L', sa))),
    'super_admin_protected', 'an admin cannot suspend them');
  return next matches(pg_temp.refused(format('select pg_temp.definer(%L)',
    format('update public.profiles set banned_at = now() where id = %L', sa))),
    'super_admin_protected', 'nor ban them through the profile');
  return next matches(pg_temp.refused(format('select pg_temp.definer(%L)',
    format('delete from public.profiles where id = %L', sa))),
    'super_admin_protected', 'nor delete that profile');
end $$;

----------------------------------------------------------------------------------------------
-- Admin rights need the second factor; the role can be read by its holder only
----------------------------------------------------------------------------------------------
create function pg_temp.test_super_admin_needs_aal2() returns setof text language plpgsql as $$
declare
  sa uuid := pg_temp.new_super_admin();
  adm uuid := pg_temp.new_admin();
  m uuid := pg_temp.new_user('member@test.local');
begin
  perform pg_temp.as_user(sa, 'aal1');
  return next is(public.is_admin(), false, 'super admin without the second factor: no admin rights');
  return next is(public.my_admin_role(), 'super_admin', 'but knows the role (to be sent to /admin)');
  perform pg_temp.as_user(sa, 'aal2');
  return next is(public.is_admin(), true, 'super admin with the second factor: admin rights');
  perform pg_temp.as_user(adm, 'aal1');
  return next is(public.is_admin(), false, 'admin without the second factor: no admin rights');
  return next is(public.my_admin_role(), 'admin', 'role admin');
  perform pg_temp.as_user(m, 'aal2');
  return next is(public.is_admin(), false, 'a member is never admin');
  return next is(public.my_admin_role(), 'none', 'role none');
  perform pg_temp.as_owner();
end $$;

----------------------------------------------------------------------------------------------
select * from runtests(pg_my_temp_schema()::regnamespace::name, '^test_');
