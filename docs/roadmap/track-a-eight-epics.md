# Track A — Eight roadmap epics (Cursor todos → durable tracking)

This file **exports** the eight operator-roadmap items that previously lived only as Cursor checklist todos. Each row maps to a **GitHub issue** on `lewis4x4/qep` (created as part of Track A). After you confirm the issues exist, **clear or archive the eight todos in Cursor** so the checklist does not drift from GitHub.

**Parent context:** `.omx/plans/2026-05-15-post-audit-backlog-and-supply-chain.plan.md` (local; not in git — copy key sections here if you need them versioned).

---

## Epic index (issue links filled in after `gh issue create`)

| # | Epic | GitHub |
|---|------|--------|
| 1 | Wizard UX refactor (intake, steps, live margin, mobile) | https://github.com/lewis4x4/qep/issues/39 ([verification](./epic-39-wizard-ux-verification.md)) |
| 2 | Migrations 560–564 sequencing + verification ([rollout runbook](./track-b-560-564-rollout.md)) | https://github.com/lewis4x4/qep/issues/40 |
| 3 | Step 3/5 UI regrouping + internal-line PDF/proposal rules | https://github.com/lewis4x4/qep/issues/41 |
| 4 | Aged-inventory bypass + post-approval routing (migrations + edge) | https://github.com/lewis4x4/qep/issues/42 |
| 5 | IntelliDealer snapshot ETL + M365 token refresh observability | https://github.com/lewis4x4/qep/issues/43 |
| 6 | Trade valuation source audit + comp-range UI (customer PDF unchanged) | https://github.com/lewis4x4/qep/issues/44 |
| 7 | Advisor home v1 (`iron_advisor` /floor) + prospect at quote-sent | https://github.com/lewis4x4/qep/issues/45 |
| 8 | Merge ordering, conflicts, 28-criteria staging verification | https://github.com/lewis4x4/qep/issues/46 |

**Epic #39 (wizard UX):** [epic-39-wizard-ux-verification.md](./epic-39-wizard-ux-verification.md)  
**Epic #41 (customer PDF line visibility):** [epic-41-customer-pdf-line-visibility.md](./epic-41-customer-pdf-line-visibility.md)  
**Epic #42 (post-approval routing):** [epic-42-post-approval-routing.md](./epic-42-post-approval-routing.md)  
**Epic #43 (M365 + IntelliDealer observability):** [epic-43-m365-intellidealer-observability.md](./epic-43-m365-intellidealer-observability.md)  
**Epic #44 (trade valuation + comp-range UI):** [epic-44-trade-valuation-audit.md](./epic-44-trade-valuation-audit.md)  
**Epic #45 (advisor floor + prospect):** [epic-45-advisor-floor-handoff.md](./epic-45-advisor-floor-handoff.md)  
**Epic #46 (merge ordering + staging verification):** [epic-46-intellidealer-merge-staging-verification.md](./epic-46-intellidealer-merge-staging-verification.md)

---

## One-shot automated verification (Track A #39–#46 repo checks)

```bash
cd /Users/brianlewis/Projects/qep-knowledge-assistant
bun run verify:track-a-epics
```

Covers: **#39** (page normalizers + floor layout + wizard draft tests), **#40** (`verify:track-b-560-564`), **#41** (`quote-proposal-data`), **#42** (via `quote-api` + `local-draft` tests), **#44** (trade valuation tests), **#45** (floor tests), **#43** (M365 edge `deno check` + `audit:secrets`). Does **not** replace staging SQL, dashboard secrets, manual `/floor` screenshots, or stakeholder **#46** criteria — see per-epic runbooks.

---

## Shared definition of done (all epics)

- `bun run migrations:check` and `bun run build` (repo root) green for touched slices.
- If migrations or edges change: `supabase db push` on staging + `segment:gates` per `AGENTS.md` where applicable.
- No secrets in client; RLS/workspace rules preserved.

---

## Repo anchors (copy into issues)

| Epic | Primary paths |
|------|----------------|
| 1 | `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx` (`WIZARD_STEPS` ~L172+), quote-builder lib |
| 2 | `supabase/migrations/560_*.sql` … `564_*.sql`, rollout runbook |
| 3 | Quote builder configure/pricing steps, `QuotePDFDocument` / proposal builders |
| 4 | `supabase/migrations/566_quote_post_approval_action.sql`, `quote-builder-v2`, approval flows |
| 5 | `568_intellidealer_*`, `567_m365_token_refresh_cron.sql`, `m365-token-refresh`, `m365-mailbox-sync` |
| 6 | Trade valuation APIs + UI, `useQuotePDF` / customer PDF path |
| 7 | `docs/sales-rep-home-handoff.md`, `/floor`, advisor stats |
| 8 | IntelliDealer staging/commit jobs, conflict UX, acceptance checklist from stakeholder |

---

## Operator checklist (you)

1. Open each GitHub issue from the table above.
2. In Cursor, **check off or delete** the eight ephemeral todos so they match GitHub.
3. Link QUA sprint parents in your tracker when you assign owners.

## Residual work (human / staging — not automated by `verify:track-a-epics`)

| Epic | Owner action |
|------|----------------|
| **#39** | Product sign-off on mobile wizard + live margin in real staging deals ([`epic-39-wizard-ux-verification.md`](./epic-39-wizard-ux-verification.md) manual section). |
| **#40** | Record dates in GitHub #40 after `supabase db push` to each environment; optional PDI backfill per [`track-b-560-564-rollout.md`](./track-b-560-564-rollout.md) §4. |
| **#41** | Human review of generated customer PDFs vs internal-only lines on staging. |
| **#42** | End-to-end approved package + `send-package` path on staging with both `post_approval_action` values. |
| **#43** | Supabase Dashboard secrets (`MSGRAPH_*`, etc.); SQL health queries in [`epic-43-*.md`](./epic-43-m365-intellidealer-observability.md); staging lane row counts. |
| **#44** | Spot-check rep UI vs customer packet on a real quote in staging. |
| **#45** | Run [`scripts/verify/advisor-floor-phase-a.sql`](../../scripts/verify/advisor-floor-phase-a.sql); capture `/floor` desktop + mobile screenshots for #45. |
| **#46** | Attach 28-criteria checklist to GitHub #46; run `bun ./scripts/verify-intellidealer-snapshot-stage.mjs` (and related scripts) with service role against staging. |
