-- 10a (owner's request 2026-11-06): « Vue Greffe ». From the admin (is_admin(): admin role and
-- second factor), the site seen as a Visitor, without a member profile, read only: the
-- Découverte (every visible Bad, no criteria, no quartier), the Promenade of the day of a quartier,
-- and each Fiche in full (3 poses, placard, Casier). Nothing is written about the Bads (no
-- request, no bet, no « seen », nothing in their views or statistics); the only write is the
-- Greffe's own log: which admin opened which Fiche, when. The true charge of the Casier is never
-- returned, not even to an admin (règle 14: the bet stays secret).

-- Which admin opened which Fiche, when. Read by nobody through the API (no grant); kept with the
-- Bad's account (deleted with it).
create table public.greffe_fiche_views (
  id bigint generated always as identity primary key,
  admin_id uuid not null,
  bad_id uuid not null references public.profiles (id) on delete cascade,
  viewed_at timestamptz not null default now()
);
create index greffe_fiche_views_bad on public.greffe_fiche_views (bad_id, viewed_at desc);
alter table public.greffe_fiche_views enable row level security;
revoke all on public.greffe_fiche_views from public, anon, authenticated;
comment on table public.greffe_fiche_views is
  'Vue Greffe (10a): which admin opened which Fiche, when. Written by admin_view_fiche only.';

-- Never changed once written (a deletion only comes with the Bad's account).
create function public.greffe_fiche_views_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'append_only' using errcode = '42501';
end;
$$;
revoke execute on function public.greffe_fiche_views_append_only() from public, anon, authenticated;
create trigger greffe_fiche_views_append_only
  before update on public.greffe_fiche_views
  for each row execute function public.greffe_fiche_views_append_only();

-- A Bad a Visitor could find, whatever the quartier: is_bad_visible() without its zone condition.
create function private.greffe_can_see(p public.profiles)
returns boolean language sql stable security definer set search_path = '' as $$
  select p.role = 'bad' and public.is_member_active(p) and not p.is_paused
    and p.last_seen_at >= now() - interval '90 days'
    and public.has_three_poses(p.id, true)
    and exists (select 1 from public.casier_charges c where c.profile_id = p.id)
$$;
revoke execute on function private.greffe_can_see(public.profiles) from public, anon, authenticated;

-- The Découverte as the Greffe: every visible Bad, newest first, in pages (keyset).
create function public.admin_view_discover(p_cursor_created timestamptz default null,
  p_cursor_id uuid default null, p_limit integer default 48)
returns table (id uuid, pseudo text, gender public.gender, age integer, city text, zone_name text,
  photo_small text, good_conduct boolean, requests_open boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select b.id, b.pseudo::text, b.gender, public.age_years(b.birthdate), public.place_name(b.place_id),
      z.name::text,
      (select ph.public_path_small from public.photos ph
        where ph.owner_id = b.id and ph.position = 0 and ph.status = 'approved'),
      b.is_reglo, b.requests_open and not b.is_paused, b.created_at
    from public.profiles b
    left join public.launch_zones z on z.id = b.zone_id
    where private.greffe_can_see(b)
      and (p_cursor_created is null
           or (b.created_at, b.id) < (p_cursor_created, coalesce(p_cursor_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by b.created_at desc, b.id desc
    limit least(greatest(coalesce(p_limit, 48), 1), 100);
end;
$$;

-- The Promenade of the day of a quartier: the Bads drawn today for its Visitors, each once, with
-- how many Visitors drew it and its best rank. Never who the Visitors are.
create function public.admin_view_promenade(p_zone smallint, p_date date default null)
returns table (id uuid, pseudo text, gender public.gender, age integer, city text,
  photo_small text, good_conduct boolean, best_rank smallint, visitors integer)
language plpgsql stable security definer set search_path = '' as $$
declare day date := coalesce(p_date, (now() at time zone 'Europe/Paris')::date);
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select b.id, b.pseudo::text, b.gender, public.age_years(b.birthdate), public.place_name(b.place_id),
      (select ph.public_path_small from public.photos ph
        where ph.owner_id = b.id and ph.position = 0 and ph.status = 'approved'),
      b.is_reglo, min(pp.rank)::smallint, count(distinct pp.visitor_id)::integer
    from public.promenade_picks pp
    join public.profiles b on b.id = pp.bad_id
    where pp.zone_id = p_zone and pp.promenade_date = day and private.greffe_can_see(b)
    group by b.id
    order by min(pp.rank), count(distinct pp.visitor_id) desc, b.pseudo;
end;
$$;

-- A Fiche in full, as a Visitor sees it, without anything that depends on a viewer (distance,
-- complicity, common points, request). Logs the consultation. Never the true charge.
create function public.admin_view_fiche(p_bad uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.profiles;
  c public.casier_charges;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into b from public.profiles where id = p_bad;
  if not found or not private.greffe_can_see(b) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into c from public.casier_charges where profile_id = p_bad;
  insert into public.greffe_fiche_views (admin_id, bad_id) values ((select auth.uid()), p_bad);
  return jsonb_build_object(
    'id', b.id,
    'ecrou', b.ecrou,
    'pseudo', b.pseudo,
    'gender', b.gender,
    'age', public.age_years(b.birthdate),
    'city', public.place_name(b.place_id),
    'distance_km', null,
    'seeking_genders', to_jsonb(b.seeking_genders),
    'seek_age_min', b.seek_age_min,
    'seek_age_max', b.seek_age_max,
    'on_file_since', to_char(b.created_at, 'YYYY-MM'),
    'photos', public.public_photos(b.id, array[0, 1, 2, 3, 4, 5]::smallint[]),
    'tribes', public.public_tribes(b.id),
    'charges', jsonb_build_array(c.charge_1, c.charge_2, c.charge_3),
    'casier_changed_since_request', false,
    'bio', b.bio,
    'good_conduct', b.is_reglo,
    'recruited', private.recruited_count(b.id),
    'requests_open', b.requests_open and not b.is_paused,
    'complicity', null,
    'common_points', '[]'::jsonb,
    'my_request_status', null,
    'cooldown_until', null
  );
end;
$$;

revoke execute on function public.admin_view_discover(timestamptz, uuid, integer) from public, anon, authenticated, service_role;
revoke execute on function public.admin_view_promenade(smallint, date) from public, anon, authenticated, service_role;
revoke execute on function public.admin_view_fiche(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_view_discover(timestamptz, uuid, integer) to authenticated;
grant execute on function public.admin_view_promenade(smallint, date) to authenticated;
grant execute on function public.admin_view_fiche(uuid) to authenticated;
