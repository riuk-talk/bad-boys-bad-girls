-- Photos on the height chart (owner's decision 2026-10-23, version B). The member's browser cuts
-- the person out before sending (MediaPipe, on the device); the server keeps the transparency only
-- when the file really has some, and says so here. Displays use it to put the cut-out photo in
-- front of the fixed wall, or the graduations over a photo kept as it is (version A). Set by the
-- server with the secret key: members still write only the columns they wrote before.

alter table public.photos add column is_cutout boolean not null default false;

-- Same function as Phase 4, plus `cutout` (the Fiche, and the Permis through it).
create or replace function public.public_photos(p_owner uuid, p_positions smallint[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('position', ph.position, 'large', ph.public_path_large,
                                               'small', ph.public_path_small, 'cutout', ph.is_cutout)
                            order by ph.position), '[]')
  from public.photos ph
  where ph.owner_id = p_owner and ph.status = 'approved' and ph.position = any (p_positions)
$$;

-- The Greffe shows each pending photo as it will be displayed: whether it is cut out.
create function public.admin_photo_cutouts(p_ids uuid[])
returns table (photo_id uuid, is_cutout boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return query select ph.id, ph.is_cutout from public.photos ph where ph.id = any (p_ids);
end;
$$;
revoke execute on function public.admin_photo_cutouts(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_photo_cutouts(uuid[]) to authenticated;
