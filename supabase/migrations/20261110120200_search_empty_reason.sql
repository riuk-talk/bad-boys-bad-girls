-- 10d (owner's feedback 2026-11-10): an empty Découverte or Promenade says why, for the Visitor
-- asking, in this order:
--  - « zone_closed »: the Visitor's quartier is not open;
--  - « no_bad_matches »: no visible Bad fits the Visitor's own criteria (genders, age range);
--  - « no_bad_accepts »: some do, but the Visitor fits the criteria of none of them;
--  - null: Bads fit both ways (the list is empty for another reason: filters, the evening draw).
-- Only counts are compared, never a Bad's criteria: nothing names or describes a Bad. A Bad that
-- blocked the Visitor (or was blocked) counts as absent, so a block is never revealed.
-- The search criteria themselves are edited through the profile columns (RLS, grants and the
-- checks of the table, as during the onboarding).

create function public.search_empty_reason()
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v public.profiles;
  v_age integer;
begin
  select * into v from public.profiles p where p.id = (select auth.uid());
  if not found or v.role is distinct from 'visitor' or not public.is_member_active(v) then
    raise exception 'visitors_only' using errcode = '42501';
  end if;
  if not public.zone_is_open(v.zone_id) then return 'zone_closed'; end if;
  v_age := public.age_years(v.birthdate);
  return (
    with candidates as (
      select b.seeking_genders as seeking, b.seek_age_min as age_min, b.seek_age_max as age_max
      from public.profiles b
      where b.role = 'bad' and b.id <> v.id and public.is_bad_visible(b)
        and not public.is_blocked_between(v.id, b.id)
        and b.gender = any (v.seeking_genders)
        and public.age_years(b.birthdate) between v.seek_age_min and v.seek_age_max
    )
    select case
      when not exists (select 1 from candidates) then 'no_bad_matches'
      when not exists (select 1 from candidates c
                       where v.gender = any (c.seeking) and v_age between c.age_min and c.age_max)
        then 'no_bad_accepts'
    end);
end;
$$;
revoke execute on function public.search_empty_reason() from public, anon, authenticated, service_role;
grant execute on function public.search_empty_reason() to authenticated;
