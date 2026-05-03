-- ============================================================================
-- Migration 514: IntelliDealer customer import workbook upload storage
--
-- Bucket used by the admin IntelliDealer customer import preview flow to stage
-- uploaded xlsx files before the intellidealer-customer-import edge function
-- parses and audits them.
--
-- Pattern: one path prefix per user:
--   {user_id}/{timestamp}-{uuid}-{filename}.xlsx
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'intellidealer-customer-imports',
  'intellidealer-customer-imports',
  false,
  52428800, -- 50MB; current Customer Master.xlsx is ~6.5MB
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream'
  ]
)
on conflict (id) do nothing;

create policy "intellidealer_customer_imports_insert_admin"
  on storage.objects for insert
  with check (
    bucket_id = 'intellidealer-customer-imports'
    and (select auth.role()) = 'authenticated'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (
      (select role from public.profiles where id = (select auth.uid()))
      in ('admin', 'manager', 'owner')
    )
  );

create policy "intellidealer_customer_imports_select_admin"
  on storage.objects for select
  using (
    bucket_id = 'intellidealer-customer-imports'
    and (select auth.role()) = 'authenticated'
    and (
      (select role from public.profiles where id = (select auth.uid()))
      in ('admin', 'manager', 'owner')
    )
  );

create policy "intellidealer_customer_imports_delete_admin"
  on storage.objects for delete
  using (
    bucket_id = 'intellidealer-customer-imports'
    and (select auth.role()) = 'authenticated'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (
      (select role from public.profiles where id = (select auth.uid()))
      in ('admin', 'manager', 'owner')
    )
  );

-- Service role retains unrestricted access for edge function parsing.

-- ============================================================================
-- Migration 514 complete.
-- ============================================================================
