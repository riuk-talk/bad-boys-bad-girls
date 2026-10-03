-- Photo storage (SPEC §11): private "photos-pending" bucket written by the owner only, public
-- "photos" bucket written only by the server (secret key) after human validation.
-- WebP only, 256 KiB max per file (client targets: 180 KB large, 30 KB thumbnail).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('photos-pending', 'photos-pending', false, 262144, array['image/webp']),
  ('photos', 'photos', true, 262144, array['image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Owner-only access to their own folder "{user_id}/..." in the pending bucket. No update policy:
-- a file is never overwritten in place (new upload = new path).
create policy "pending photos: owner uploads into own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos-pending' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "pending photos: owner reads own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'photos-pending' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "pending photos: owner deletes own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos-pending' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- The public "photos" bucket has no policy on purpose: files are served by unguessable URL and
-- only the server (secret key, bypassing RLS) writes or deletes them.

-- Covering indexes for foreign keys (performance advisor).
create index flagged_texts_user on public.flagged_texts (user_id);
create index launch_zones_center_place on public.launch_zones (center_place_id);
create index profile_tribes_tribe on public.profile_tribes (tribe_id);
