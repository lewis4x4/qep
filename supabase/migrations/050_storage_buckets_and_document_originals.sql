-- Ensure storage buckets exist for voice recordings and original uploaded documents.
-- Also normalize allowed MIME types so Safari voice notes and Office uploads work.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice-recordings',
  'voice-recordings',
  false,
  52428800,
  array[
    'audio/webm',
    'audio/mp4',
    'audio/ogg',
    'audio/mpeg',
    'audio/wav',
    'audio/x-m4a',
    'audio/aac'
  ]::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  52428800,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/csv'
  ]::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "documents_storage_insert" on storage.objects;
create policy "documents_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and auth.role() = 'authenticated'
  );

drop policy if exists "documents_storage_select" on storage.objects;
create policy "documents_storage_select" on storage.objects
  for select using (
    bucket_id = 'documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.get_my_role() in ('admin', 'manager', 'owner')
    )
  );

drop policy if exists "documents_storage_delete" on storage.objects;
create policy "documents_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.get_my_role() in ('admin', 'manager', 'owner')
    )
  );
