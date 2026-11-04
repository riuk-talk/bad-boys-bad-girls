-- UTILISÉ LE 2026-11-04, DEVENU INUTILE : phases 6 à 9 déjà en production. Ne pas relancer (voir README.md).
-- bad-boys-prod (hmmobtyherwuhrhymfbk). Script 7 sur 9, à lancer dans l'ordre, dans le SQL Editor.
-- Généré par scripts/build-prod-apply.mjs (ne pas modifier à la main). Une seule transaction :
-- en cas d'erreur, rien n'est appliqué ; relancer le même script après correction.
-- Migrations (texte exact des fichiers, puis leur ligne d'historique) :
--   20261020150000_phase8b_web_vitals.sql
--   20261020150100_phase8b_web_vitals_retention.sql
-- Contient un mot destructif (delete, drop ou truncate), dans : phase8b_web_vitals_retention. L'éditeur demandera une confirmation.

begin;

-- Garde : la base est à l'étape précédente, et ce script n'a pas déjà été lancé.
do $guard$
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261020140000') then
    raise exception 'étape précédente absente (20261020140000) : lancer les scripts dans l''ordre';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version >= '20261020150000') then
    raise exception 'déjà appliqué (20261020150000 ou plus récent présent)';
  end if;
end
$guard$;

-- ===== 20261020150000_phase8b_web_vitals.sql =====
-- Phase 8b: real Core Web Vitals (SPEC §18). /api/vitals adds each measure to a daily histogram:
-- page template, metric, bucket, count. No identifier, no IP, no user agent; kept 90 days (clean-up
-- in the next migration). The Greffe reads the 75th percentile per page and metric.

------------------------------------------------------------------------------------------------
-- 1. Histogram
------------------------------------------------------------------------------------------------
-- Buckets grow by 10 %: bucket b holds the values in [1.1^b, 1.1^(b+1)) (ms, CLS × 1000), so a
-- percentile is known within 5 %.
create table public.web_vitals_daily (
  day date not null,
  page text not null check (page in ('landing', 'promenade', 'decouverte', 'fiche', 'courrier', 'parloir', 'other')),
  metric text not null check (metric in ('LCP', 'CLS', 'INP')),
  bucket smallint not null check (bucket between 0 and 120),
  samples integer not null default 0 check (samples >= 0),
  primary key (day, page, metric, bucket)
);
alter table public.web_vitals_daily enable row level security;
revoke all on public.web_vitals_daily from public, anon, authenticated;

alter table public.app_settings add column web_vitals_daily_cap integer not null default 50000
  check (web_vitals_daily_cap between 0 and 1000000);

create function private.web_vital_bucket(p_metric text, p_value double precision)
returns smallint language sql immutable set search_path = '' as $$
  select least(120, floor(ln(greatest(1, case when p_metric = 'CLS' then p_value * 1000 else p_value end)) / ln(1.1)))::smallint
$$;
revoke execute on function private.web_vital_bucket(text, double precision) from public, anon, authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 2. Recording (route /api/vitals, secret key only)
------------------------------------------------------------------------------------------------
-- One measure. Unknown pages or metrics and implausible values are ignored; past the daily cap
-- (a flood would only bend the percentiles) nothing more is counted that day.
create function public.record_web_vital(p_page text, p_metric text, p_value double precision)
returns boolean language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Europe/Paris')::date;
begin
  if p_page not in ('landing', 'promenade', 'decouverte', 'fiche', 'courrier', 'parloir', 'other')
     or p_metric not in ('LCP', 'CLS', 'INP') or p_value is null or p_value < 0 or p_value = 'NaN'
     or (p_metric = 'CLS' and p_value > 10) or (p_metric <> 'CLS' and p_value > 60000) then
    return false;
  end if;
  if coalesce((select sum(w.samples) from public.web_vitals_daily w where w.day = today), 0)
     >= (select s.web_vitals_daily_cap from public.app_settings s where s.id) then
    return false;
  end if;
  insert into public.web_vitals_daily (day, page, metric, bucket, samples)
  values (today, p_page, p_metric, private.web_vital_bucket(p_metric, p_value), 1)
  on conflict (day, page, metric, bucket) do update set samples = public.web_vitals_daily.samples + 1;
  return true;
end;
$$;

------------------------------------------------------------------------------------------------
-- 3. Reading (the Greffe)
------------------------------------------------------------------------------------------------
-- 75th percentile per page and metric over the last p_days days (1 to 90): the middle of the bucket
-- where the cumulated count reaches 75 %.
create function public.admin_web_vitals(p_days integer default 28)
returns table (page text, metric text, samples bigint, p75 double precision)
language plpgsql stable security definer set search_path = '' as $$
declare since date := (now() at time zone 'Europe/Paris')::date - (least(greatest(coalesce(p_days, 28), 1), 90) - 1);
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    with h as (
      select w.page, w.metric, w.bucket, sum(w.samples)::bigint as n
      from public.web_vitals_daily w where w.day >= since
      group by w.page, w.metric, w.bucket
    ), c as (
      select h.*, sum(h.n) over (partition by h.page, h.metric order by h.bucket) as running,
        sum(h.n) over (partition by h.page, h.metric) as total
      from h
    )
    select c.page, c.metric, max(c.total)::bigint,
      (select (power(1.1, c2.bucket + 0.5) / case when c2.metric = 'CLS' then 1000 else 1 end)::double precision
       from c c2 where c2.page = c.page and c2.metric = c.metric and c2.running >= 0.75 * c2.total
       order by c2.bucket limit 1)
    from c group by c.page, c.metric
    order by c.page, c.metric;
end;
$$;

------------------------------------------------------------------------------------------------
-- 4. Rights
------------------------------------------------------------------------------------------------
revoke execute on function public.record_web_vital(text, text, double precision), public.admin_web_vitals(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.record_web_vital(text, text, double precision) to service_role;
grant execute on function public.admin_web_vitals(integer) to authenticated;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261020150000', 'phase8b_web_vitals', array[$mig$-- Phase 8b: real Core Web Vitals (SPEC §18). /api/vitals adds each measure to a daily histogram:
-- page template, metric, bucket, count. No identifier, no IP, no user agent; kept 90 days (clean-up
-- in the next migration). The Greffe reads the 75th percentile per page and metric.

------------------------------------------------------------------------------------------------
-- 1. Histogram
------------------------------------------------------------------------------------------------
-- Buckets grow by 10 %: bucket b holds the values in [1.1^b, 1.1^(b+1)) (ms, CLS × 1000), so a
-- percentile is known within 5 %.
create table public.web_vitals_daily (
  day date not null,
  page text not null check (page in ('landing', 'promenade', 'decouverte', 'fiche', 'courrier', 'parloir', 'other')),
  metric text not null check (metric in ('LCP', 'CLS', 'INP')),
  bucket smallint not null check (bucket between 0 and 120),
  samples integer not null default 0 check (samples >= 0),
  primary key (day, page, metric, bucket)
);
alter table public.web_vitals_daily enable row level security;
revoke all on public.web_vitals_daily from public, anon, authenticated;

alter table public.app_settings add column web_vitals_daily_cap integer not null default 50000
  check (web_vitals_daily_cap between 0 and 1000000);

create function private.web_vital_bucket(p_metric text, p_value double precision)
returns smallint language sql immutable set search_path = '' as $$
  select least(120, floor(ln(greatest(1, case when p_metric = 'CLS' then p_value * 1000 else p_value end)) / ln(1.1)))::smallint
$$;
revoke execute on function private.web_vital_bucket(text, double precision) from public, anon, authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 2. Recording (route /api/vitals, secret key only)
------------------------------------------------------------------------------------------------
-- One measure. Unknown pages or metrics and implausible values are ignored; past the daily cap
-- (a flood would only bend the percentiles) nothing more is counted that day.
create function public.record_web_vital(p_page text, p_metric text, p_value double precision)
returns boolean language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Europe/Paris')::date;
begin
  if p_page not in ('landing', 'promenade', 'decouverte', 'fiche', 'courrier', 'parloir', 'other')
     or p_metric not in ('LCP', 'CLS', 'INP') or p_value is null or p_value < 0 or p_value = 'NaN'
     or (p_metric = 'CLS' and p_value > 10) or (p_metric <> 'CLS' and p_value > 60000) then
    return false;
  end if;
  if coalesce((select sum(w.samples) from public.web_vitals_daily w where w.day = today), 0)
     >= (select s.web_vitals_daily_cap from public.app_settings s where s.id) then
    return false;
  end if;
  insert into public.web_vitals_daily (day, page, metric, bucket, samples)
  values (today, p_page, p_metric, private.web_vital_bucket(p_metric, p_value), 1)
  on conflict (day, page, metric, bucket) do update set samples = public.web_vitals_daily.samples + 1;
  return true;
end;
$$;

------------------------------------------------------------------------------------------------
-- 3. Reading (the Greffe)
------------------------------------------------------------------------------------------------
-- 75th percentile per page and metric over the last p_days days (1 to 90): the middle of the bucket
-- where the cumulated count reaches 75 %.
create function public.admin_web_vitals(p_days integer default 28)
returns table (page text, metric text, samples bigint, p75 double precision)
language plpgsql stable security definer set search_path = '' as $$
declare since date := (now() at time zone 'Europe/Paris')::date - (least(greatest(coalesce(p_days, 28), 1), 90) - 1);
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    with h as (
      select w.page, w.metric, w.bucket, sum(w.samples)::bigint as n
      from public.web_vitals_daily w where w.day >= since
      group by w.page, w.metric, w.bucket
    ), c as (
      select h.*, sum(h.n) over (partition by h.page, h.metric order by h.bucket) as running,
        sum(h.n) over (partition by h.page, h.metric) as total
      from h
    )
    select c.page, c.metric, max(c.total)::bigint,
      (select (power(1.1, c2.bucket + 0.5) / case when c2.metric = 'CLS' then 1000 else 1 end)::double precision
       from c c2 where c2.page = c.page and c2.metric = c.metric and c2.running >= 0.75 * c2.total
       order by c2.bucket limit 1)
    from c group by c.page, c.metric
    order by c.page, c.metric;
end;
$$;

------------------------------------------------------------------------------------------------
-- 4. Rights
------------------------------------------------------------------------------------------------
revoke execute on function public.record_web_vital(text, text, double precision), public.admin_web_vitals(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.record_web_vital(text, text, double precision) to service_role;
grant execute on function public.admin_web_vitals(integer) to authenticated;
$mig$]);

-- ===== 20261020150100_phase8b_web_vitals_retention.sql =====
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

-- Empreintes (sans les blancs) : colonne attendu = colonne base.
select m.version, m.name, x.expected as attendu, md5(regexp_replace(array_to_string(m.statements, ';'), '\s', '', 'g')) as base
from supabase_migrations.schema_migrations m
join (values
  ('20261020150000', '9e553f0d2842117c72fc2f5b74ca569d'),
  ('20261020150100', 'c27d684f3fb884188871c2acd2f260fa')
) as x (version, expected) on x.version = m.version
order by m.version;
