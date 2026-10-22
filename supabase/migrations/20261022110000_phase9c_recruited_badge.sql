-- Phase 9c [P1]: le badge « Complices recrutés » (SPEC §5, §3). The number of members a Bad brought
-- in with their referral link, shown on their Fiche. One count for the Fiche and for « Mon
-- quartier »: onboarding finished, neither banned nor a seed profile.

create function private.recruited_count(p_member uuid)
returns integer language sql stable set search_path = '' as $$
  select count(*)::integer from public.profiles p
  where p.referred_by = p_member and p.onboarding_completed_at is not null
    and p.banned_at is null and not p.is_seed
$$;
revoke execute on function private.recruited_count(uuid) from public, anon, authenticated, service_role;

create or replace function public.referral_count()
returns integer language sql stable security definer set search_path = '' as $$
  select private.recruited_count((select auth.uid()))
$$;

-- Same function as Phase 4, plus `recruited`.
create or replace function public.get_fiche(p_bad uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  v public.profiles;
  b public.profiles;
  c public.casier_charges;
  open_request public.visit_requests;
  score smallint;
begin
  select * into b from public.profiles where id = p_bad and role = 'bad';
  if not found or me is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if me <> p_bad then
    if public.is_blocked_between(me, p_bad)
       or not (public.can_view_bad(me, p_bad) or public.has_open_relation(me, p_bad)) then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    select * into v from public.profiles where id = me;
  end if;
  select * into c from public.casier_charges where profile_id = p_bad;
  select * into open_request from public.visit_requests r
    where r.visitor_id = me and r.bad_id = p_bad and r.status in ('pending', 'accepted', 'released')
    order by r.created_at desc limit 1;
  if me <> p_bad then
    select x.score into score from public.complicity_score(me, p_bad) x;
  end if;
  return jsonb_build_object(
    'id', b.id,
    'ecrou', b.ecrou,
    'pseudo', b.pseudo,
    'gender', b.gender,
    'age', public.age_years(b.birthdate),
    'city', public.place_name(b.place_id),
    'distance_km', case when me <> p_bad then public.distance_km(v, b) end,
    'seeking_genders', to_jsonb(b.seeking_genders),
    'seek_age_min', b.seek_age_min,
    'seek_age_max', b.seek_age_max,
    'on_file_since', to_char(b.created_at, 'YYYY-MM'),
    'photos', public.public_photos(b.id, array[0, 1, 2, 3, 4, 5]::smallint[]),
    'tribes', public.public_tribes(b.id),
    'charges', case when c.profile_id is null then '[]'::jsonb
                    else jsonb_build_array(c.charge_1, c.charge_2, c.charge_3) end,
    'casier_changed_since_request', open_request.id is not null and b.casier_updated_at > open_request.created_at,
    'bio', b.bio,
    'good_conduct', b.is_reglo,
    'recruited', private.recruited_count(b.id),
    'requests_open', b.requests_open and not b.is_paused,
    'complicity', score,
    'common_points', case when me <> p_bad then
        (select coalesce(jsonb_agg(jsonb_build_object('question', cp.question, 'answer', cp.answer)), '[]')
         from public.common_points(me, p_bad, 3) cp) else '[]'::jsonb end,
    'my_request_status', open_request.status,
    'cooldown_until', case when me <> p_bad then public.pair_cooldown_until(me, p_bad) end
  );
end;
$$;
