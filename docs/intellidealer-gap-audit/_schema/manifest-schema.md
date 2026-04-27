# IntelliDealer → QEP Gap Audit — Manifest Schema

This document defines the canonical structure for `manifest.yaml` and per-phase
YAML files. Every subagent producing a phase YAML must follow this schema
exactly so the central manifest can be assembled by concatenation.

## File: `phase-{N}-{name}.yaml`

```yaml
phase: Phase-1_CRM            # exact folder name
generated_at: 2026-04-25T00:00:00Z
source_artifacts:
  pdfs: [list of pdf paths under docs/IntelliDealer/{phase}/]
  png_screenshots: [list of png paths]
  ocr_text_paths: [list of paths under _OCR/{phase}/ and _OCR_PNG/]

# Every IntelliDealer field captured. Even when BUILT, leave the row in so
# we have a complete inventory.
fields:
  - id: contacts.ein                        # entity.snake_case_field
    intellidealer_label: "FEIN"             # exactly as labeled on screen
    intellidealer_screen: "Customer Profile: Details"
    intellidealer_data_source: "CMASTR"     # if known
    intellidealer_evidence:                 # which artifacts support this
      - Phase-1_CRM/Customer-Profile-Details__3.25.02.png
      - _OCR_PNG/Phase-1_CRM_Customer-Profile-Details__3.25.02.txt
    intellidealer_field_type: "text|number|date|enum|bool|multiline|json|computed|address|phone|email|currency|percent|fk"
    intellidealer_enum_values:              # only if field_type=enum
      - "Active"
      - "Inactive"
      - "Prospect"
    intellidealer_purpose: |
      One-paragraph description of what this field captures and why it
      matters for daily operations, regulatory compliance, or financial
      reporting. Cite the source if known.

    # ─── Reconciliation ──────────────────────────────────────────
    qep_status: "BUILT|MISSING|PARTIAL"
    qep_table: "qrm_contacts"               # null if no reasonable target
    qep_column: "ein"                       # null if missing OR table-only
    qep_evidence:                           # if BUILT/PARTIAL, cite schema
      - "database.types.ts qrm_contacts.ein"
    qep_gap_notes: |
      For MISSING or PARTIAL, describe what's missing and why this matters.

    # ─── Implementation hint ─────────────────────────────────────
    severity: "must|should|could"
    category: "regulatory|financial|operational|reporting|workflow|nice_to_have"
    migration_hint: |
      ALTER TABLE qrm_contacts ADD COLUMN ein TEXT;
      COMMENT ON COLUMN qrm_contacts.ein IS '...';
    ui_surface_hint: "where this should appear in the UI"
    dependencies: []                        # other field ids this depends on
```

## Severity definitions

- **must**: Regulatory (1099 reporting, sales-tax exemption), financial reconciliation, legal contract terms, customer/dealer identity. Without this, QEP cannot replace IntelliDealer for daily operations.
- **should**: Operational efficiency. Workflow that a rep does daily and notices missing. Can ship without but creates daily friction.
- **could**: Reporting nuance, edge cases, deprecated fields, UI niceties. Defer.

## Category definitions

- **regulatory**: tax, compliance, government reporting (EIN, sales-tax cert, VIN, lien holder)
- **financial**: AR/AP, credit terms, payment routing, reconciliation
- **operational**: day-to-day rep/manager/tech workflow signals
- **reporting**: surfaced in dashboards and management reports
- **workflow**: drives state transitions / multi-step processes
- **nice_to_have**: convenience, deprecated, or rarely-touched fields

## QEP status

- **BUILT**: column exists with matching name + same business meaning. Cite the column name in `qep_evidence`.
- **PARTIAL**: column exists but with different shape (e.g., IntelliDealer is a typed enum, QEP is free text), or only one of multiple sub-fields is captured.
- **MISSING**: no column captures this concept. `qep_table` should still suggest where it would live; `qep_column` is the suggested name.

## Field id naming

`{entity}.{snake_case_field_name}` — keep entity stable across phases so the same field surfaces only once when phases overlap (e.g., `customer_profile.ein` not `phase-1.crm.ein`). Use entities like:

- `customer` (Customer Profile / company-level)
- `contact` (Customer Profile: Contacts tab)
- `equipment` (Equipment Profile)
- `quote`, `quote_line`
- `parts_master`, `parts_inventory`, `parts_quote_line`
- `work_order`, `work_order_labor`, `work_order_part`
- `service_agreement`
- `rental_contract`, `rental_billing`
- `trade`, `trade_appraisal`
- `invoice`, `payment`, `gl_account`
- `employee`, `branch`, `territory`
- `prospect`

When in doubt, mirror the `qep_table` you'd target.

## Output paths

Each phase YAML is written to:
`docs/intellidealer-gap-audit/phase-{N}-{name}.yaml`

Where `{N}-{name}` matches the IntelliDealer folder (e.g., `phase-1-crm`,
`phase-4-service`, `cross-cutting`).
