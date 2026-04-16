-- ============================================================================
-- Migration 278: Move pg_trgm extension from public -> extensions schema
--
-- Closes advisor warning "Extension in Public" and the 31 residual
-- function_search_path_mutable warnings that trace back to pg_trgm's C
-- functions living in public (they can't be ALTERed individually — the
-- extension owns them).
--
-- Safety notes:
--   - 5 GIN indexes use gin_trgm_ops (qrm_companies, qrm_contacts x3,
--     flare_reports). Operator-class OIDs are stable across
--     `ALTER EXTENSION SET SCHEMA`, so the indexes remain valid.
--   - All other extensions already live in `extensions` (pg_net,
--     pgcrypto, postgis, uuid-ossp, vector, pg_stat_statements).
--   - Every function in this codebase that references % / <-> /
--     similarity() either runs with search_path = public, extensions,
--     pg_temp (migrations 271, 276, 277 pinned this on all public funcs)
--     or is an edge-function SQL call where Postgrest resolves via the
--     role search_path which already includes extensions.
-- ============================================================================

alter extension pg_trgm set schema extensions;

-- Sanity check comment — dependent indexes should show `gin_trgm_ops`
-- prefixed with `extensions.` after this runs (pg_indexes will display it).
comment on extension pg_trgm is
  'Trigram matching (moved to extensions schema, migration 278).';

-- ============================================================================
-- Migration 278 complete.
-- ============================================================================
