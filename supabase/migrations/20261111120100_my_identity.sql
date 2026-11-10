-- 10e (owner's request 2026-11-11): everything given at sign-up can be reviewed and changed later,
-- from Ma fiche (« Mon identité »). The rules live here:
--  - pseudo: free during the onboarding; once the dossier is finished, once every 30 days, with
--    the rules of the sign-up (length, characters, no contact details, keyword flags, unique);
--    every change after the onboarding is kept in pseudo_history (shown to the Greffe);
--  - gender and town: the member's own columns, as before (the town gives the quartier again);
--    place_zone() tells the quartier of a town before it is saved;
--  - date of birth: never changed by the member once the dossier is finished; a request to the
--    Greffe (request_birthdate_correction, short motive), decided by an admin with the second
--    factor (admin_decide_birthdate_correction, always 18 or more), kept as a log, the member
--    notified. Only an accepted correction, in the transaction that accepts it, may change the
--    date (profiles_before_write).

------------------------------------------------------------------------------------------------
-- 1. Pseudo: date of the last change, history
------------------------------------------------------------------------------------------------
alter table public.profiles add column pseudo_changed_at timestamptz;
comment on column public.profiles.pseudo_changed_at is
  'Last change of the pseudo after the onboarding (10e): the next one is allowed 30 days later.';

create table public.pseudo_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  old_pseudo text not null,
  new_pseudo text not null,
  changed_at timestamptz not null default now()
);
create index pseudo_history_user on public.pseudo_history (user_id, changed_at desc);
alter table public.pseudo_history enable row level security;
revoke all on public.pseudo_history from public, anon, authenticated;
comment on table public.pseudo_history is
  'Pseudos a member had after the onboarding (10e), kept with the account, read by the Greffe and the export only.';

------------------------------------------------------------------------------------------------
-- 2. Requests to correct the date of birth
------------------------------------------------------------------------------------------------
create table public.birthdate_corrections (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  current_birthdate date not null,
  requested_birthdate date not null,
  reason text not null check (char_length(reason) between 3 and 200),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'refused')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  decision_reason text check (decision_reason is null or char_length(decision_reason) between 3 and 300),
  check ((status = 'pending') = (decided_at is null))
);
create unique index birthdate_corrections_one_pending on public.birthdate_corrections (user_id)
  where status = 'pending';
create index birthdate_corrections_queue on public.birthdate_corrections (status, created_at);
alter table public.birthdate_corrections enable row level security;
revoke all on public.birthdate_corrections from public, anon, authenticated;
grant select on public.birthdate_corrections to authenticated;
create policy birthdate_corrections_own on public.birthdate_corrections
  for select to authenticated using (user_id = (select auth.uid()));
comment on table public.birthdate_corrections is
  'Requests to correct the date of birth (10e) and the decision of the Greffe: the log of every change of it after the onboarding.';

-- The one change of the date of birth allowed after the onboarding: the correction accepted in
-- this very transaction (decided_at = now()), for this member and this date.
create function private.birthdate_correction_allowed(p_user uuid, p_birthdate date)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.birthdate_corrections c
                 where c.user_id = p_user and c.status = 'accepted' and c.decided_at = now()
                   and c.requested_birthdate = p_birthdate)
$$;
revoke execute on function private.birthdate_correction_allowed(uuid, date) from public, anon, authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 3. The rules of profiles_before_write, with the pseudo delay and the accepted correction
------------------------------------------------------------------------------------------------
create or replace function public.profiles_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.birthdate is not null then
    if public.age_years(new.birthdate) < 18 then
      raise exception 'underage' using errcode = '23514', hint = 'birthdate';
    end if;
    if public.age_years(new.birthdate) > 110 then
      raise exception 'invalid_birthdate' using errcode = '23514', hint = 'birthdate';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if old.onboarding_completed_at is not null and new.birthdate is distinct from old.birthdate
       and not private.birthdate_correction_allowed(new.id, new.birthdate) then
      raise exception 'birthdate_locked' using errcode = '42501', hint = 'birthdate';
    end if;
    -- The pseudo after the onboarding: once every 30 days, the old one kept for the Greffe.
    if new.pseudo is distinct from old.pseudo then
      if old.onboarding_completed_at is not null then
        if old.pseudo_changed_at > now() - interval '30 days' then
          raise exception 'pseudo_too_soon' using errcode = '23514', hint = 'pseudo',
            detail = (old.pseudo_changed_at + interval '30 days')::text;
        end if;
        new.pseudo_changed_at := now();
        if old.pseudo is not null and new.pseudo is not null then
          insert into public.pseudo_history (user_id, old_pseudo, new_pseudo)
          values (new.id, old.pseudo::text, new.pseudo::text);
        end if;
      else
        new.pseudo_changed_at := old.pseudo_changed_at;
      end if;
    else
      new.pseudo_changed_at := old.pseudo_changed_at;
    end if;
    if new.is_paused and not old.is_paused then new.paused_at := now(); end if;
    if not new.is_paused then new.paused_at := null; end if;
    -- The N° d'écrou is never chosen nor changed: only this trigger gives it, once.
    new.ecrou := old.ecrou;
  else
    new.ecrou := null;
    new.pseudo_changed_at := null;
  end if;

  -- A Bad gets a N° d'écrou (kept if the role changes later; shown only on a Bad's Fiche).
  if new.role = 'bad' and new.ecrou is null then new.ecrou := public.new_ecrou(); end if;

  if new.pseudo is not null and public.has_contacts(new.pseudo::text) then
    raise exception 'pseudo_contains_contacts' using errcode = '23514', hint = 'pseudo';
  end if;

  if new.bio is not null then
    new.bio := public.mask_contacts(new.bio);
  end if;
  if new.visit_motive is not null then
    new.visit_motive := public.mask_contacts(new.visit_motive);
  end if;

  if tg_op = 'INSERT' or new.place_id is distinct from old.place_id then
    select pl.lat, pl.lng into new.lat, new.lng from public.places pl where pl.id = new.place_id;
    new.zone_id := public.zone_for(new.lat, new.lng);
  end if;

  new.requests_open := not new.requests_closed_manual and new.pending_requests_count < new.requests_cap;
  new.updated_at := now();
  return new;
end;
$$;

------------------------------------------------------------------------------------------------
-- 4. For the member
------------------------------------------------------------------------------------------------
-- The quartier of a town before it is saved: its name and whether it is open (null name: the town
-- is in no quartier yet).
create function public.place_zone(p_place bigint)
returns table (zone_name text, open boolean)
language plpgsql stable security definer set search_path = '' as $$
declare pl public.places; z smallint;
begin
  if (select auth.uid()) is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  select * into pl from public.places where id = p_place;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  z := public.zone_for(pl.lat, pl.lng);
  return query
    select (select lz.name::text from public.launch_zones lz where lz.id = z), public.zone_is_open(z);
end;
$$;

-- When the pseudo may change again (null: now).
create function public.pseudo_next_change()
returns timestamptz language sql stable security definer set search_path = '' as $$
  select case when p.onboarding_completed_at is not null and p.pseudo_changed_at > now() - interval '30 days'
              then p.pseudo_changed_at + interval '30 days' end
  from public.profiles p where p.id = (select auth.uid())
$$;

-- A request to correct the date of birth (once the dossier is finished: before, step 1 edits it).
create function public.request_birthdate_correction(p_birthdate date, p_reason text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  motive text := btrim(coalesce(p_reason, ''));
  new_id bigint;
begin
  select * into me from public.profiles where id = (select auth.uid());
  if not found then raise exception 'no_profile' using errcode = 'P0002'; end if;
  if me.onboarding_completed_at is null or me.birthdate is null then
    raise exception 'edit_in_onboarding' using errcode = '23514';
  end if;
  if p_birthdate is null or public.age_years(p_birthdate) < 18 then
    raise exception 'underage' using errcode = '23514', hint = 'birthdate';
  end if;
  if public.age_years(p_birthdate) > 110 then
    raise exception 'invalid_birthdate' using errcode = '23514', hint = 'birthdate';
  end if;
  if p_birthdate = me.birthdate then raise exception 'same_birthdate' using errcode = '23514'; end if;
  if char_length(motive) < 3 or char_length(motive) > 200 then
    raise exception 'invalid_reason' using errcode = '23514', hint = 'reason';
  end if;
  if exists (select 1 from public.birthdate_corrections c where c.user_id = me.id and c.status = 'pending') then
    raise exception 'correction_pending' using errcode = '23505';
  end if;
  insert into public.birthdate_corrections (user_id, current_birthdate, requested_birthdate, reason)
  values (me.id, me.birthdate, p_birthdate, public.mask_contacts(motive))
  returning id into new_id;
  return new_id;
end;
$$;

-- My pseudos and my requests, for the export of my data.
create function public.my_identity_history()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'pseudo_history', coalesce((select jsonb_agg(jsonb_build_object('old_pseudo', h.old_pseudo,
        'new_pseudo', h.new_pseudo, 'changed_at', h.changed_at) order by h.changed_at)
      from public.pseudo_history h where h.user_id = (select auth.uid())), '[]'::jsonb),
    'birthdate_corrections', coalesce((select jsonb_agg(jsonb_build_object('created_at', c.created_at,
        'current_birthdate', c.current_birthdate, 'requested_birthdate', c.requested_birthdate,
        'reason', c.reason, 'status', c.status, 'decided_at', c.decided_at,
        'decision_reason', c.decision_reason) order by c.created_at)
      from public.birthdate_corrections c where c.user_id = (select auth.uid())), '[]'::jsonb))
$$;

------------------------------------------------------------------------------------------------
-- 5. For the Greffe (is_admin(): admin role and second factor)
------------------------------------------------------------------------------------------------
create function public.admin_birthdate_corrections()
returns table (id bigint, user_id uuid, pseudo text, current_birthdate date, requested_birthdate date,
  reason text, status text, created_at timestamptz, decided_at timestamptz, decision_reason text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query
    select c.id, c.user_id, p.pseudo::text, c.current_birthdate, c.requested_birthdate, c.reason, c.status,
      c.created_at, c.decided_at, c.decision_reason
    from public.birthdate_corrections c join public.profiles p on p.id = c.user_id
    order by (c.status = 'pending') desc, coalesce(c.decided_at, c.created_at) desc
    limit 100;
end;
$$;

create function public.admin_decide_birthdate_correction(p_correction bigint, p_accept boolean,
  p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.birthdate_corrections;
  motive text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into c from public.birthdate_corrections where id = p_correction for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if c.status <> 'pending' then raise exception 'already_decided' using errcode = '23514'; end if;
  if p_accept is null then raise exception 'invalid_decision' using errcode = '22023'; end if;
  if not p_accept and motive is null then
    raise exception 'reason_required' using errcode = '23514', hint = 'reason';
  end if;
  if motive is not null and (char_length(motive) < 3 or char_length(motive) > 300) then
    raise exception 'invalid_reason' using errcode = '23514', hint = 'reason';
  end if;
  -- Never under 18, whatever was asked (checked again here and by profiles_before_write).
  if p_accept and public.age_years(c.requested_birthdate) < 18 then
    raise exception 'underage' using errcode = '23514', hint = 'birthdate';
  end if;
  update public.birthdate_corrections
  set status = case when p_accept then 'accepted' else 'refused' end, decided_at = now(),
      decided_by = (select auth.uid()), decision_reason = motive
  where id = c.id;
  if p_accept then
    update public.profiles set birthdate = c.requested_birthdate where id = c.user_id;
  end if;
  insert into public.notifications (user_id, type, payload)
  values (c.user_id, 'birthdate_correction',
          jsonb_build_object('accepted', p_accept, 'reason', motive));
end;
$$;

-- The record of a member (10d), with the pseudos it had and its requests about the date of birth.
create or replace function public.admin_member_detail(p_user uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  u auth.users;
  p public.profiles;
  has_profile boolean;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into u from auth.users where id = p_user;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into p from public.profiles where id = p_user;
  has_profile := found;
  if has_profile then
    insert into public.greffe_fiche_views (admin_id, bad_id, context)
    values ((select auth.uid()), p.id, 'member');
  end if;
  return jsonb_build_object(
    'id', u.id,
    'has_profile', has_profile,
    'account_created_at', u.created_at,
    'email_confirmed_at', u.email_confirmed_at,
    'last_sign_in_at', u.last_sign_in_at,
    'last_seen_at', p.last_seen_at,
    'pseudo', p.pseudo,
    'role', p.role,
    'state', case when has_profile then private.member_state(p) else 'not_started' end,
    'gender', p.gender,
    'age', public.age_years(p.birthdate),
    'city', public.place_name(p.place_id),
    'zone', (select z.name from public.launch_zones z where z.id = p.zone_id),
    'seeking_genders', coalesce(to_jsonb(p.seeking_genders), '[]'::jsonb),
    'seek_age_min', p.seek_age_min,
    'seek_age_max', p.seek_age_max,
    'bio', p.bio,
    'visit_motive', p.visit_motive,
    'tribes', coalesce((
      select jsonb_agg(jsonb_build_object('label', t.label, 'detail', pt.detail) order by t.sort)
      from public.profile_tribes pt join public.tribes t on t.id = pt.tribe_id
      where pt.profile_id = p_user), '[]'::jsonb),
    -- Règle 14: the 3 charges as the Visitors read them, never which one is true.
    'casier', (select jsonb_build_array(c.charge_1, c.charge_2, c.charge_3)
               from public.casier_charges c where c.profile_id = p_user),
    'answers', (select count(*) from public.answers a where a.user_id = p_user),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('position', ph.position, 'status', ph.status,
        'rejection_reason', ph.rejection_reason, 'cutout', ph.is_cutout, 'waived', ph.cutout_waived,
        'created_at', ph.created_at, 'reviewed_at', ph.reviewed_at,
        'pending_path', ph.pending_path, 'public_small', ph.public_path_small) order by ph.position)
      from public.photos ph where ph.owner_id = p_user), '[]'::jsonb),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object('type', c.type, 'granted', c.granted,
        'version', c.text_version, 'created_at', c.created_at) order by c.created_at desc)
      from public.consents c where c.user_id = p_user), '[]'::jsonb),
    'missing', to_jsonb(private.onboarding_missing_for(p_user)),
    'blocked', has_profile and private.dossier_blocked(p),
    'hidden_reasons', case when p.role = 'bad' then to_jsonb(private.discover_hidden_reasons(p)) end,
    'pseudo_history', coalesce((
      select jsonb_agg(jsonb_build_object('old_pseudo', h.old_pseudo, 'new_pseudo', h.new_pseudo,
        'changed_at', h.changed_at) order by h.changed_at desc)
      from public.pseudo_history h where h.user_id = p_user), '[]'::jsonb),
    'birthdate_corrections', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status, 'created_at', c.created_at,
        'requested_age', public.age_years(c.requested_birthdate), 'decided_at', c.decided_at)
        order by c.created_at desc)
      from public.birthdate_corrections c where c.user_id = p_user), '[]'::jsonb)
  );
end;
$$;

-- The push of the decision opens « Mon identité ».
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
    when 'birthdate_correction' then '/ma-fiche/identite'
  end
$$;

revoke execute on function public.place_zone(bigint) from public, anon, authenticated, service_role;
revoke execute on function public.pseudo_next_change() from public, anon, authenticated, service_role;
revoke execute on function public.request_birthdate_correction(date, text) from public, anon, authenticated, service_role;
revoke execute on function public.my_identity_history() from public, anon, authenticated, service_role;
revoke execute on function public.admin_birthdate_corrections() from public, anon, authenticated, service_role;
revoke execute on function public.admin_decide_birthdate_correction(bigint, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.place_zone(bigint) to authenticated;
grant execute on function public.pseudo_next_change() to authenticated;
grant execute on function public.request_birthdate_correction(date, text) to authenticated;
grant execute on function public.my_identity_history() to authenticated;
grant execute on function public.admin_birthdate_corrections() to authenticated;
grant execute on function public.admin_decide_birthdate_correction(bigint, boolean, text) to authenticated;
