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
