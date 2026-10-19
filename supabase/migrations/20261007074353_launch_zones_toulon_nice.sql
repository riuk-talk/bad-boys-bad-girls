-- The two launch quartiers (Toulon, Nice), until now created by hand on the dev project only.
-- Idempotent: nothing is overwritten where they (or their centre communes) already exist.
-- The centre communes come with them, so that a fresh database (local stack, CI, the future
-- production base) has the quartiers before any commune import. Source of the two communes:
-- geo.api.gouv.fr (Licence Ouverte Etalab), same values as supabase/fixtures/places-83-06.sql.
insert into public.places (country_code, official_code, name, postal_codes, lat, lng, population)
values
  ('FR', '83137', 'Toulon', array['83000', '83100', '83200']::text[], 43.1364, 5.9334, 179116),
  ('FR', '06088', 'Nice', array['06000', '06100', '06200', '06300']::text[], 43.7032, 7.2528, 357737)
on conflict (country_code, official_code) do nothing;

insert into public.launch_zones (slug, name, center_place_id, radius_km, timezone, status,
  threshold_bads, threshold_men_pct, threshold_women_pct, auto_open)
select z.slug, z.name, p.id, 35, 'Europe/Paris', 'waitlist', 50, 20, 40, false
from (values ('toulon', 'Toulon', '83137'), ('nice', 'Nice', '06088')) as z (slug, name, code)
join public.places p on p.country_code = 'FR' and p.official_code = z.code
on conflict (slug) do nothing;
