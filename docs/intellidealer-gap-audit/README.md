# IntelliDealer → QEP Gap Audit

This bundle is the **source of truth** for the IntelliDealer → QEP migration. It enumerates every IntelliDealer field across nine phases, reconciles each against the QEP schema (`apps/web/src/lib/database.types.ts`), and prescribes a concrete migration for every gap.

**Generated:** 2026-04-26; regenerated against the current `Database` type on 2026-05-03
**Coverage:** 847 fields across 9 phases (23,750 lines of YAML)
**Source artifacts:** 150 OCR'd UI screenshots, 30+ PDFs, 9 parity-matrix CSVs

---

## Where to start

Read in this order:

1. **`manifest.yaml`** — the index. Per-phase counts, totals, and the top-50 must-fix blocker list.
2. **`_schema/manifest-schema.md`** — the schema every phase YAML conforms to (field shape, severity definitions, qep_status values, naming convention).
3. **`_blockers.csv`** — regenerated CSV of every current `severity=must` + `qep_status=MISSING` field, sortable in any spreadsheet. Current blocker count: 0.
4. **`_migration_order.md`** — dependency-respecting migration sequence (which DDL comes first because of foreign-key dependencies).
5. **The 9 phase YAMLs** — open the one(s) for your scope.

---

## File layout

```
docs/intellidealer-gap-audit/
├── README.md                                    ← you are here
├── manifest.yaml                                ← index + summary stats
├── _blockers.csv                                ← current must-fix MISSING fields
├── _migration_order.md                          ← FK-respecting order of ALTERs/CREATEs
│
├── _schema/
│   └── manifest-schema.md                       ← canonical YAML schema spec
│
├── _phase_inputs/                               ← raw input data the auditor consumed
│   ├── {Phase}_parity_matrix.csv                ← per-phase field-by-field parity rows
│   └── {Phase}_screen_inventory.json            ← per-phase screen inventory
│
├── phase-1-crm.yaml                             ← Customer Profile + Prospect Board
├── phase-2-sales-intelligence.yaml              ← Equipment Profile / Quoting / Invoicing / Trade-Ins
├── phase-3-parts.yaml                           ← Parts master / Invoicing / POs / Price Matrix
├── phase-4-service.yaml                         ← Work Orders / Quoting / Labor Pricing / Inspections
├── phase-5-deal-genome.yaml                     ← Data Miner + Analysis Reports
├── phase-6-rental.yaml                          ← Rental Contracts + Returns
├── phase-8-financial-operations.yaml            ← AR / AP / GL routing
├── phase-9-advanced-intelligence.yaml           ← BI / AI surfaces
└── cross-cutting.yaml                           ← Traffic Management / attachments / dispatch
```

> **Note:** Phase-7 (Trade-In) was rolled into Phase-2 Sales Intelligence (Trade-In appraisal + lien handling lives on the equipment-invoice flow), so there is no `phase-7-*.yaml`.

---

## Per-phase coverage

| Phase | YAML | Fields | Must | Should | Could | MISSING | PARTIAL | BUILT |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Phase-1 CRM | `phase-1-crm.yaml` | 93 | 39 | 48 | 6 | 1 | 0 | 92 |
| Phase-2 Sales Intelligence | `phase-2-sales-intelligence.yaml` | 102 | 54 | 46 | 2 | 0 | 0 | 102 |
| Phase-3 Parts | `phase-3-parts.yaml` | 106 | 66 | 37 | 3 | 0 | 1 | 105 |
| Phase-4 Service | `phase-4-service.yaml` | 101 | 58 | 42 | 1 | 0 | 0 | 101 |
| Phase-5 Deal Genome | `phase-5-deal-genome.yaml` | 100 | 57 | 32 | 11 | 0 | 0 | 100 |
| Phase-6 Rental | `phase-6-rental.yaml` | 76 | 60 | 14 | 2 | 0 | 1 | 75 |
| Phase-8 Financial Operations | `phase-8-financial-operations.yaml` | 92 | 60 | 22 | 10 | 0 | 0 | 92 |
| Phase-9 Advanced Intelligence | `phase-9-advanced-intelligence.yaml` | 75 | 47 | 18 | 10 | 0 | 0 | 75 |
| Cross-Cutting | `cross-cutting.yaml` | 102 | 55 | 41 | 6 | 0 | 0 | 102 |
| **Totals** | — | **847** | **496** | **300** | **51** | **1** | **2** | **844** |

Exact per-phase counts live in `manifest.yaml`. Counts were regenerated on 2026-05-03 from `apps/web/src/lib/database.types.ts` using `bun run intellidealer:gap-audit:regen`.

---

## Severity legend (read this before prioritizing)

| Severity | Definition | Action posture |
|---|---|---|
| **must** | Regulatory (1099, sales-tax, OFAC, lien-holder), financial reconciliation, legal contract terms, customer/dealer identity. Without this, QEP cannot replace IntelliDealer for daily operations. | Ships in v1. Blocks cutover if MISSING. |
| **should** | Operational efficiency. Workflow that a rep does daily and notices missing. Can ship without but creates daily friction. | Ships in v1.x or v2 depending on dealer-specific impact. |
| **could** | Reporting nuance, edge cases, deprecated fields, UI niceties. | Defer unless a specific dealer surfaces the need. |

## Category legend

- **regulatory** — tax, compliance, government reporting (EIN, sales-tax cert, VIN, lien holder, opt-out PI)
- **financial** — AR/AP, credit terms, payment routing, reconciliation
- **operational** — day-to-day rep/manager/tech workflow signals
- **reporting** — surfaced in dashboards and management reports
- **workflow** — drives state transitions / multi-step processes
- **nice_to_have** — convenience, deprecated, or rarely-touched fields

## QEP-status legend

- **BUILT** — column exists with matching name + same business meaning. `qep_evidence` cites the column.
- **PARTIAL** — column exists but with different shape (e.g., IntelliDealer is a typed enum, QEP is free text), or only one of multiple sub-fields is captured.
- **MISSING** — no column captures this concept. `qep_table` still suggests where it would live; `qep_column` is the suggested name.

---

## Brian's #1 anchor concern

**`customer.ein` (Federal Tax ID) is now BUILT on `qrm_companies`.**

This field was the highest-priority original blocker because without it QEP could not:
- Issue 1099-NEC/MISC at year-end (tax filing failure)
- Pass an AvaTax exemption substantiation request
- Resolve a customer in OFAC / sanctions screening
- Federate the customer with state-issued resale certs
- Federate with OEM portals (JD/Bobcat/Vermeer customer dedup)

Migration `397_customer_ein.sql` shipped the column, format CHECK constraint, role guard/masking, and UI surface. The phase YAML now marks `customer.ein` as `BUILT` with current `Database` type evidence.

---

## How a builder consumes this

Per field, the builder needs four things — all surfaced in each YAML entry:

1. `qep_status` + `qep_table` + `qep_column` — what to do (extend, add, replace) and where
2. `migration_hint` — concrete SQL ready to drop into a `NNN_*.sql` migration file
3. `ui_surface_hint` — where the field needs to appear in the QEP UI
4. `dependencies` — other field ids this field requires (drives migration ordering — see `_migration_order.md`)

Per phase, the auditor note (top of each YAML, between `source_artifacts:` and `fields:`) explains the IntelliDealer surface and the QEP coverage at a glance — read this before writing migrations for that phase.

---

## Generation provenance

Every field entry cites its evidence:
- `intellidealer_evidence` — paths to the original PDF + PNG + OCR'd text
- `qep_evidence` — the QEP schema lines that prove the BUILT/PARTIAL claim

The OCR'd `.txt` files live at `docs/IntelliDealer/_OCR_PNG/` (per-PNG OCR) and `docs/IntelliDealer/_OCR/{Phase}/` (per-PDF OCR). The original PNGs and PDFs live at `docs/IntelliDealer/{Phase}/`.

Source schema reference: `apps/web/src/lib/database.types.ts`, regenerated from the current Supabase schema during the 2026-05-03 closeout pass.

---

## Update / maintenance

When QEP ships a column that was previously MISSING:

1. Find the field id in the relevant phase YAML
2. Flip `qep_status: MISSING` → `qep_status: BUILT`
3. Set `qep_column:` to the actual column name
4. Add the schema line to `qep_evidence:`
5. Clear or shorten `qep_gap_notes:`
6. Re-generate `manifest.yaml` and `_blockers.csv` with `bun run intellidealer:gap-audit:regen`

When IntelliDealer is upgraded and new screens/fields appear, add new field entries to the appropriate phase YAML and bump the `generated_at:` timestamp at the top.
