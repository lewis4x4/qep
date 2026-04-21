-- Migration 343 — Document Center: external-source mirror primitives (Slice VIII)
--
-- Adds the two columns a OneDrive (or any external) mirror needs:
--   • document_folders.source_type:  'native' (default) | 'onedrive_mirror' | ...
--   • documents.external_source_id:  tenant:drive:item id when present; unique
--                                    (partial) so a single OneDrive item cannot
--                                    produce two documents rows in the same
--                                    workspace.
--
-- Zero-blocking integration architecture (CLAUDE.md Non-Negotiable):
-- external mirror state never gates native uploads. When OneDrive
-- credentials are revoked, uploads keep landing, the twin keeps running,
-- retrieval keeps answering — the mirror surfaces its degraded state
-- via document-onedrive-mirror's /health endpoint.
--
-- No data migration. Both columns are nullable / default-safe.

alter table public.document_folders
  add column if not exists source_type text not null default 'native'
    check (source_type in ('native', 'onedrive_mirror'));

alter table public.documents
  add column if not exists external_source_id text;

create unique index if not exists ux_documents_external_source_id
  on public.documents (workspace_id, external_source_id)
  where external_source_id is not null;

comment on column public.document_folders.source_type is
  'Slice VIII: native by default; onedrive_mirror when a folder is created by the OneDrive adapter. Controls UI affordances (edit/rename disabled on mirror folders).';
comment on column public.documents.external_source_id is
  'Slice VIII: tenant_id:drive_id:item_id for externally-sourced documents. Unique per workspace via partial index so the same OneDrive item never produces two rows.';
