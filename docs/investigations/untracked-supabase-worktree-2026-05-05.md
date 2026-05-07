# Investigation: Untracked Supabase and Worktree Deployment Status

## Summary
The tree is not clean: it contains multiple separable workstreams plus generated/artifact files. Supabase migrations `540` and `541` are applied remotely but remain untracked locally, creating urgent migration provenance risk; migration `544` is local-only/unapplied; Edge Function deployed-code parity for the modified local `crm-router` and `tax-calculator` sources is unproven and should be treated as drift risk until verified by bundle comparison or safe route probes.

## Symptoms
- Local worktree reportedly contains untracked QRM docs, prompt exports, counter components, OEM parser work, and Supabase migrations.
- Concern that some local Supabase-related changes may not have been pushed/applied/deployed.
- Quote Wizard commit should not bundle unrelated workstreams.

## Background / Prior Research

### Git archaeology probe — 2026-05-05
- Branch `main` tracks `origin/main`; probe reported `HEAD` and `origin/main` both at `873bfdf`, so the branch itself is not ahead/behind.
- Recent QRM Quote Wizard commits exist on 2026-05-05: `873bfdf` (Surface customer selection first in QRM wizard), `cae35c7`, `3dfed61`, `de62c11`, `427249a`.
- The current working tree still has 7 modified tracked files and the listed untracked files/groups. Probe found the untracked migrations, counter components, OEM parser files, QRM docs, and prompt exports have no git history and are not committed.
- Risk noted by probe: migrations 540/541 are not protected in git despite existing locally; `qrm-router-api.ts` and `crm-router-data.ts` contain meaningful unstaged local edits.

### Supabase remote status probe — 2026-05-05
- Probe ran read-only Supabase status/list checks and reported `supabase migration list` shows migrations `540` and `541` present in Local, Remote, and Time columns; remote migration count is in sync through 543.
- Probe summary of migration 540: adds `credit_memos`, sale reversal fields, and reversal/readiness database functions.
- Probe summary of migration 541: adds `oem_dealer_cost_tiers`, widens OEM import manufacturer checks, seeds ASV/Yanmar tiers, and updates OEM import integration config.
- Probe reported modified Edge Function source is **not deployed**: remote `crm-router` is v39, last deployed 2026-05-04 22:53:35, while local `supabase/functions/crm-router/index.ts` and shared `supabase/functions/_shared/crm-router-data.ts` are modified.
- Probe noted a pre-existing migration-number gap at 250/251, unrelated to current changes.

## Investigator Findings


### Independent probe — 2026-05-05

#### Commands run
Read-only/local-inspection commands run in `/Users/brianlewis/Projects/qep-knowledge-assistant`:

- `git status --short --branch`
- `git diff --name-status`, `git diff --stat`, `git diff --numstat`
- `git ls-files --others --exclude-standard`
- `git ls-files --error-unmatch <path>` for candidate untracked files
- `git log --oneline --all -- <candidate paths>`
- `supabase migration list` and focused `awk` filter for `540`-`544`
- `supabase functions list` and focused `awk` filter for `crm-router`
- `rg` searches for Counter imports/references, reversal APIs, and YCENA/OEM import support
- `nl -ba ... | sed ...` source reads for file:line evidence

#### Worktree status and separability

Command evidence from `git status --short --branch`:

```text
## main...origin/main
 M apps/web/src/features/admin/lib/__tests__/oem-base-options-import-api.test.ts
 M apps/web/src/features/admin/lib/oem-base-options-import-api.ts
 M apps/web/src/features/qrm/components/EquipmentReversalReadinessCard.tsx
 M apps/web/src/features/qrm/components/__tests__/EquipmentReversalReadinessCard.integration.test.tsx
 M apps/web/src/features/qrm/lib/qrm-router-api.ts
 M scripts/migration-gaps.json
 M supabase/functions/_shared/crm-router-data.ts
 M supabase/functions/crm-router/index.ts
?? "QEP (1)/QRM_QUOTE_WIZARD_SPEC_2026-05-05.md"
?? "QEP (1)/RYLEE_QRM_FEEDBACK_REPLY_2026-05-05.md"
?? apps/web/src/components/Counter.tsx
?? apps/web/src/components/ui/counter.tsx
?? docs/investigations/
?? prompt-exports/
?? scripts/oem/
?? supabase/migrations/540_jar103_equipment_sale_reversal_mutation.sql
?? supabase/migrations/541_ycena_oem_price_book_import_tiers.sql
?? supabase/migrations/544_qep_canonical_selling_branches.sql
```

Command evidence from `git diff --stat`:

```text
 .../__tests__/oem-base-options-import-api.test.ts  |  30 +++++-
 .../admin/lib/oem-base-options-import-api.ts       |  15 ++-
 .../components/EquipmentReversalReadinessCard.tsx  |  10 +-
 ...pmentReversalReadinessCard.integration.test.tsx |  14 +--
 apps/web/src/features/qrm/lib/qrm-router-api.ts    |  44 +++++++++
 scripts/migration-gaps.json                        |   2 +-
 supabase/functions/_shared/crm-router-data.ts      | 102 +++++++++++++++++++++
 supabase/functions/crm-router/index.ts             |   9 ++
 8 files changed, 206 insertions(+), 20 deletions(-)
```

Command evidence from `git ls-files --error-unmatch` showed these are untracked: `supabase/migrations/540_jar103_equipment_sale_reversal_mutation.sql`, `supabase/migrations/541_ycena_oem_price_book_import_tiers.sql`, `supabase/migrations/544_qep_canonical_selling_branches.sql`, `apps/web/src/components/Counter.tsx`, `apps/web/src/components/ui/counter.tsx`, `scripts/oem/ycena-price-book-parser.mjs`, and `prompt-exports/oracle-plan-2026-05-05-090101-qrm-wizard-plan-05c1-ad94.md`. `git log --oneline --all --` against the 540/541 migrations, Counter files, and YCENA parser returned no history.

Conclusion: the worktree is separable by path/workstream, but it is not commit-clean as-is. The main separable groups are:

1. **JAR-103 equipment sale reversal** — `supabase/migrations/540_jar103_equipment_sale_reversal_mutation.sql`, `supabase/functions/crm-router/index.ts`, `supabase/functions/_shared/crm-router-data.ts`, `apps/web/src/features/qrm/lib/qrm-router-api.ts`, `apps/web/src/features/qrm/components/EquipmentReversalReadinessCard.tsx`, and its integration test. `scripts/migration-gaps.json:1` also participates by listing `[250, 251, 540, 541]`.
2. **OEM / YCENA import support** — `supabase/migrations/541_ycena_oem_price_book_import_tiers.sql`, `apps/web/src/features/admin/lib/oem-base-options-import-api.ts`, its test, and untracked `scripts/oem/*` parser/fixture/test files.
3. **Docs and prompt/export artifacts** — `QEP (1)/QRM_QUOTE_WIZARD_SPEC_2026-05-05.md`, `QEP (1)/RYLEE_QRM_FEEDBACK_REPLY_2026-05-05.md`, `prompt-exports/*`, and this investigation report.
4. **Likely accidental Counter scaffold** — `apps/web/src/components/Counter.tsx` and `apps/web/src/components/ui/counter.tsx`.
5. **Additional separate DB workstream discovered** — untracked `supabase/migrations/544_qep_canonical_selling_branches.sql`, which canonicalizes active selling branches and should not be silently bundled with 540/541.

#### Supabase migration/function live status

Focused command evidence from `supabase migration list | awk '$1 ~ /^(540|541|542|543|544)$/ {print}'`:

```text
   540   | 540    | 540
   541   | 541    | 541
   542   | 542    | 542
   543   | 543    | 543
   544   |        | 544
```

Interpretation: migrations **540** and **541** are present in both Local and Remote columns. Migration **544** is local-only/unapplied remotely. The CLI also emitted `Skipping migration README.md... (file name must match pattern "<timestamp>_name.sql")`, which is unrelated to the current hypotheses.

Focused command evidence from `supabase functions list | awk 'NR<=2 || $0 ~ /crm-router|quote-builder-v2|tax-calculator/ {print}'`:

```text
   b27a2b9f-35c1-4611-acd9-8e0f54e3919b | crm-router       | crm-router       | ACTIVE | 39 | 2026-05-04 22:53:35
   91f5550f-6b4c-409d-ac72-a3c926c8ae6e | quote-builder-v2 | quote-builder-v2 | ACTIVE | 49 | 2026-05-05 14:16:15
   25d64820-2d98-4016-9f89-7d54cdbd214e | tax-calculator   | tax-calculator   | ACTIVE | 17 | 2026-05-05 14:27:38
```

Conclusion: DB-side migrations 540/541 are live remotely while the local migration files are untracked, proving a provenance risk. Function-side live parity is not proven by `functions list` alone because it reports deployment metadata, not deployed bundle contents. However, the local source currently has uncommitted Edge Function changes for `crm-router` and `_shared/crm-router-data`; until a remote bundle download or authenticated route probe confirms v39 contains those exact changes, treat `crm-router` as a live-state drift risk.

#### JAR-103 equipment sale reversal evidence

`supabase/migrations/540_jar103_equipment_sale_reversal_mutation.sql` is untracked but remote-applied. It creates the reversal audit model and RPCs:

- `supabase/migrations/540_jar103_equipment_sale_reversal_mutation.sql:10` creates `public.credit_memos`; `:58` enforces unique `(workspace_id, reversal_id)` idempotency.
- `supabase/migrations/540_jar103_equipment_sale_reversal_mutation.sql:125` adds `sale_reversal_credit_memo_id`, `sale_reversal_at`, and `sale_reversal_reason` to `public.qrm_equipment`.
- `supabase/migrations/540_jar103_equipment_sale_reversal_mutation.sql:135` creates `public.reverse_equipment_sale_by_stock_number(...)`; `:587` documents it as the atomic JAR-103 reversal mutation.
- `supabase/migrations/540_jar103_equipment_sale_reversal_mutation.sql:594` creates read-only `public.find_equipment_invoice_reversal_candidate(...)`; `:703` documents it as the readiness check.

Local Edge Function source adds router and data-layer support:

- `supabase/functions/crm-router/index.ts:58` imports `findEquipmentInvoiceReversalCandidate`; `:59` imports `reverseEquipmentSaleByStockNumber`.
- `supabase/functions/crm-router/index.ts:713` handles `GET /qrm/equipment/reversal-candidate`; `:719` handles `POST /qrm/equipment/reverse-sale`; `:722` calls the reversal data function and returns status `200`/`201` based on idempotency.
- `supabase/functions/_shared/crm-router-data.ts:101` defines `EquipmentSaleReversalPayload`; `:113` defines `EquipmentSaleReversalResult`.
- `supabase/functions/_shared/crm-router-data.ts:2173` calls `find_equipment_invoice_reversal_candidate`; `:2190` implements `reverseEquipmentSaleByStockNumber`; `:2202` calls RPC `reverse_equipment_sale_by_stock_number`.

Local web API/UI support:

- `apps/web/src/features/qrm/lib/qrm-router-api.ts:410` defines readiness response shape; `:423` defines reversal input; `:435` defines reversal result; `:455` calls `/qrm/equipment/reversal-candidate`; `:464` calls `/qrm/equipment/reverse-sale` with `idempotencyKey: input.reversalId` at `:470`.
- `apps/web/src/features/qrm/components/EquipmentReversalReadinessCard.tsx:53` renders the readiness card; `:78` says the policy is encoded in the atomic credit memo mutation; `:125` says execution still requires approval metadata and a unique reversal ID.

Conclusion: JAR-103 is a coherent workstream. It should not be bundled with docs/prompt exports or Counter scaffolding. Because migration 540 is live and the local Edge Function source is modified, deployment parity for the router endpoint is the main unresolved risk.

#### OEM / YCENA import evidence

`supabase/migrations/541_ycena_oem_price_book_import_tiers.sql` is untracked but remote-applied. It expands allowed manufacturers and seeds YCENA dealer-cost policy:

- `supabase/migrations/541_ycena_oem_price_book_import_tiers.sql:8` updates `equipment_base_codes_import_runs` manufacturer constraints; `:13` allows `yanmar`, `asv`, and `ycena`.
- `supabase/migrations/541_ycena_oem_price_book_import_tiers.sql:18` creates `public.oem_dealer_cost_tiers`; `:36` documents 30% off list for YCENA/ASV/Yanmar.
- `supabase/migrations/541_ycena_oem_price_book_import_tiers.sql:83` builds workspace/tier seed data; `:90` seeds ASV; `:91` seeds Yanmar Compact Equipment.
- `supabase/migrations/541_ycena_oem_price_book_import_tiers.sql:124` updates `integration_status`; `:128` marks `partial_parser_implemented`; `:132` records the 30% off-list dealer-cost policy; `:135` warns not to mark Bobcat/Vermeer or the full OEM workflow built from ASV/Yanmar alone.

Admin API/test support:

- `apps/web/src/features/admin/lib/oem-base-options-import-api.ts:4` expands `OEM_BASE_OPTIONS_MANUFACTURERS` to `asv`, `yanmar`, `bobcat`, `vermeer`.
- `apps/web/src/features/admin/lib/oem-base-options-import-api.ts:50` generalizes file-import requirements from Bobcat/Vermeer to OEM.
- `apps/web/src/features/admin/lib/oem-base-options-import-api.ts:67` maps ASV/Yanmar labels.
- `apps/web/src/features/admin/lib/oem-base-options-import-api.ts:176` queries `equipment_base_codes_import_runs` and `:182` filters by the expanded manufacturer list.

Parser support is entirely untracked under `scripts/oem/`:

- `scripts/oem/ycena-price-book-parser.mjs:80` exports `parseYcenaPriceBookText`.
- `scripts/oem/ycena-price-book-parser.mjs:111` and `:140` emit parsed rows with `parentOem: "YCENA"`.
- `scripts/oem/ycena-price-book-parser.mjs:124` and `:154` calculate dealer cost from list price and discount.
- `scripts/oem/ycena-price-book-parser.mjs:171` returns `sourceType: "ycena_price_book_pdf_text"`; `:179` returns canonical write targets.
- `scripts/oem/ycena-price-book-parser.mjs:193` uses `pdftotext` for PDFs; `:218` exports `parseYcenaPriceBookFile` with SHA-256 source provenance.

Conclusion: OEM/YCENA is a coherent separate workstream and should not be bundled with JAR-103 router/runtime code unless intentionally shipping both. Migration 541 is live remotely but untracked locally, so it has the same provenance risk as migration 540.

#### Counter scaffold evidence

The untracked Counter components appear accidental/unused:

- `apps/web/src/components/Counter.tsx:1` imports only `useState`; `:3` exports a basic local `Counter`; `:7`-`:29` render standalone increment/decrement UI.
- `apps/web/src/components/ui/counter.tsx:1` imports React; `:2` imports local `Button`; `:3` imports local `Card`; `:56` exports another `Counter`; `:106` labels it `Counter Component`.
- Search command `rg -n "(from ['\"].*(Counter|counter)|<Counter\b|\bCounter\b|components/ui/counter|components/Counter)" apps/web/src --glob '!apps/web/src/components/Counter.tsx' --glob '!apps/web/src/components/ui/counter.tsx'` found no import of either untracked Counter file and no `<Counter />` usage. Matches were existing domain references such as Parts Counter, competitor counter, `CounterSaleForm`, and `DecisionRoomCompetitorCounter`.

Conclusion: Hypothesis 4 is supported. These files should be deleted or stashed separately unless someone can identify an intentional consumer; they should not be committed with JAR-103, OEM, or docs/runtime work.

#### Docs / prompt exports evidence

Untracked artifact/doc groups from `git ls-files --others --exclude-standard` include:

```text
QEP (1)/QRM_QUOTE_WIZARD_SPEC_2026-05-05.md
QEP (1)/RYLEE_QRM_FEEDBACK_REPLY_2026-05-05.md
docs/investigations/untracked-supabase-worktree-2026-05-05.md
prompt-exports/oracle-plan-2026-05-05-090101-qrm-wizard-plan-05c1-ad94.md
prompt-exports/oracle-review-2026-05-05-095701-qrm-wizard-plan-05c1-5a27.md
prompt-exports/qrm-quote-wizard-sales-workflow-one-pager-2026-05-05.html
prompt-exports/qrm-quote-wizard-sales-workflow-one-pager-2026-05-05.pdf
```

Conclusion: Hypothesis 5 is supported. These are artifacts/docs and should not be bundled with runtime code or Supabase changes unless a docs-only commit is intentionally created.

#### Additional migration 544 finding

`supabase/migrations/544_qep_canonical_selling_branches.sql` is untracked and local-only per migration-list output (`544 | | 544`). It is a distinct DB workstream:

- `supabase/migrations/544_qep_canonical_selling_branches.sql:1` names it “Canonical QEP selling branches.”
- `supabase/migrations/544_qep_canonical_selling_branches.sql:3`-`:7` says branch pickers should show only Lake City and Ocala while historical/demo rows are kept inactive.
- `supabase/migrations/544_qep_canonical_selling_branches.sql:37`-`:76` inserts/upserts Ocala as active canonical selling branch.
- `supabase/migrations/544_qep_canonical_selling_branches.sql:125`-`:164` keeps canonical branches active and marks non-canonical workspace branch rows inactive.

Conclusion: 544 should be treated as a separate, unapplied/local-only migration and not mixed into 540/541 provenance cleanup.

#### Hypothesis verdicts

1. **Migrations 540 and 541 are applied remotely but untracked locally, creating provenance risk — PROVED.** Supabase migration list shows 540/541 in both Local and Remote columns; `git ls-files --error-unmatch` says both files are untracked; `git log --all -- <paths>` has no history.
2. **Local Edge Function changes for `crm-router` / `_shared/crm-router-data` are not deployed even though migration 540 is applied — PARTIALLY PROVED / DRIFT RISK CONFIRMED.** Migration 540 is remote-applied and local function source contains uncommitted route/RPC support. `functions list` only proves `crm-router` is active at v39 updated `2026-05-04 22:53:35`; it does not prove v39 contains the local uncommitted diff. A read-only remote bundle comparison or authenticated route probe would be needed to prove byte-level deployed parity. Until then, treat as live-state drift risk.
3. **Worktree separates into JAR-103 reversal, OEM YCENA support, docs/exports, and likely accidental Counter scaffold — PROVED, with one extra workstream.** The extra workstream is local-only migration 544 for canonical selling branches.
4. **Counter components are unused and should be deleted/stashed unless import search says otherwise — PROVED.** Import/reference search found no consumer of either untracked Counter file.
5. **Prompt exports/docs are artifacts and should not be bundled with runtime code — PROVED.** They are untracked artifact paths and have no runtime import evidence.

#### Recommended cleanup plan

1. Create separate review/commit units: JAR-103, OEM/YCENA, docs/artifacts, migration 544, and Counter cleanup.
2. For JAR-103, reconcile live Supabase state before any runtime claim: confirm whether remote `crm-router` v39 contains `/qrm/equipment/reverse-sale`; if not, deploy only after committing/provenancing migration 540 and function source.
3. For OEM/YCENA, provenance migration 541 and parser/admin changes together, or explicitly park the parser work if not ready to ship.
4. Keep prompt exports and `QEP (1)` docs out of runtime commits; use a docs/artifact-only commit or stash.
5. Remove or stash the Counter scaffold separately.
6. Treat migration 544 as separate local-only DB work; do not bundle with 540/541 unless the release scope explicitly includes branch canonicalization.


#### Addendum: late-surfaced quote/tax branch changes

A final `git status --short --branch` after appending this report showed two additional modified tracked files that were not present in the earlier status snapshot used for the main classification:

```text
 M apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx
 M supabase/functions/tax-calculator/index.ts
```

Narrow `git diff --stat -- apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx supabase/functions/tax-calculator/index.ts` evidence:

```text
apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx | 7 +++++--
supabase/functions/tax-calculator/index.ts                       | 1 -
2 files changed, 5 insertions(+), 3 deletions(-)
```

Line evidence:

- `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx:97` now imports `useBranchBySlug`; `:511` fetches the selected branch by slug; `:512`-`:514` fall back to that branch when it is absent from the active branch list.
- `supabase/functions/tax-calculator/index.ts:85`-`:91` queries `branches` by workspace/slug/deleted status without the previous `is_active = true` filter.

Conclusion: this appears related to the separate branch-canonicalization/local-only migration 544 workstream, not JAR-103 or YCENA. It also means `tax-calculator` has local source drift despite `supabase functions list` reporting remote `tax-calculator` active at v17 updated `2026-05-05 14:27:38`; as with `crm-router`, deployment parity would require bundle comparison or a safe authenticated probe.

## Investigation Log

### Phase 1 - Initial Status
**Hypothesis:** The reported untracked files are still present and may be mixed with tracked modifications.
**Findings:** Initial git status shows 7 modified tracked files and 8 untracked path groups, including the user-listed QRM docs, prompt exports directory, counter components, scripts/oem directory, and two Supabase migrations.
**Evidence:** `git status` via RepoPrompt reported branch `main → origin/main`, modified tracked files under QRM/admin/Supabase function code, and the listed untracked items.
**Conclusion:** Confirmed. Further investigation needed to classify each item, verify Supabase live/applied state, and recommend cleanup.

## Root Cause
1. Multiple workstreams were developed in one dirty working tree without staging/committing by release intent.
2. Supabase database migrations `540` and `541` were applied to the remote database before their exact local migration files were committed, leaving live database state without git provenance.
3. Runtime code parity was not verified after local Edge Function edits. `supabase functions list` proves function metadata/version timestamps only; it does not prove the deployed bundle includes the current local `crm-router` or `tax-calculator` edits.
4. Generated/planning artifacts and scaffold/demo files were left unclassified, increasing the risk that they get accidentally bundled into an unrelated Quote Wizard/runtime commit.

## Recommendations
1. **Commit JAR-103 equipment sale reversal as its own unit:** `supabase/migrations/540_jar103_equipment_sale_reversal_mutation.sql`, `supabase/functions/crm-router/index.ts`, `supabase/functions/_shared/crm-router-data.ts`, `apps/web/src/features/qrm/lib/qrm-router-api.ts`, `apps/web/src/features/qrm/components/EquipmentReversalReadinessCard.tsx`, and `apps/web/src/features/qrm/components/__tests__/EquipmentReversalReadinessCard.integration.test.tsx`. Commit the exact migration file; do not renumber or recreate it.
2. **Verify/deploy `crm-router` only after provenance is fixed:** confirm the deployed function contains `/qrm/equipment/reverse-sale` by safe authenticated route probe or remote bundle comparison. Until then, describe its live state as “deployed parity unproven / drift risk,” not definitively deployed or undeployed.
3. **Commit OEM/YCENA import support separately:** `supabase/migrations/541_ycena_oem_price_book_import_tiers.sql`, `apps/web/src/features/admin/lib/oem-base-options-import-api.ts`, `apps/web/src/features/admin/lib/__tests__/oem-base-options-import-api.test.ts`, and `scripts/oem/*` parser/test/fixture files.
4. **Handle branch canonicalization separately:** `supabase/migrations/544_qep_canonical_selling_branches.sql`, `apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx`, `supabase/functions/tax-calculator/index.ts`, and `scripts/migration-gaps.json` if that JSON is an intentional maintained baseline. Migration `544` is local-only/unapplied and should not be bundled into the 540/541 provenance cleanup.
5. **Keep docs/artifacts out of runtime commits:** commit `QEP (1)/*`, `docs/investigations/*`, and `prompt-exports/*` only as an intentional docs/archive/provenance stream. Otherwise move or stash/archive them outside the runtime code commit path.
6. **Delete or stash Counter scaffold separately:** `apps/web/src/components/Counter.tsx` and `apps/web/src/components/ui/counter.tsx` have no discovered consumers; keep only if an owner identifies intended use.

## Preventive Measures
- Before applying Supabase migrations, ensure the exact migration file is staged/committed or commit it immediately in the same deployment window.
- Add a pre-deploy checklist: `git status --short`, `supabase migration list`, `git ls-files --error-unmatch supabase/migrations/<id>_*.sql`, and explicit Edge Function deploy target verification.
- Treat `supabase functions list` as metadata only. Use bundle comparison or safe authenticated endpoint probes for deployed-code parity claims.
- Keep independent Supabase domains in separate branches/worktrees when they can deploy independently.
- Define repository policy for generated prompt exports, PDFs/HTML one-pagers, and investigation reports so they are either intentionally archived or ignored/moved out of git.
- Document whether `scripts/migration-gaps.json` is maintained source or generated output; do not leave it ambiguous.
