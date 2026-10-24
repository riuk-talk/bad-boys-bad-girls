-- 9i (owner's decision 2026-10-24): the batch of the Greffe (preview only, photo_batch_allowed) re-cuts
-- every validated pose with the new engine (MODNet, edge treatment), the ones already cut out by
-- the previous engine included. A pose leaves the batch once re-cut (recut_at), not once cut out.
-- Written by the server only (security definer functions below), like is_cutout.
alter table public.photos add column recut_at timestamptz;
comment on column public.photos.recut_at is
  'When the Greffe re-cut this validated pose in the batch (9i, preview only).';

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
      and ph.public_path_large is not null
    order by ph.reviewed_at nulls first, ph.id
    limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

-- Replaces a validated photo by its new cut-out (new random names, written by the server).
-- Returns the previous files, to be removed.
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
    for update;
  if not found then raise exception 'photo_not_in_batch' using errcode = 'P0001'; end if;
  update public.photos
    set public_path_large = p_large, public_path_small = p_small, is_cutout = true, recut_at = now()
    where id = p_photo;
  return query select previous_large, previous_small;
end;
$$;
