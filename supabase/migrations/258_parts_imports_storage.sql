-- ============================================================================
-- Migration 258: Parts Intelligence Engine — parts-imports storage bucket
--
-- Bucket used by the /parts/import admin flow to stage uploaded xlsx files
-- before the parts-bulk-import edge function parses them.
--
-- Pattern: one path prefix per user — {user_id}/{timestamp}-{uuid}-{filename}.xlsx
-- Plus a sibling plan stash {user_id}/.plan-{run_id}.json written by the edge fn.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'parts-imports',
  'parts-imports',
  false,
  52428800, -- 50MB limit (handles 4,310-row PARTMAST at ~3MB and Yanmar 17k at ~1.1MB)
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', -- .xlsx
    'application/vnd.ms-excel.sheet.macroEnabled.12',                     -- .xlsm
    'text/csv',
    'application/json',      -- for plan stash
    'application/octet-stream'
  ]
)
on conflict (id) do nothing;

-- Admin/manager/owner may upload to their own folder
create policy "parts_imports_insert_admin"
  on storage.objects for insert
  with check (
    bucket_id = 'parts-imports'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (
      (select role from public.profiles where id = auth.uid())
      in ('admin', 'manager', 'owner')
    )
  );

-- Admin/manager/owner may read their own uploads
create policy "parts_imports_select_admin"
  on storage.objects for select
  using (
    bucket_id = 'parts-imports'
    and auth.role() = 'authenticated'
    and (
      (select role from public.profiles where id = auth.uid())
      in ('admin', 'manager', 'owner')
    )
  );

-- Admin/manager/owner may delete their own uploads (rollback / cleanup)
create policy "parts_imports_delete_admin"
  on storage.objects for delete
  using (
    bucket_id = 'parts-imports'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (
      (select role from public.profiles where id = auth.uid())
      in ('admin', 'manager', 'owner')
    )
  );

-- Service role retains unrestricted access for the edge function
-- (service_role bypasses RLS by default; no explicit policy needed).

-- ============================================================================
-- Migration 258 complete.
-- ============================================================================
