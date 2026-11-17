-- 10f-bis (owner's request 2026-11-17): « Voir comme un Bad », beside « Voir comme un Visiteur »
-- (10a). Every Visitor whose Permis is delivered (no criteria, no quartier), each shown as the
-- Permis card a Bad reads in its Courrier, with filters gender, age, quartier. Read only: nothing
-- is written about the Visitors but the Greffe's own log (greffe_fiche_views, context
-- « vue_bad »: which admin saw which Permis, when). A new permission, vue_bad.view, ticked for the
-- three starting roles. Never more of a Visitor than the Courrier shows a Bad: no search
-- criteria; no distance, complicity nor common points (they only exist for a given Bad).
-- Also: the quartiers' names for the two views (admin_zone_names), which a role may read without
-- zones.edit (10f made admin_zones ask for it, and the Promenade of the Greffe view used it).

insert into public.admin_permissions (key, kind, position) values ('vue_bad.view', 'read', 18);
insert into public.admin_role_permissions (role_id, permission)
select r.id, 'vue_bad.view' from public.admin_roles r where r.id in (1, 2, 3)
on conflict do nothing;

alter table public.greffe_fiche_views drop constraint greffe_fiche_views_context_check;
alter table public.greffe_fiche_views
  add constraint greffe_fiche_views_context_check check (context in ('vue', 'member', 'vue_bad'));
comment on table public.greffe_fiche_views is
  'Which admin opened which Fiche (Vue Greffe, 10a), member record (Membres, 10d) or Permis (Voir comme un Bad, 10f-bis), when.';

-- The Visitors a Bad could receive a request from: Permis delivered (has_permit: an active
-- Visitor with its face photo validated), newest first, 24 a page; each one shown is logged.
create function public.admin_view_visitors(p_gender public.gender default null,
  p_age_min integer default null, p_age_max integer default null, p_zone smallint default null,
  p_page integer default 1)
returns table (id uuid, pseudo text, gender public.gender, age integer, city text, zone_name text,
  photo jsonb, motive text, tribes jsonb, clean_record boolean, visits_honored integer,
  visits_due integer, total bigint)
language plpgsql volatile security definer set search_path = '' as $$
declare
  page integer := greatest(coalesce(p_page, 1), 1);
  lo integer := greatest(coalesce(p_age_min, 18), 18);
  hi integer := least(coalesce(p_age_max, 99), 110);
begin
  if not public.has_admin_permission('vue_bad.view') then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    with shown as (
      select v.id, v.pseudo::text as pseudo, v.gender, public.age_years(v.birthdate) as age,
        public.place_name(v.place_id) as city, z.name::text as zone_name,
        (public.public_photos(v.id, array[0]::smallint[]) -> 0) as photo, v.visit_motive::text as visit_motive,
        public.public_tribes(v.id) as tribes, v.created_at,
        count(*) over () as total
      from public.profiles v
      left join public.launch_zones z on z.id = v.zone_id
      where v.role = 'visitor' and public.has_permit(v.id)
        and (p_gender is null or v.gender = p_gender)
        and public.age_years(v.birthdate) between lo and hi
        and (p_zone is null or v.zone_id = p_zone)
      order by v.created_at desc, v.id desc
      limit 24 offset (page - 1) * 24
    ), logged as (
      -- Executed once whatever reads it (a data-modifying WITH): one line per Permis shown.
      insert into public.greffe_fiche_views (admin_id, bad_id, context)
      select (select auth.uid()), s.id, 'vue_bad' from shown s
      returning 1
    )
    select s.id, s.pseudo, s.gender, s.age, s.city, s.zone_name, s.photo, s.visit_motive, s.tribes,
      r.clean_record, r.honored, r.due, s.total
    from shown s
    cross join lateral public.visitor_reputation(s.id) r
    order by s.created_at desc, s.id desc;
end;
$$;

-- The quartiers' names, for the filters of the two views (no figures, no settings).
create function public.admin_zone_names()
returns table (zone_id smallint, name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.has_admin_permission('vue_visiteur.view') or public.has_admin_permission('vue_bad.view')
          or public.has_admin_permission('zones.edit')) then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  return query select z.id, z.name::text from public.launch_zones z order by z.name;
end;
$$;

revoke execute on function public.admin_view_visitors(public.gender, integer, integer, smallint, integer) from public, anon, authenticated, service_role;
revoke execute on function public.admin_zone_names() from public, anon, authenticated, service_role;
grant execute on function public.admin_view_visitors(public.gender, integer, integer, smallint, integer) to authenticated;
grant execute on function public.admin_zone_names() to authenticated;
