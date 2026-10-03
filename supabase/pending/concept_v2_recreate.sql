-- Concept v2 (SPEC v7, SCHEMA v2 §6), part 3: objects dropped and recreated.
-- zone_progress() changes its result columns (Postgres requires drop + create); the zone threshold
-- in Fiches is replaced by threshold_bads (part 2); is_complete_fiche() by counts_for_zone().

alter table public.profiles drop constraint profiles_onboarding_step_check;
alter table public.profiles add constraint profiles_onboarding_step_check check (onboarding_step between 0 and 7);

drop index public.profiles_discovery;
create index profiles_discovery on public.profiles (zone_id, role, moderation_status, is_paused)
  where onboarding_completed_at is not null and banned_at is null and hidden_reason is null;

drop trigger profiles_after_write on public.profiles;
create trigger profiles_after_write
  after insert or update of pseudo, bio, visit_motive on public.profiles
  for each row execute function public.profiles_after_write();

alter table public.launch_zones drop column threshold_profiles;

drop function public.zone_progress();
drop function public.is_complete_fiche(public.profiles);

-- Gauge of the caller's zone ("Ton quartier ouvre bientôt", SPEC §3): absolute floors of bad girls
-- and bad boys; the number of Visitors waiting is only given to Bads.
create function public.zone_progress()
returns table (
  zone_id smallint, zone_name text, status public.zone_status, launch_mode public.launch_mode,
  bads integer, threshold_bads integer, bad_girls integer, min_bad_girls integer,
  bad_boys integer, min_bad_boys integer, visitors_waiting integer, ready boolean
) language sql stable security definer set search_path = '' as $$
  with zone as (
    select z.id, z.name, z.status, s.launch_mode, z.threshold_bads,
      ceil(z.threshold_bads * z.threshold_women_pct / 100.0)::integer as min_girls,
      ceil(z.threshold_bads * z.threshold_men_pct / 100.0)::integer as min_boys,
      me.role as my_role
    from public.profiles me
    join public.launch_zones z on z.id = me.zone_id
    cross join public.app_settings s
    where me.id = (select auth.uid())
  ), bads as (
    select count(*)::integer as total,
      (count(*) filter (where p.gender = 'woman'))::integer as girls,
      (count(*) filter (where p.gender = 'man'))::integer as boys
    from zone join public.profiles p on p.zone_id = zone.id
    where public.counts_for_zone(p)
  ), visitors as (
    select count(*)::integer as waiting
    from zone join public.profiles p on p.zone_id = zone.id
    where p.role = 'visitor' and p.onboarding_completed_at is not null and p.banned_at is null
      and p.hidden_reason is null and not p.is_seed
      and exists (select 1 from public.photos ph
                  where ph.owner_id = p.id and ph.position = 0 and ph.status = 'approved')
  )
  select zone.id, zone.name, zone.status, zone.launch_mode,
    bads.total, zone.threshold_bads, bads.girls, zone.min_girls, bads.boys, zone.min_boys,
    case when zone.my_role = 'bad' then visitors.waiting end,
    bads.total >= zone.threshold_bads and bads.girls >= zone.min_girls and bads.boys >= zone.min_boys
  from zone, bads, visitors
$$;

revoke execute on function public.zone_progress() from public, anon;
grant execute on function public.zone_progress() to authenticated;
