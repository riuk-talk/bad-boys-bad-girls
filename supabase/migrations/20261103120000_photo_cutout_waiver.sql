-- 9k (owner's decision 2026-11-03): the Greffe may validate a pose that is not cut out, when the
-- cut-out fails or the photo does not suit it, with a motive. The pose is then shown as a print
-- stapled to the wall (white border, light shadow), never bare on the wall. Cutting out stays
-- the default; the waiver is recorded by an admin only (is_admin(), second factor), never by the
-- member, and logged in moderation_actions. The member is told only that the photo is
-- validated: the motive is internal (not readable by members, not in their notifications).

alter type public.moderation_action_type add value if not exists 'photo_cutout_waive';

alter table public.photos
  add column cutout_waived boolean not null default false,
  add column cutout_waived_reason text,
  add constraint photos_cutout_waived_reason
    check (not cutout_waived
           or (cutout_waived_reason is not null and length(btrim(cutout_waived_reason)) between 1 and 220));
comment on column public.photos.cutout_waived is
  'Validated by the Greffe without cut-out (9k): shown as a stapled print. Written by admin_waive_cutout only.';
comment on column public.photos.cutout_waived_reason is
  'Internal motive of the waiver (9k), for the Greffe only: never shown to the member.';

-- A validated pose (positions 0 to 2) is cut out or waived with a motive. It replaces
-- photos_cutout_before_approval (a pose waiting for its cut-out was never validated). NOT VALID:
-- checked on every new or changed row from now on; the poses validated before the cut-out rule
-- (2026-10-23) are not rewritten here (the Greffe re-cuts them with the batch, preview only).
alter table public.photos drop constraint photos_cutout_before_approval;
alter table public.photos add constraint photos_cutout_or_waived
  check (status <> 'approved' or position > 2 or is_cutout
         or (cutout_waived and cutout_waived_reason is not null))
  not valid;

-- Members read their own photos, but not the internal motive of a waiver: column privileges.
revoke select on public.photos from authenticated;
grant select (id, owner_id, position, status, pending_path, public_path_large, public_path_small,
  width, height, rejection_reason, reviewed_by, reviewed_at, created_at, path_rotated_at,
  is_cutout, needs_cutout, recut_at, cutout_waived) on public.photos to authenticated;

-- The motives offered by the Greffe; « other » needs a short text.
create function public.photo_cutout_waiver_reasons()
returns text[] language sql immutable set search_path = '' as $$
  select array['failed_cutout', 'atypical_photo', 'other']
$$;

-- Waives the cut-out of a pending pose not cut out. Admin only; logged. Called before the
-- validation (admin_approve_without_cutout does both at once).
create function public.admin_waive_cutout(p_photo uuid, p_reason text, p_detail text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  ph public.photos;
  motive text;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if p_reason is null or not (p_reason = any (public.photo_cutout_waiver_reasons())) then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  if p_reason = 'other' then
    if p_detail is null or length(btrim(p_detail)) = 0 or length(btrim(p_detail)) > 200 then
      raise exception 'invalid_reason' using errcode = '22023';
    end if;
    motive := 'other: ' || btrim(p_detail);
  else
    motive := p_reason;
  end if;
  select * into ph from public.photos where id = p_photo for update;
  if not found or ph.status <> 'pending' or ph.position > 2 then
    raise exception 'photo_not_pending' using errcode = '23514';
  end if;
  if ph.is_cutout then raise exception 'photo_already_cut_out' using errcode = '23514'; end if;
  update public.photos
    set cutout_waived = true, cutout_waived_reason = motive, needs_cutout = false
    where id = p_photo;
  insert into public.moderation_actions (target_user_id, action, reason, admin_id)
  values (ph.owner_id, 'photo_cutout_waive', motive, (select auth.uid()));
end;
$$;
revoke execute on function public.photo_cutout_waiver_reasons() from public, anon, authenticated;
revoke execute on function public.admin_waive_cutout(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_waive_cutout(uuid, text, text) to authenticated;

-- « Valider sans détourage »: the waiver and the validation in one transaction (the same
-- validation as admin_decide_photo: public files, notification without the motive).
create function public.admin_approve_without_cutout(p_photo uuid, p_reason text, p_detail text,
  p_public_large text, p_public_small text)
returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  perform public.admin_waive_cutout(p_photo, p_reason, p_detail);
  return public.admin_decide_photo(p_photo, true, null, p_public_large, p_public_small);
end;
$$;
revoke execute on function public.admin_approve_without_cutout(uuid, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_approve_without_cutout(uuid, text, text, text, text) to authenticated;

-- The displays know a waived pose (a print), never its motive.
create or replace function public.public_photos(p_owner uuid, p_positions smallint[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('position', ph.position, 'large', ph.public_path_large,
                                               'small', ph.public_path_small, 'cutout', ph.is_cutout,
                                               'waived', ph.cutout_waived and not ph.is_cutout)
                            order by ph.position), '[]')
  from public.photos ph
  where ph.owner_id = p_owner and ph.status = 'approved' and ph.position = any (p_positions)
$$;

-- The batch of the Greffe (preview only) leaves the waived poses alone.
create or replace function public.admin_photo_batch(p_limit integer)
returns table (photo_id uuid, photo_position smallint, pseudo text, role public.member_role,
               public_path_large text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if not (select s.photo_batch_allowed from public.app_settings s) then
    raise exception 'batch_not_allowed' using errcode = '42501';
  end if;
  return query
    select ph.id, ph.position, p.pseudo::text, p.role, ph.public_path_large
    from public.photos ph join public.profiles p on p.id = ph.owner_id
    where ph.status = 'approved' and ph.position <= 2 and ph.recut_at is null
      and not ph.cutout_waived and ph.public_path_large is not null
    order by ph.reviewed_at nulls first, ph.id
    limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

create or replace function public.admin_replace_public_photo(p_photo uuid, p_large text, p_small text)
returns table (old_large text, old_small text)
language plpgsql security definer set search_path = '' as $$
declare
  previous_large text;
  previous_small text;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if not (select s.photo_batch_allowed from public.app_settings s) then
    raise exception 'batch_not_allowed' using errcode = '42501';
  end if;
  if p_large is null or p_small is null or p_large like '%/%' or p_small like '%/%' then
    raise exception 'invalid_path' using errcode = '22023';
  end if;
  select ph.public_path_large, ph.public_path_small into previous_large, previous_small
    from public.photos ph
    where ph.id = p_photo and ph.status = 'approved' and ph.position <= 2 and ph.recut_at is null
      and not ph.cutout_waived
    for update;
  if not found then raise exception 'photo_not_in_batch' using errcode = 'P0001'; end if;
  update public.photos
    set public_path_large = p_large, public_path_small = p_small, is_cutout = true, recut_at = now()
    where id = p_photo;
  return query select previous_large, previous_small;
end;
$$;
