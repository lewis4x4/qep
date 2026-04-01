-- Hot FK and WHERE-clause indexes identified by post-build schema audit.
-- These cover the most frequently joined/filtered columns that lacked btree coverage.

-- chunks: cascade deletes and document-scoped retrieval
create index if not exists idx_chunks_document_id
  on public.chunks (document_id);

-- sequence_enrollments: FK join from follow_up_sequences
create index if not exists idx_sequence_enrollments_sequence_id
  on public.sequence_enrollments (sequence_id);

-- analytics_events: workspace-scoped reporting queries
create index if not exists idx_analytics_events_workspace_occurred
  on public.analytics_events (workspace_id, occurred_at desc);

-- crm_reminder_instances: dispatcher scans for scheduled reminders by workspace
create index if not exists idx_crm_reminder_instances_workspace_scheduled
  on public.crm_reminder_instances (workspace_id, status, deleted_at)
  where status = 'scheduled' and deleted_at is null;

-- documents: admin UI filters by uploader
create index if not exists idx_documents_uploaded_by
  on public.documents (uploaded_by)
  where uploaded_by is not null;
