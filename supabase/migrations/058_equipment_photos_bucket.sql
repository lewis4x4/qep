-- Storage bucket for equipment photos taken via AI Vision or uploaded manually.
-- Photos are PUBLIC so they can be displayed inline without signed URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'equipment-photos',
  'equipment-photos',
  true,
  20971520, -- 20 MB
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Authenticated users can upload equipment photos.
drop policy if exists "equipment_photos_insert" on storage.objects;
create policy "equipment_photos_insert" on storage.objects
  for insert with check (
    bucket_id = 'equipment-photos'
    and (auth.role() = 'authenticated' or auth.role() = 'service_role')
  );

-- Anyone can view (bucket is public for inline display).
drop policy if exists "equipment_photos_select" on storage.objects;
create policy "equipment_photos_select" on storage.objects
  for select using (
    bucket_id = 'equipment-photos'
  );

-- Only uploader or elevated roles can delete.
drop policy if exists "equipment_photos_delete" on storage.objects;
create policy "equipment_photos_delete" on storage.objects
  for delete using (
    bucket_id = 'equipment-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.get_my_role() in ('admin', 'manager', 'owner')
      or auth.role() = 'service_role'
    )
  );
