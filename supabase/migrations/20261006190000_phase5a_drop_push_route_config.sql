-- Option A (Chris, 2026-10-06): the route reads its secrets from Vercel environment variables.
-- push_route_config() (phase5a_push_vault_reads) is unused and read a Vault name that is now
-- refused; it is removed so no service_role path into the Vault is left behind.
drop function if exists public.push_route_config();
