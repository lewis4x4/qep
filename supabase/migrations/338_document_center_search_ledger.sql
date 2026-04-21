-- Migration 338 — Document Center: prediction ledger coverage for search + ask
--
-- The qrm_predictions ledger (migration 208) constrained `subject_type` to the
-- QRM deal/contact/company/quote/demo/task set. Slice V (Cmd-K search) and
-- Slice IV (Ask on a document) need to write ledger rows against documents
-- and document_chunks, so the constraint is widened to include:
--
--   • 'document'        — a row keyed to a specific document_id
--   • 'document_chunk'  — a row keyed to a chunk_id (for Ask citations)
--   • 'document_search' — a row keyed to a synthetic search trace uuid; the
--                         actual query text lives in rationale, and the
--                         trace_id links the row to click-through events
--
-- No data migration. Every existing subject_type value remains valid.

alter table public.qrm_predictions
  drop constraint if exists qrm_predictions_subject_type_check;

alter table public.qrm_predictions
  add constraint qrm_predictions_subject_type_check
  check (
    subject_type = any (
      array[
        'deal',
        'contact',
        'company',
        'quote',
        'demo',
        'task',
        'document',
        'document_chunk',
        'document_search'
      ]
    )
  );

comment on constraint qrm_predictions_subject_type_check on public.qrm_predictions is
  'Allowed subject_type values. Widened in migration 338 to cover Document Center surfaces (search, ask, twin). When adding new values, also extend the Iron/QRM code paths that read this column.';
