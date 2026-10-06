-- Phase 5a (bis): the route's two secrets live only in the Vault.
-- push_cron_secret is already there (pg_net sends it); keeping a second copy in Vercel could
-- drift. The VAPID private key joins it. The route (secret key only) reads the private key and
-- a SHA-256 digest of the shared secret, never the secret itself.

create or replace function public.set_push_secret(p_name text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare existing uuid;
begin
  if p_name not in ('push_endpoint_url', 'push_cron_secret', 'vercel_protection_bypass', 'vapid_private_key') then
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

create function public.push_route_config()
returns table (cron_secret_sha256 text, vapid_private_key text)
language sql security definer set search_path = '' stable as $$
  select
    (select encode(sha256(convert_to(ds.decrypted_secret, 'UTF8')), 'hex')
     from vault.decrypted_secrets ds where ds.name = 'push_cron_secret'),
    (select ds.decrypted_secret from vault.decrypted_secrets ds where ds.name = 'vapid_private_key')
$$;

revoke execute on function public.push_route_config() from public, anon, authenticated;
grant execute on function public.push_route_config() to service_role;
