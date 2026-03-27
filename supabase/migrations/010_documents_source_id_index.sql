-- PERF-QEP-009: Add UNIQUE index on documents.source_id
--
-- Problem (Finding #9): The ingest function calls:
--   .upsert({...}, { onConflict: 'source_id' })
-- Without a UNIQUE constraint, Postgres cannot use ON CONFLICT targeting and
-- must do a sequential scan. As document count grows, sync performance degrades
-- linearly. Supabase may also throw an error on the upsert without this index.
--
-- Fix: Partial UNIQUE index (WHERE source_id IS NOT NULL) so rows without a
-- source_id (manually uploaded files) are unaffected.
--
-- Rollback: DROP INDEX IF EXISTS documents_source_id_unique;

CREATE UNIQUE INDEX documents_source_id_unique
  ON public.documents(source_id)
  WHERE source_id IS NOT NULL;
