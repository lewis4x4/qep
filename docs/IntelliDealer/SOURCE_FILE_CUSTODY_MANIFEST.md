# IntelliDealer Source File Custody Manifest

Date: 2026-05-03

## Purpose

This manifest records the local source files used to audit and import the IntelliDealer customer handoff without committing the raw customer data files to Git.

The raw files remain local/untracked unless a separate privacy and retention decision approves committing or moving them to controlled private storage.

## Production Binding

- Supabase project: `iciddijgonywtxoelous`
- Production import run ID: `df74305e-d37a-4e4b-be5e-457633b2cd1d`
- Production source workbook: `Customer Master.xlsx`
- Production source workbook SHA-256: `ade4fbb59632c8dc3bc266b86d80a43c6ecc68476f1e453654cc65cd96ba69f5`
- Verification script: `bun run intellidealer:source:custody`

## File Inventory

| File | Role | Size Bytes | SHA-256 | Verified Shape |
| --- | --- | ---: | --- | --- |
| `docs/IntelliDealer/CMASTR.pdf` | Source reference for customer master report | `57,336` | `5743ecbe40fca1252b2ce24ca2c0c9cdb7bbe1b6794c6a19c3e227fa992e2335` | `3` PDF pages |
| `docs/IntelliDealer/Customer Master.xlsx` | Canonical import workbook used by the committed production run | `6,820,643` | `ade4fbb59632c8dc3bc266b86d80a43c6ecc68476f1e453654cc65cd96ba69f5` | `5` worksheets, counts below |
| `docs/IntelliDealer/CUST CONTACTS.pdf` | Source reference for customer contacts and contact memos | `58,556` | `b47033a953f0a07da586daffae3068454e51eb7cbd43f2bc32bc21a4ef6923b1` | `4` PDF pages |
| `docs/IntelliDealer/CUST AR AGENCY.pdf` | Source reference for A/R agency assignments | `52,788` | `263e6916f63c05e72e2e3dfb9792d39c84520a4da6e921f51959645100d5c508` | `1` PDF page |
| `docs/IntelliDealer/CUST PROFITABILITY.pdf` | Source reference for profitability extract | `53,609` | `942156e91c868734b5fff4335cdc39080c573028b40447aee1448227bfdfa52f` | `1` PDF page |

## Workbook Shape

| Worksheet | Used Range | Data Rows Excluding Header | Columns | Production Reconciliation Use |
| --- | --- | ---: | ---: | --- |
| `MAST` | `A1:CC5137` | `5,136` | `81` | Customer master mapped rows |
| `CONTACTS` | `A1:EE4658` | `4,657` | `135` | Contact mapped rows |
| `Cust Contact Memos` | `A1:F1180` | `1,179` | `6` | Contact memo staged rows |
| `AR AGENCY` | `A1:L19467` | `19,466` | `12` | A/R agency mapped rows |
| `PROFITABILITY` | `A1:AN9895` | `9,894` | `40` | Profitability mapped rows |

## Custody Policy

- Do not commit the raw source files unless explicitly approved.
- Do not alter the raw source files in place.
- If a replacement file is received, store it separately and update this manifest only after `bun run intellidealer:source:custody` is updated and rerun.
- The production import baseline remains bound to workbook hash `ade4fbb59632c8dc3bc266b86d80a43c6ecc68476f1e453654cc65cd96ba69f5`; a different workbook hash is a new import candidate, not the signed-off production source.
