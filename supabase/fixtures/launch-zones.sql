-- Launch zones (Quartiers) for the LOCAL stack only (supabase start, CI): the same two as on the
-- dev project, created there by hand (no migration holds them). Loaded after places-83-06.sql.
insert into public.launch_zones (slug, name, center_place_id, radius_km, status)
select z.slug, z.name, p.id, 35, 'waitlist'
from (values ('toulon', 'Toulon', '83137'), ('nice', 'Nice', '06088')) as z (slug, name, code)
join public.places p on p.country_code = 'FR' and p.official_code = z.code
on conflict (slug) do nothing;
