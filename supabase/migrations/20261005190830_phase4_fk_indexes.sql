-- Phase 4a: indexes for the new foreign keys (performance advisor). The hourly Promenade job
-- looks picks up by zone and date.
create index promenade_picks_zone_date on public.promenade_picks (zone_id, promenade_date);
create index moderation_actions_report on public.moderation_actions (report_id);
