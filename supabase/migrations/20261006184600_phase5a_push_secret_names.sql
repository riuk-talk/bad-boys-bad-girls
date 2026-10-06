-- Option A (Chris, 2026-10-06): the VAPID private key is a Vercel environment variable and never
-- goes in the Vault, which holds only what pg_net needs (endpoint URL, route secret, preview
-- bypass token). Restores the three names of phase5a_web_push.
create or replace function public.set_push_secret(p_name text, p_value text)
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

revoke execute on function public.set_push_secret(text, text) from public, anon, authenticated;
grant execute on function public.set_push_secret(text, text) to service_role;
