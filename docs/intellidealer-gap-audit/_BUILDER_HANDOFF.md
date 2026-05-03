# Builder Handoff — Execute the IntelliDealer → QEP Migration

This document is the **single brief** you give to the implementer (human engineer or agent) to execute the audit. The implementer does **not** need to read the conversation that produced the audit bundle — everything they need is below or referenced from here.

---

## Copy-paste prompt (give this to the implementer)

> You are the implementer for the IntelliDealer → QEP gap-audit cutover work.
>
> The audit is **finished and authoritative**. Your job is to execute it — write migrations, ship them in the documented wave order, and report progress. **Do not re-audit. Do not second-guess severity calls. Do not redesign tables.** The decisions are made; you are translating YAML migration_hints into shipped SQL + UI.
>
> ## Repo + scope
>
> - Repo root: `/Users/brianlewis/Projects/qep-knowledge-assistant`
> - Migrations dir: `supabase/migrations/` (current max prefix: check before each new file; was `396_*` when audit was generated)
> - Schema source of truth: `qep/apps/web/src/lib/database.types.ts`
> - Engineering contract: `qep/CLAUDE.md` (read this first — Mission Lock, Backend Conventions, Build Gates, Working Rules all apply)
>
> ## Inputs (read in this order, then begin work)
>
> 1. `docs/intellidealer-gap-audit/README.md` — orientation, severity legend, file layout
> 2. `docs/intellidealer-gap-audit/_migration_order.md` — your execution sequence (Waves 0 → 5)
> 3. `docs/intellidealer-gap-audit/_blockers.csv` — regenerated current must-fix list, sortable
> 4. `docs/intellidealer-gap-audit/manifest.yaml` — index + per-phase counts
> 5. The 9 phase YAMLs in `docs/intellidealer-gap-audit/phase-*.yaml` and `cross-cutting.yaml` — open the one whose wave/section you're currently working
>
> Each YAML field entry already contains: `migration_hint` (concrete SQL), `qep_table`, `qep_column`, `dependencies`, `ui_surface_hint`. **Use them verbatim** unless you find a hard incompatibility with current schema state, in which case stop and surface the conflict (do not silently rewrite).
>
> ## Pre-flight (do once before Wave 0)
>
> 1. Run `ls supabase/migrations/ | grep -E '^[0-9]{3}_' | sort -r | head -1` — record the current max prefix. All your new migration files start at `max + 1`.
> 2. Take a `pg_dump --schema-only` snapshot. Stash it locally in `/tmp/qep-pre-cutover-schema.sql`. You will need it to reverse anything that breaks.
> 3. Resolve the two open schema decisions (or ask Brian if you're not authorized to decide):
>    - **`collection_agencies` vs `ar_agencies`** → default: consolidate to `ar_agencies`. Treat Phase-9 `collection_agencies` as a duplicate; do not create.
>    - **`equipment_invoices` table vs view** → default: build a view `equipment_invoices` over `customer_invoices WHERE invoice_type = 'equipment'`. Do not create a parallel table.
>    Update the relevant phase YAML if you change the default.
> 4. Confirm GL naming reconciliation: Phase-5 YAML uses `qrm_gl_accounts` in some places but the `_migration_order.md` Pre-flight already says use `gl_accounts` (Phase-8 authoritative). Update Phase-5 YAML before generating its DDL.
> 5. Confirm segments naming: Phase-5 mentions `qrm_work_order_segments`; reuse Phase-4's `service_job_segments`. Already noted in `_migration_order.md`.
>
> ## Execution rules
>
> - **One wave at a time.** Don't start Wave N+1 until Wave N is shipped, tested, and merged.
> - **Within a wave, parallelize** — independent migrations land in any order. Inter-table FK order within a wave is called out in `_migration_order.md`.
> - **One migration file per concern.** Group ALTER TABLE columns by target table (so `ALTER TABLE qrm_companies ADD COLUMN ...` is one file, not split). New tables are one file each.
> - **Naming:** `NNN_snake_case_description.sql` per `qep/CLAUDE.md` Backend Conventions. Sequential, no gaps.
> - **Required columns on every new table:** `id uuid primary key default gen_random_uuid()`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`, `deleted_at timestamptz` if soft-delete applies. Already in the audit migration_hints — verify before commit.
> - **RLS is required on every user-facing table.** Use `get_my_role()` and `get_my_workspace()` helpers. The audit YAMLs do not specify policies for every table — extrapolate from existing nearby policies; do not invent a new pattern.
> - **Indexes must have explicit purpose.** No "just in case" indexes.
> - **Down-migrations matter.** For every up, write the corresponding down. Verify the down works on a clean copy of the snapshot before merging.
> - **Don't skip the build gates** in `qep/CLAUDE.md`: `bun run migrations:check`, `bun run build`, `bun run build` in `apps/web`, edge function tests for touched surfaces, role/workspace checks. Run all five before each PR.
>
> ## Wave-by-wave acceptance
>
> | Wave | Done when |
> |---|---|
> | 0 | EIN column shipped, format CHECK active, RLS masking non-finance roles, UI surface in Customer Profile (Details). |
> | 1 | All ~70 foundation tables exist with RLS, soft-delete where applicable. `bun run build` green. |
> | 2 | All ~200 column extensions across ~25 existing tables landed. Existing flows unbroken (regression suite green). |
> | 3 | Cross-table FKs wired, free-text status columns converted to typed enums, sensitive PII columns RLS-protected. |
> | 4 | Materialized views + computed views land. Seed initial refresh cron jobs. WIP aging report renders for at least one branch. |
> | 5 | Per-dealer rollout — only ship the OEM-specific tables (JD/Bobcat/Vermeer imports, AvaTax wiring, VESign, UPS WorldShip, Tethr) when the corresponding dealer is in scope. |
>
> ## Per-PR template
>
> Title: `feat(audit-wave-N): <table or column group>`
>
> Body:
> ```
> Wave: N
> Phase: Phase-X_Name
> Audit reference: docs/intellidealer-gap-audit/phase-X-name.yaml#field_id
> Migration files: supabase/migrations/NNN_*.sql
> Down-migration verified: yes/no
> Build gates: bun run migrations:check ✅ | bun run build ✅ | apps/web build ✅ | tests ✅ | role/workspace checks ✅
> UI surface shipped: <link to component file or 'pending'>
> ```
>
> Tag the PR with `audit-wave-N` so progress can be aggregated across the program.
>
> ## When to stop and ask
>
> - Audit YAML migration_hint conflicts with current schema (column already exists, type mismatch, etc.)
> - You discover a field the audit missed (rare — flag it; do **not** silently add it without updating the YAML)
> - You hit a real external dependency (AvaTax credentials missing, OEM portal API unavailable)
> - An irreversible / destructive operation (dropping a column, renaming a table) seems necessary
> - A naming reconciliation beyond the four documented in pre-flight surfaces
>
> Otherwise: keep moving. Per `qep/CLAUDE.md` Execution Cadence, "After every green delivery slice, continue directly into the next highest-value roadmap item without waiting for another user prompt."
>
> ## Reporting cadence
>
> - **End of each wave:** post a status summary to `docs/intellidealer-gap-audit/_migration_order.md` under a `## Status` section. Format: `Wave N: ✅ shipped 2026-MM-DD (migrations NNN-NNN, X tables/columns, all gates green)`.
> - **Per PR:** comment on a tracking issue (create one in this repo titled "IntelliDealer → QEP cutover: implementation tracker") with the PR link + audit reference.
> - **End of day:** Slack/email Brian with: waves landed today, blockers surfaced, next 24h plan.
>
> ## Brian's #1 anchor
>
> `customer.ein` is Wave 0. Ship it first. Days, not weeks. Brian has been waiting on this.
>
> ## Boundaries
>
> - Do not modify the audit YAMLs except to mark `qep_status: BUILT` after a column ships (per README "Update / maintenance" section).
> - Do not modify `manifest.yaml` directly — regenerate it from a script (the maintenance README explains).
> - Do not change app code beyond what migration_hints + ui_surface_hints prescribe. Refactors out of scope.
> - Do not run destructive operations (`git reset --hard`, force pushes, dropping prod tables) without explicit Brian approval.
> - No secrets in committed files. Ever.
>
> Ship Wave 0 today. Begin Wave 1 immediately after. Report back when Wave 0 is in production.

---

## How to deliver this prompt

**Option A — give to a Claude Code agent:**
```bash
cd /Users/brianlewis/Projects/qep-knowledge-assistant
claude code  # or your agent runner
# then paste the prompt block above as the first message
```

**Option B — give to a human engineer:**
Send them this file (`docs/intellidealer-gap-audit/_BUILDER_HANDOFF.md`) and the audit bundle URL. They have everything they need.

**Option C — kick off a multi-agent worktree run:**
Spawn one agent per wave (Wave 0 first, then parallel agents for Wave 1's independent table groups). The prompt above scoped to that wave's specific files works as the per-agent brief.

---

## What "done" looks like

When the implementer reports back:
- Wave 0 shipped → EIN column live, masked-by-role, UI surfaced. ~1-3 days.
- Wave 1 shipped → ~70 new foundation tables exist with RLS. ~2-3 weeks.
- Wave 2 shipped → ~200 column extensions land. ~2-3 weeks.
- Wave 3 shipped → FKs + enums tighten. ~1 week.
- Wave 4 shipped → Reports light up. ~1 week.
- Wave 5 ongoing → Per-dealer OEM rollout.

**Cutover-ready in ~10 weeks** if the implementer team executes against this brief without re-litigating audit decisions.

---

## If the implementer pushes back on the audit

The most common pushback patterns and how to handle:

| Pushback | Response |
|---|---|
| "We should redesign this table differently" | The audit is the contract. If they have a strong technical reason, they raise it as a blocking issue and Brian decides — they don't silently change. |
| "This field isn't really needed" | The severity tag (`must`/`should`/`could`) was set by the auditor reading dealer workflow. If they think a `must` is wrong, they document why and Brian re-tags. |
| "There are too many migrations" | Yes. That's the gap between IntelliDealer and QEP today. The waves let you ship in coherent slices. |
| "We don't have AvaTax/VESign/JD-portal credentials" | Wave 5 work — defer until credentials arrive. The columns ship; the integration wires up later. |
| "Brian needs to review every migration" | He doesn't. Per `qep/CLAUDE.md` Execution Cadence, autonomous execution is the default. Brian only steps in for the five "When to stop and ask" cases above. |

---

## You're done reviewing. The implementer takes it from here.
