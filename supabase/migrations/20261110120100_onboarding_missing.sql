-- 10d (owner's feedback 2026-11-10, real members in production): the unfinished dossier.
--  - private.onboarding_missing_for(user): what a member still lacks, as a list of keys. It is the
--    only source of the rules: complete_onboarding() finishes the dossier when the list is empty
--    and otherwise refuses with the list (same keys as before, « consents » now split in two:
--    « consents » for the terms, privacy and 18+ of step 1, « consent_art9 » for the criteria);
--  - public.onboarding_missing(): the same list, for oneself (the « Il te manque » screen);
--  - when the Greffe validates the last of the 3 poses of a Bad: a dossier with nothing else
--    missing is finished there and then, and the Bad is told « Ta Fiche est en ligne »; with
--    something else missing, the notification says what (push, e-mail and in-app).

create function private.onboarding_missing_for(p_user uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
  missing text[] := '{}';
begin
  -- No profile yet (account created, step 1 never saved): every field reads as missing.
  select * into me from public.profiles where id = p_user;
  if me.birthdate is null then missing := missing || 'birthdate'::text; end if;
  if me.pseudo is null or me.gender is null or me.place_id is null then missing := missing || 'identity'::text; end if;
  if me.role is null then missing := missing || 'role'::text; end if;
  if coalesce(cardinality(me.seeking_genders), 0) = 0 then missing := missing || 'seeking'::text; end if;
  if exists (
    select 1 from unnest(array['terms', 'privacy', 'age_18']::public.consent_type[]) t
    where not coalesce((select c.granted from public.consents c
                        where c.user_id = p_user and c.type = t
                        order by c.created_at desc limit 1), false)
  ) then missing := missing || 'consents'::text; end if;
  if not coalesce((select c.granted from public.consents c
                   where c.user_id = p_user and c.type = 'art9_seeking'
                   order by c.created_at desc limit 1), false) then
    missing := missing || 'consent_art9'::text;
  end if;
  -- A Visitor: the face photo only. A Bad: the 3 poses (sent, validated or not).
  if me.role = 'bad' then
    if not public.has_three_poses(p_user) then missing := missing || 'photos'::text; end if;
  elsif not exists (select 1 from public.photos where owner_id = p_user and position = 0) then
    missing := missing || 'photo'::text;
  end if;
  if me.role = 'bad' and not exists (select 1 from public.casier_charges where profile_id = p_user) then
    missing := missing || 'casier'::text;
  end if;
  if me.role = 'visitor' and me.visit_motive is null then missing := missing || 'visit_motive'::text; end if;
  if exists (
    select 1 from public.questions qu
    where qu.is_active and qu.phase = 'core'
      and not exists (select 1 from public.answers an where an.user_id = p_user and an.question_id = qu.id)
  ) then missing := missing || 'core_answers'::text; end if;
  return missing;
end;
$$;
revoke execute on function private.onboarding_missing_for(uuid) from public, anon, authenticated, service_role;

-- For oneself: what is still missing (empty once nothing is).
create function public.onboarding_missing()
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  return private.onboarding_missing_for(uid);
end;
$$;
revoke execute on function public.onboarding_missing() from public, anon, authenticated, service_role;
grant execute on function public.onboarding_missing() to authenticated;

-- The same rules, from the single source.
create or replace function public.complete_onboarding()
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  missing text[];
begin
  select * into me from public.profiles where id = (select auth.uid()) for update;
  if not found then raise exception 'no_profile' using errcode = 'P0002'; end if;
  if me.onboarding_completed_at is not null then return; end if;
  missing := private.onboarding_missing_for(me.id);
  if cardinality(missing) > 0 then
    raise exception 'onboarding_incomplete' using errcode = '23514', detail = array_to_string(missing, ',');
  end if;
  update public.profiles set onboarding_completed_at = now(), onboarding_step = 8 where id = me.id;
end;
$$;

-- The Greffe validates a pose: if it is the last of the 3 of a Bad, the dossier is finished when
-- nothing else is missing (the Bad is told « Ta Fiche est en ligne »), otherwise the Bad is told
-- what is still missing. Once per completion of the 3 poses (a pose replaced then validated
-- again tells again). Nothing for a banned, hidden or suspended account.
create function private.photos_last_pose_validated()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
  missing text[];
begin
  if new.status <> 'approved' or old.status = 'approved' or new.position not in (0, 1, 2) then
    return null;
  end if;
  select * into p from public.profiles where id = new.owner_id for update;
  if not found or p.role is distinct from 'bad' or not public.has_three_poses(p.id, true) then
    return null;
  end if;
  if p.banned_at is not null or p.hidden_reason is not null or p.suspended_until > now() then
    return null;
  end if;
  -- Several poses validated by one statement: one notice (now() is the transaction's time).
  if exists (select 1 from public.notifications n where n.user_id = p.id and n.created_at = now()
             and n.type in ('fiche_online', 'dossier_incomplete')) then
    return null;
  end if;
  if p.onboarding_completed_at is null then
    missing := private.onboarding_missing_for(p.id);
    if cardinality(missing) > 0 then
      insert into public.notifications (user_id, type, payload)
      values (p.id, 'dossier_incomplete', jsonb_build_object('missing', to_jsonb(missing)));
      return null;
    end if;
    update public.profiles set onboarding_completed_at = now(), onboarding_step = 8 where id = p.id;
  end if;
  insert into public.notifications (user_id, type, payload) values (p.id, 'fiche_online', '{}');
  return null;
end;
$$;
revoke execute on function private.photos_last_pose_validated() from public, anon, authenticated, service_role;
create trigger photos_last_pose_validated
  after update of status on public.photos
  for each row execute function private.photos_last_pose_validated();

-- Where a click on the push opens (the 2 new kinds added).
create or replace function public.push_path(p_type public.notification_type)
returns text language sql immutable set search_path = '' as $$
  select case p_type
    when 'request_received' then '/courrier'
    when 'request_accepted' then '/demandes'
    when 'request_dismissed' then '/demandes'
    when 'slot_chosen' then '/visites'
    when 'visit_reminder_1h' then '/visites'
    when 'visit_starting' then '/visites'
    when 'visit_no_show' then '/visites'
    when 'visit_released' then '/visites'
    when 'visit_closed' then '/visites'
    when 'message_received' then '/visites'
    when 'date_proposed' then '/visites'
    when 'date_accepted' then '/visites'
    when 'date_countered' then '/visites'
    when 'date_cancelled' then '/visites'
    when 'promenade_open' then '/promenade'
    when 'permit_granted' then '/ma-fiche'
    when 'moderation_decision' then '/ma-fiche'
    when 'fiche_online' then '/ma-fiche'
    when 'dossier_incomplete' then '/onboarding'
  end
$$;

-- The 2 new kinds also go by e-mail (one-off messages about the account, not switchable, like the
-- reminder of an unfinished onboarding); the missing items travel in the payload.
create or replace function public.notifications_to_email()
returns trigger language plpgsql security definer set search_path = '' as $$
declare kind public.email_kind; prio smallint; payload jsonb := '{}';
begin
  case new.type
    when 'request_received', 'request_accepted' then kind := 'request_digest'; prio := 40;
    when 'date_accepted' then kind := 'date_accepted'; prio := 30;
    when 'permit_granted' then kind := 'permit_granted'; prio := 30;
    when 'fiche_online' then kind := 'fiche_online'; prio := 30;
    when 'dossier_incomplete' then
      kind := 'dossier_incomplete'; prio := 30;
      payload := jsonb_build_object('missing', coalesce(new.payload -> 'missing', '[]'::jsonb));
    when 'visit_reminder_1h' then
      kind := 'visit_reminder'; prio := 10;
      payload := jsonb_build_object('starts_at',
        (select x.starts_at from public.visits x where x.id::text = new.payload ->> 'visit_id'));
    else return null;
  end case;
  if not coalesce(private.email_allowed(new.user_id, kind), true) then return null; end if;
  -- One digest a day per member (unique index email_outbox_one_per_day).
  insert into public.email_outbox (user_id, kind, payload, priority, not_before)
  values (new.user_id, kind, payload, prio, (now() at time zone 'Europe/Paris')::date)
  on conflict do nothing;
  return null;
end;
$$;
