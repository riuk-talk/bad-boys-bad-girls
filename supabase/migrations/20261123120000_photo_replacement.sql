-- 10g, corrections of the advisor (2026-11-23).
-- 10-50 refused: a new photo deposited for a position (Ma fiche or the Courrier du Greffe) no longer
-- removes the validated one. The validated photo stays shown and counts for the visibility until
-- the Greffe decides on the new one: validated, it replaces the old one (whose files the server
-- removes); refused, the old one stays. So a position may hold one validated photo and one other
-- (waiting or refused), never two of either.
-- 10-52: a photo proposed by the team and accepted by the member raised a false « photos en
-- attente » alert to the admins (the insert of its row). Only a deposit waiting for the Greffe
-- (a file in the pending bucket) raises it now; and an accepted proposal is inserted validated.

alter table public.photos drop constraint photos_owner_position;
create unique index photos_one_validated on public.photos (owner_id, position) where status = 'approved';
create unique index photos_one_other on public.photos (owner_id, position) where status <> 'approved';

-- At most 6 positions; each may hold a validated photo and a new one waiting.
create or replace function public.photos_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.photos where owner_id = new.owner_id) >= 12 then
    raise exception 'too_many_photos' using errcode = '23514';
  end if;
  if new.position > 0
     and exists (select 1 from public.profiles where id = new.owner_id and role = 'visitor') then
    raise exception 'visitor_single_photo' using errcode = '23514';
  end if;
  -- An accepted proposal of the Greffe is inserted validated, by greffe_apply_photo_proposal only.
  if current_setting('app.greffe_apply', true) = 'on' then
    return new;
  end if;
  -- Status and publication fields are never chosen by the client.
  new.status := 'pending';
  new.public_path_large := null;
  new.public_path_small := null;
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.rejection_reason := null;
  return new;
end;
$$;

-- The admins are told of photos waiting only when a deposit waits (a file in the pending bucket).
create or replace function public.photos_notify_admins()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from inserted where status = 'pending' and pending_path is not null) then
    return null;
  end if;
  insert into public.email_outbox (user_id, kind, priority)
  select a.user_id, 'admin_photos_pending', 20
  from public.admin_users a
  join public.profiles p on p.id = a.user_id
  on conflict do nothing;
  return null;
end;
$$;
drop trigger photos_notify_admins on public.photos;
create trigger photos_notify_admins after insert on public.photos
  referencing new table as inserted for each statement execute function public.photos_notify_admins();

-- « Ta Fiche est en ligne »: when the last pose becomes validated (by a decision of the Greffe, or a
-- validated insert of an accepted proposal); never again when a validated pose is only replaced.
create or replace function private.photos_last_pose_validated()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
  missing text[];
begin
  if new.status <> 'approved' or (tg_op = 'UPDATE' and old.status = 'approved') or new.position not in (0, 1, 2) then
    return null;
  end if;
  if current_setting('app.photo_replacement', true) = 'on' then
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
drop trigger photos_last_pose_validated on public.photos;
create trigger photos_last_pose_validated after insert or update of status on public.photos
  for each row execute function private.photos_last_pose_validated();

-- The Greffe's decision on a waiting photo. Validated while a validated photo holds its position:
-- it replaces it (the old row goes; the server removes its files, read before the call); refused:
-- the validated one stays as it is.
create or replace function public.admin_decide_photo(p_photo uuid, p_approve boolean, p_reason text default null,
  p_public_large text default null, p_public_small text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  ph public.photos;
  owner_role public.member_role;
  replaced boolean := false;
begin
  if not public.has_admin_permission('greffe.decide') then raise exception 'admin_only' using errcode = '42501'; end if;
  select * into ph from public.photos where id = p_photo for update;
  if not found or ph.status <> 'pending' then
    raise exception 'photo_not_pending' using errcode = '23514';
  end if;
  if p_approve then
    if p_public_large is null or p_public_small is null
       or p_public_large !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
       or p_public_small !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-s\.webp$' then
      raise exception 'invalid_public_path' using errcode = '22023';
    end if;
    delete from public.photos
    where owner_id = ph.owner_id and position = ph.position and status = 'approved' and id <> ph.id;
    replaced := found;
    if replaced then perform set_config('app.photo_replacement', 'on', true); end if;
    update public.photos set status = 'approved', public_path_large = p_public_large,
      public_path_small = p_public_small, pending_path = null, rejection_reason = null,
      reviewed_by = (select auth.uid()), reviewed_at = now()
    where id = p_photo;
    perform set_config('app.photo_replacement', '', true);
  else
    if p_reason is null or not (p_reason = any (public.photo_rejection_reasons())) then
      raise exception 'invalid_reason' using errcode = '22023';
    end if;
    update public.photos set status = 'rejected', pending_path = null, rejection_reason = p_reason,
      reviewed_by = (select auth.uid()), reviewed_at = now()
    where id = p_photo;
  end if;

  insert into public.notifications (user_id, type, payload)
  values (ph.owner_id, 'moderation_decision', jsonb_build_object(
    'photo_position', ph.position, 'approved', p_approve, 'reason', case when p_approve then null else p_reason end));
  -- The Visitor's face photo delivers the Permis de visite (stamp « PERMIS DÉLIVRÉ »); not again
  -- when it only replaces a validated one.
  select role into owner_role from public.profiles where id = ph.owner_id;
  if p_approve and not replaced and ph.position = 0 and owner_role = 'visitor' then
    insert into public.notifications (user_id, type, payload) values (ph.owner_id, 'permit_granted', '{}');
  end if;
  return ph.pending_path;
end;
$$;

-- An accepted proposal of the Greffe: it replaces the validated photo of its pose in place, or is
-- inserted validated if there is none (a waiting deposit of the member stays for the Greffe).
-- No row is ever created before the member's « Accepter ».
create or replace function public.greffe_apply_photo_proposal(p_proposal uuid, p_public_large text, p_public_small text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.greffe_photo_proposals; ph public.photos; old jsonb := '{}';
begin
  select * into p from public.greffe_photo_proposals where id = p_proposal for update;
  if not found or p.status <> 'accepted' or p.applied_at is not null then
    raise exception 'not_accepted' using errcode = '42501';
  end if;
  if p_public_large !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
     or p_public_small <> regexp_replace(p_public_large, '\.webp$', '-s.webp') then
    raise exception 'invalid_public_path' using errcode = '22023';
  end if;
  select * into ph from public.photos
  where owner_id = p.member_id and position = p.position and status = 'approved' for update;
  if found then
    old := jsonb_build_object('pending', null, 'large', ph.public_path_large, 'small', ph.public_path_small);
    update public.photos
    set public_path_large = p_public_large, public_path_small = p_public_small, width = p.width,
        height = p.height, reviewed_by = p.proposed_by, reviewed_at = now(), is_cutout = p.is_cutout,
        needs_cutout = false, cutout_waived = not p.is_cutout and p.position <= 2,
        cutout_waived_reason = case when not p.is_cutout and p.position <= 2
          then 'Photo retouchée par le Greffe, acceptée par le membre' end
    where id = ph.id;
  else
    perform set_config('app.greffe_apply', 'on', true);
    insert into public.photos (owner_id, position, status, public_path_large, public_path_small, width, height,
      reviewed_by, reviewed_at, is_cutout, needs_cutout, cutout_waived, cutout_waived_reason)
    values (p.member_id, p.position, 'approved', p_public_large, p_public_small, p.width, p.height,
      p.proposed_by, now(), p.is_cutout, false, not p.is_cutout and p.position <= 2,
      case when not p.is_cutout and p.position <= 2 then 'Photo retouchée par le Greffe, acceptée par le membre' end);
    perform set_config('app.greffe_apply', '', true);
    -- The Visitor's face photo delivers the Permis de visite, as a validation by the Greffe does.
    if p.position = 0 and exists (select 1 from public.profiles where id = p.member_id and role = 'visitor') then
      insert into public.notifications (user_id, type, payload) values (p.member_id, 'permit_granted', '{}');
    end if;
  end if;
  update public.greffe_photo_proposals set status = 'applied', applied_at = now() where id = p.id;
  insert into public.moderation_actions (target_user_id, action, reason, admin_id)
  values (p.member_id, 'photo_proposal_accept',
          'Pose ' || p.position || ' remplacée par la photo proposée par le Greffe, acceptée par le membre',
          p.proposed_by);
  return old;
end;
$$;
