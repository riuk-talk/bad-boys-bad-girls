-- bad-boys-preview (chvnmzmvcjvhxlnfmlvv) seulement. Applique la migration
-- 20261020150100_phase8b_web_vitals_retention.sql (texte exact du fichier), puis enregistre sa ligne
-- d'historique. Elle redéfinit public.cleanup_rows (mot destructif : le connecteur la refuse).
-- ORDRE : APRÈS 5-fix-indentation.sql, qui remet cleanup_rows dans sa version 7c.
-- À lancer avec psql, qui envoie le texte tel quel (pas par copier-coller dans l'éditeur) :
--   psql "<chaîne de connexion de bad-boys-preview>" -v ON_ERROR_STOP=1 -f 6-phase8b-retention.sql
-- Empreintes attendues (dernière requête) : historique ded19f2b86f2c62b872c4e13d09ae8cd, corps de cleanup_rows 34f4e385ae0099f9bea0d596aef27446.

begin;

-- Phase 8b: the Core Web Vitals histogram is kept 90 days (SPEC §18), by the daily clean-up of
-- Phase 7c. Same function otherwise.
create or replace function public.cleanup_rows()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pushes integer; emails integer; hashes integer; days integer; vitals integer;
begin
  delete from public.push_outbox where status in ('sent', 'failed', 'skipped') and created_at < now() - interval '30 days';
  get diagnostics pushes = row_count;
  delete from public.email_outbox where status in ('sent', 'failed', 'skipped') and created_at < now() - interval '30 days';
  get diagnostics emails = row_count;
  delete from public.banned_email_hashes where expires_at < now();
  get diagnostics hashes = row_count;
  delete from public.activity_days where day < current_date - 400;
  get diagnostics days = row_count;
  delete from public.web_vitals_daily where day < (now() at time zone 'Europe/Paris')::date - 89;
  get diagnostics vitals = row_count;
  return jsonb_build_object('push_outbox', pushes, 'email_outbox', emails, 'banned_email_hashes', hashes,
    'activity_days', days, 'web_vitals_daily', vitals);
end;
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261020150100', 'phase8b_web_vitals_retention', array[$mig$-- Phase 8b: the Core Web Vitals histogram is kept 90 days (SPEC §18), by the daily clean-up of
-- Phase 7c. Same function otherwise.
create or replace function public.cleanup_rows()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pushes integer; emails integer; hashes integer; days integer; vitals integer;
begin
  delete from public.push_outbox where status in ('sent', 'failed', 'skipped') and created_at < now() - interval '30 days';
  get diagnostics pushes = row_count;
  delete from public.email_outbox where status in ('sent', 'failed', 'skipped') and created_at < now() - interval '30 days';
  get diagnostics emails = row_count;
  delete from public.banned_email_hashes where expires_at < now();
  get diagnostics hashes = row_count;
  delete from public.activity_days where day < current_date - 400;
  get diagnostics days = row_count;
  delete from public.web_vitals_daily where day < (now() at time zone 'Europe/Paris')::date - 89;
  get diagnostics vitals = row_count;
  return jsonb_build_object('push_outbox', pushes, 'email_outbox', emails, 'banned_email_hashes', hashes,
    'activity_days', days, 'web_vitals_daily', vitals);
end;
$$;
$mig$]);

commit;

select (select md5(array_to_string(statements, ';')) from supabase_migrations.schema_migrations
        where version = '20261020150100') as md5_statements,
  (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cleanup_rows') as md5_cleanup_rows;
