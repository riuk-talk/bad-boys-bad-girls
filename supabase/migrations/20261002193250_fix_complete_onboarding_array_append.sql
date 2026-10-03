-- Fix: in PL/pgSQL, `text[] || 'literal'` parses the literal as an array ("malformed array
-- literal"), so complete_onboarding() crashed instead of listing the missing steps.
create or replace function public.complete_onboarding()
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  missing text[] := '{}';
begin
  select * into me from public.profiles where id = (select auth.uid()) for update;
  if not found then raise exception 'no_profile' using errcode = 'P0002'; end if;
  if me.onboarding_completed_at is not null then return; end if;
  if me.birthdate is null then missing := missing || 'birthdate'::text; end if;
  if me.pseudo is null or me.gender is null or me.place_id is null then missing := missing || 'identity'::text; end if;
  if cardinality(me.seeking_genders) = 0 then missing := missing || 'seeking'::text; end if;
  if exists (
    select 1 from unnest(array['terms', 'privacy', 'age_18', 'art9_seeking']::public.consent_type[]) t
    where not coalesce((select c.granted from public.consents c
                        where c.user_id = me.id and c.type = t
                        order by c.created_at desc limit 1), false)
  ) then missing := missing || 'consents'::text; end if;
  if not exists (select 1 from public.photos where owner_id = me.id and position = 0) then
    missing := missing || 'photo'::text;
  end if;
  if cardinality(missing) > 0 then
    raise exception 'onboarding_incomplete' using errcode = '23514', detail = array_to_string(missing, ',');
  end if;
  update public.profiles set onboarding_completed_at = now(), onboarding_step = 6 where id = me.id;
end;
$$;
