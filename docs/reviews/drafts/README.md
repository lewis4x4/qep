# Stream M/N seed drafts — APPLIED 2026-07-08

The drafts that lived here were red-lined, approved, and promoted to real migrations. This directory is retained only as the pointer trail.

**Where everything went:**

- `stream-m-seed.sql` → [783_qep_stream_m_enum.sql](../../../supabase/migrations/783_qep_stream_m_enum.sql) + [784_qep_stream_m_revenue_convergence.sql](../../../supabase/migrations/784_qep_stream_m_revenue_convergence.sql) (enum/seed split per the red-line: `ADD VALUE` can't be used in the transaction that adds it under db-push's per-file txn)
- `stream-n-seed.sql` → [785_qep_stream_n_enum.sql](../../../supabase/migrations/785_qep_stream_n_enum.sql) + [786_qep_stream_n_seam_completion.sql](../../../supabase/migrations/786_qep_stream_n_seam_completion.sql) (includes the L9.1–L9.5 rental seam rows; N0.1 seeded as `shipped` — PR #76)
- Sync tooling updated in the same commit: `roadmap-linear-sync/scripts/lib/status-map.mjs`, `regen-unified-roadmap.mjs`, both `sync-roadmap-linear` edge functions (union type + project map), `scripts/check-roadmap-source-truth.mjs` (expectedStreams A–N + 783–786 seed-count checks)

**Sources of truth:** [review report](../2026-07-08-full-codebase-review.md) · [findings JSON](../2026-07-08-findings.json) · [Stream M blueprint](../../finance/REVENUE-CONVERGENCE-BLUEPRINT.md)
