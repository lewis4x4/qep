-- ============================================================================
-- THIS FILE IS A PLACEHOLDER — SUPERSEDED FOR QEP
--
-- The original SCC version of this migration assumed an existing roadmap_tasks
-- table. QEP starts without that table, so the QEP equivalent migration:
--
--   /Users/brianlewis/Projects/qep-knowledge-assistant/supabase/migrations/
--     593_qep_roadmap_tasks.sql
--
-- creates the table from scratch AND includes the v2 reverse-sync RPC, audit
-- log, and health view in the same file.
--
-- Do NOT apply this file against the QEP Supabase project. It exists only so
-- the package's repository layout matches the SCC source.
-- ============================================================================

-- Intentionally empty.
SELECT 'qep_roadmap_tasks schema lives in supabase/migrations/593_qep_roadmap_tasks.sql' AS info;
