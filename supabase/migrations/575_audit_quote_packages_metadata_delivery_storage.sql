-- Audit hardening: quote_packages prospect/metadata columns, delivery preview
-- artifact binding, IntelliDealer staging workspace defaults, documents bucket insert.

-- ── quote_packages: metadata + prospect flags (edge + quote-api already send these) ──

alter table public.quote_packages
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists is_prospect_quote boolean not null default false,
  add column if not exists customer_warmth text;

alter table public.quote_packages
  drop constraint if exists quote_packages_customer_warmth_chk;

alter table public.quote_packages
  add constraint quote_packages_customer_warmth_chk
  check (
    customer_warmth is null
    or customer_warmth in ('warm', 'cool', 'dormant', 'new')
  );

comment on column public.quote_packages.metadata is
  'Opaque JSON bag for wizard extensions (e.g. prospect_conversion_source). Merged on save in quote-builder-v2.';
comment on column public.quote_packages.is_prospect_quote is
  'True when the quote was started as a prospect before CRM company/contact link.';
comment on column public.quote_packages.customer_warmth is
  'Rep-facing warmth label: warm, cool, dormant, new.';

-- ── quote_delivery_events: preview inserts must not reference another package''s artifact ──

drop policy if exists "qde_client_preview_insert" on public.quote_delivery_events;

create policy "qde_client_preview_insert" on public.quote_delivery_events
  for insert with check (
    workspace_id = (select public.get_my_workspace())
    and public.quote_package_accessible_to_me(quote_package_id)
    and channel = 'preview'
    and status = 'draft'
    and coalesce(provider, '') in ('local_preview', 'stored_pdf_preview')
    and (
      document_artifact_id is null
      or exists (
        select 1
        from public.quote_document_artifacts a
        where a.id = document_artifact_id
          and a.quote_package_id = quote_package_id
      )
    )
  );

-- ── IntelliDealer staging: drop unsafe default that evaluated get_my_workspace() at DDL time ──

alter table if exists public.qrm_intellidealer_equipment_master_stage
  alter column workspace_id drop default;
alter table if exists public.qrm_intellidealer_quotes_history_stage
  alter column workspace_id drop default;
alter table if exists public.qrm_intellidealer_parts_master_stage
  alter column workspace_id drop default;
alter table if exists public.qrm_intellidealer_service_history_stage
  alter column workspace_id drop default;

-- ── documents bucket: inserts must land under the caller''s uid prefix (matches select policy) ──

drop policy if exists "documents_storage_insert" on storage.objects;

create policy "documents_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and (select auth.role()) = 'authenticated'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
