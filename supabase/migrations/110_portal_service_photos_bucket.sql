-- ============================================================================
-- Migration 110: Storage bucket for portal service request photos
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'portal-service-photos',
  'portal-service-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']::text[]
)
on conflict (id) do nothing;

drop policy if exists "portal_service_photos_insert" on storage.objects;
create policy "portal_service_photos_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'portal-service-photos'
    and (storage.foldername(name))[1] = public.get_portal_customer_id()::text
  );

drop policy if exists "portal_service_photos_select" on storage.objects;
create policy "portal_service_photos_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'portal-service-photos'
    and (storage.foldername(name))[1] = public.get_portal_customer_id()::text
  );

drop policy if exists "portal_service_photos_delete" on storage.objects;
create policy "portal_service_photos_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'portal-service-photos'
    and (storage.foldername(name))[1] = public.get_portal_customer_id()::text
  );
