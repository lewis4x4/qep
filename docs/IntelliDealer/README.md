# QEP OS ↔ IntelliDealer — Ground-Up Parity Framework

This folder holds the complete evidence base and parity framework for replacing IntelliDealer (VitalEdge) with QEP OS. Every IntelliDealer screen, field, action, and business rule is mapped against the current QEP OS codebase (168 Supabase tables, 168 edge functions, 27 feature modules, 343 migrations, ~85% production-ready as of 2026-04-21).

## Primary working documents

Open these in order:

1. **`_Manifests/QEP_Parity_Worksheet.xlsx`** — THE master document. 10 sheets:
   - Executive Summary
   - Screen Inventory (every IntelliDealer screen)
   - Field Parity Matrix (~350 field-level mappings to QEP tables)
   - Action & Button Parity
   - Tab Structure Parity
   - Phase Build Status
   - Gap Register (P0 blockers → P3 nice-to-haves)
   - Phase 1 Sprint Actions (Paperclip-ready task list)
   - QEP Table Catalog (reference)
   - Coverage Legend

2. **`_Manifests/QEP_Codebase_Audit.md`** — 614-line ground-truth audit of the actual QEP OS codebase. What's shipped, what's scaffolded, what's missing. Phase-by-phase breakdown with specific table names, edge functions, feature paths.

3. **`_Manifests/QEP_OS_vs_IntelliDealer_Gap_Analysis.docx`** — Prose gap analysis report for Rylee/Ryan review.

4. **`_Manifests/IntelliDealer_Feature_Inventory.xlsx`** — Original feature inventory with the QEP Advantages sheet (43 things IntelliDealer doesn't do).

## Supporting data

- **`_Manifests/IntelliDealer_Field_Inventory.json`** — machine-readable structured data extracted from all 33 PDFs: screen names, menu paths, data source codes, security switches, field tables, buttons, tabs, topics, linked screens.
- **`_Manifests/screenshot_classification.csv`** — classification of all 150 screenshots.
- **`_OCR/`** — extracted text for all 33 PDFs + 78 screenshots. Grep-able.

## Source evidence

Organized by QEP phase. 183 total files (33 IntelliDealer help PDFs + 150 macOS screenshots).

| Folder | PDFs | Screenshots | Total |
|---|---|---|---|
| Phase-1_CRM | 3 | 10 | 13 |
| Phase-2_Sales-Intelligence | 5 | 40 | 45 |
| Phase-3_Parts | 5 | 30 | 35 |
| Phase-4_Service | 8 | 36 | 44 |
| Phase-5_Deal-Genome | 1 | 9 | 10 |
| Phase-6_Rental | 1 | 0 | 1 |
| Phase-7_Trade-In | 0 | 0 | 0 |
| Phase-8_Financial-Operations | 7 | 16 | 23 |
| Phase-9_Advanced-Intelligence | 1 | 0 | 1 |
| Cross-Cutting | 2 | 9 | 11 |
| **Total** | **33** | **150** | **183** |

Each phase folder has its own `INDEX.md` listing every file with its IntelliDealer menu path, screen title, and screenshot count.

## Methodology (how this framework was built)

1. **Classify every IntelliDealer artifact** by QEP phase (screenshots visually inspected, PDFs mapped by menu path).
2. **Extract field-level detail from every PDF** via OCR + structured parsing: screen name, data source code (e.g. CMASTR), security switch, menu paths, field tables, tabs, buttons, sub-workflows.
3. **Audit the QEP OS codebase** — read every Supabase migration, list every table/column, catalog every edge function and feature module.
4. **Map IntelliDealer fields to QEP tables** — each of ~350 IntelliDealer fields assigned a QEP table/column + parity status (BUILT / PARTIAL / GAP / REVIEW).
5. **Build action & tab parity matrices** — every button, tab, sub-workflow mapped.
6. **Register gaps** — prioritized P0-P3 with concrete recommended actions.
7. **Generate sprint actions** — Paperclip-ready task list to close Phase 1 parity.

## How to use this framework

**For build planning:** Work the Field Parity Matrix sheet. Filter by phase, then by status=GAP. Each gap row has a target QEP table and migration note.

**For gap review with Rylee/Ryan:** Open the Gap Register sheet. Sort by priority. Every P0 and P1 gap has evidence reference and recommended action.

**For Paperclip delegation:** Phase 1 Sprint Actions sheet has ordered tasks with agent assignments (Architect / Engineer / QA / DevOps / Security).

**For parity validation (per phase):** For each phase, filter the Field Parity Matrix to that phase, validate every BUILT row against the live QEP system, and every GAP row against the shadow session findings.

**For cutover planning:** Every IntelliDealer screen in the Screen Inventory needs parity validation before that module's IntelliDealer access can be turned off. Track status per screen.

## Critical blockers (P0)

Current status note, 2026-05-03: this section is historical and has been superseded by `INTELLIDEALER_HANDOFF_CLOSEOUT_CONTROL.md`. The core customer import no longer depends on VitalEdge/IntelliDealer API access or HubSpot API access. Wave 5 external integrations remain deferred separately in `WAVE_5_DEFERRED_INTEGRATION_REGISTER_2026-05-03.md`.

- **VitalEdge/IntelliDealer API access** — blocks all data migration. Escalate with QEP for account rep intro.
- **HubSpot API key** — blocks Phase 1 CRM migration. Request from Rylee.

## Key revision to previous gap analysis

Early gap analysis assumed QEP OS was in early build with most phases "PLANNED." The codebase audit shows **Phases 1-8 are code-complete (100%)** and Phase 9 is 75% built. The real work is not building from scratch — it's validating parity and closing specific schema gaps (Ship To addresses, AP module, search_1/search_2 legacy fields, inspection schema, etc.).
