-- Align documents_storage_insert with RLS initplan guard (subselect auth.*).

drop policy if exists "documents_storage_insert" on storage.objects;

create policy "documents_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and (select auth.role()) = 'authenticated'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
