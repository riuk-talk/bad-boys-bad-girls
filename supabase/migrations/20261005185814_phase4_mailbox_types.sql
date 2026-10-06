-- Phase 4a fix: the Courrier returned varchar columns where the function declares text
-- (motive, note), so every call failed (« structure of query does not match function result type »).
create or replace function public.get_mailbox()
returns table (request_id uuid, status public.visit_request_status, created_at timestamptz,
  visitor_id uuid, pseudo text, gender public.gender, age integer, city text, distance_km integer,
  photo_small text, motive text, clean_record boolean, visits_honored integer, visits_due integer,
  complicity smallint, note text)
language plpgsql stable security definer set search_path = '' as $$
declare b public.profiles;
begin
  select * into b from public.profiles p where p.id = (select auth.uid());
  if not found or b.role is distinct from 'bad' then raise exception 'bads_only' using errcode = '42501'; end if;
  return query
  select r.id, r.status, r.created_at, v.id, v.pseudo::text, v.gender, public.age_years(v.birthdate),
    public.place_name(v.place_id), public.distance_km(b, v),
    (select ph.public_path_small::text from public.photos ph where ph.owner_id = v.id and ph.position = 0 and ph.status = 'approved'),
    v.visit_motive::text, rep.clean_record, rep.honored, rep.due,
    (select x.score from public.complicity_score(b.id, v.id) x), r.note::text
  from public.visit_requests r
  join public.profiles v on v.id = r.visitor_id
  cross join lateral public.visitor_reputation(v.id) rep
  where r.bad_id = b.id and r.status in ('pending', 'accepted')
    and not public.is_blocked_between(b.id, v.id)
  order by r.status, r.created_at;
end;
$$;
