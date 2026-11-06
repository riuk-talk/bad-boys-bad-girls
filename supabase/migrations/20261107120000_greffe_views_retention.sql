-- 10a, decision 10-3 (validated by the adviser on 2026-11-06): the Greffe's log of the Fiches
-- opened (greffe_fiche_views) is kept 12 months, then erased by the daily clean-up of Phase 7c
-- (duration to be confirmed by the lawyer, like the others). Same function otherwise.
create or replace function public.cleanup_rows()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pushes integer; emails integer; hashes integer; days integer; vitals integer; views integer;
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
  delete from public.greffe_fiche_views where viewed_at < now() - interval '12 months';
  get diagnostics views = row_count;
  return jsonb_build_object('push_outbox', pushes, 'email_outbox', emails, 'banned_email_hashes', hashes,
    'activity_days', days, 'web_vitals_daily', vitals, 'greffe_fiche_views', views);
end;
$$;
