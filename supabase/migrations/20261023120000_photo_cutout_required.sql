-- Photos on the height chart, final decision of the owner (2026-10-23): the same wall for everyone,
-- no choice. The 3 poses of a Bad and the photo of a Visitor (positions 0 to 2) are always cut
-- out. The member's browser does it at the upload; when it cannot, the original is sent and waits
-- for the Greffe, which cuts it out in the admin's browser (same tool) before it can be validated.

alter table public.photos add column needs_cutout boolean not null default false;

-- Pending poses sent before this decision and not cut out: the Greffe cuts them out first.
update public.photos set needs_cutout = true
where status = 'pending' and position <= 2 and not is_cutout;

-- A photo waiting for its cut-out is never validated as it is.
alter table public.photos add constraint photos_cutout_before_approval
  check (not (status = 'approved' and needs_cutout));

-- A pose sent by a member waits for its cut-out until the server has found the transparency in
-- the file (the server then clears it with the secret key). Rows written by the server, the seed
-- or the tests (other roles) keep the defaults.
create function public.photos_cutout_default()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    new.is_cutout := false;
    new.needs_cutout := new.position <= 2;
  end if;
  return new;
end;
$$;
revoke execute on function public.photos_cutout_default() from public, anon, authenticated;
create trigger photos_cutout_default
  before insert on public.photos
  for each row execute function public.photos_cutout_default();

-- The Greffe: which pending photos still wait for their cut-out.
create function public.admin_photos_to_cut_out(p_ids uuid[])
returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query select ph.id from public.photos ph
    where ph.id = any (p_ids) and ph.status = 'pending' and ph.needs_cutout;
end;
$$;
revoke execute on function public.admin_photos_to_cut_out(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_photos_to_cut_out(uuid[]) to authenticated;

-- The Greffe records its cut-out of a pending photo: the server has checked the transparency of
-- the new file and stored it in the owner's folder. Returns the previous file, to be removed.
create function public.admin_store_cutout(p_photo uuid, p_pending_path text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  previous text;
  owner uuid;
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select ph.pending_path, ph.owner_id into previous, owner from public.photos ph
    where ph.id = p_photo and ph.status = 'pending' and ph.needs_cutout
    for update;
  if not found then raise exception 'photo_not_waiting_cutout' using errcode = 'P0001'; end if;
  if p_pending_path is null or p_pending_path not like owner::text || '/%' then
    raise exception 'invalid_path' using errcode = '22023';
  end if;
  update public.photos set pending_path = p_pending_path, is_cutout = true, needs_cutout = false
    where id = p_photo;
  return previous;
end;
$$;
revoke execute on function public.admin_store_cutout(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_store_cutout(uuid, text) to authenticated;

------------------------------------------------------------------------------------------------
-- Preview only: cutting out, in a batch, the photos validated before this decision
------------------------------------------------------------------------------------------------
-- Off everywhere. Switched on by hand on the preview base only; never on the production base.
alter table public.app_settings add column photo_batch_allowed boolean not null default false;

create function public.admin_photo_batch(p_limit integer)
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
    where ph.status = 'approved' and ph.position <= 2 and not ph.is_cutout
      and ph.public_path_large is not null
    order by ph.reviewed_at nulls first, ph.id
    limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;
revoke execute on function public.admin_photo_batch(integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_photo_batch(integer) to authenticated;

-- Replaces a validated photo by its cut-out (new random names, written by the server). Returns
-- the previous files, to be removed.
create function public.admin_replace_public_photo(p_photo uuid, p_large text, p_small text)
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
    where ph.id = p_photo and ph.status = 'approved' and ph.position <= 2 and not ph.is_cutout
    for update;
  if not found then raise exception 'photo_not_in_batch' using errcode = 'P0001'; end if;
  update public.photos set public_path_large = p_large, public_path_small = p_small, is_cutout = true
    where id = p_photo;
  return query select previous_large, previous_small;
end;
$$;
revoke execute on function public.admin_replace_public_photo(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_replace_public_photo(uuid, text, text) to authenticated;
