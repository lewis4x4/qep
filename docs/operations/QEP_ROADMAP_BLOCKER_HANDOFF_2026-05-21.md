# QEP Roadmap Blocker Handoff — 2026-05-21

Generated at: 2026-05-21T09:13:52Z
Updated at: 2026-05-21T13:26:16Z

## Current Selector Result

```json
{"task":null,"reason":"all_actionable_have_blockers","total_actionable":11}
```

There is no currently safe engineering build item to start. The roadmap queue is blocked by human sign-offs, owner decisions, external documents/samples, DNS access, legal/compliance inputs, or empty IntelliDealer production stage tables.

## Verified Completed Starting Point

### B5.4 / QEP-60 — HF-3 Bottom nav stability

Status: shipped and synced.

Evidence:

- Commit: `1f23f94b` — `Stabilize Sales bottom nav scroll ownership`
- Gate artifact: `test-results/agent-gates/20260520T232610Z-B5.4-hf-3-bottom-nav-stability.json`
- Gate verdict: `PASS`, 15/15 checks passed
- Focused coverage includes:
  - `SalesShell` 100dvh scroll ownership
  - `BottomTabBar` fixed 64px height + safe-area contract
  - mobile sales E2E bottom-tab persistence assertion
  - Quote Builder mobile shell scroll delegation


## Updates Since Initial Handoff

### GitHub Actions migration drift fixed

The repeated `Check Supabase migrations` failures were caused by the live Supabase project being behind repo migrations. The guarded `Apply Supabase migrations` workflow was run after patching migration `617` so the owner inbox view appends `ai_prep_packet` instead of inserting it before `age_days`.

Evidence:

- Fix commit: `8e931d0f` — `Let owner inbox view migration append triage packet`
- Apply workflow: `26228590964` — success
- Check workflow: `26228579882` — success
- Applied migrations: `607` through `622`
- Final check log: `no drift — every migration in the repo is applied to prod`

### Q11 resolved through audited delegation

Q11 was resolved using the live policy introduced by migration `621`: Ryan-owned `non_visual` decisions may be delegated to Brian. The existing recommended option was applied through `apply_qep_delegated_recommendation`, not by manual row editing.

Approved option:

- `recommended`: 3 years of closed quotes + all open quotes + active inventory + active customers; cutover Monday `2026-06-15`.

Evidence:

- Decision: `Q11`
- Policy id: `e4f38497-92c9-41f9-8546-d11138a010f8`
- Audit id: `61590fb6-5850-4172-b397-7d98ad133380`
- Applied by: `orchestrator:delegation-policy`
- Roadmap tasks shipped: `A4.4`, `C1.2`

### C1.3 now blocked by missing staged IntelliDealer rows

After Q11 resolved, `C1.3 — Run snapshot in production` became next. The snapshot script self-test and dry-run passed, but all relevant production stage tables were empty, so no production commit/cutover was performed.

Verification run:

```bash
bun ./scripts/commit-intellidealer-snapshot-import.mjs --self-test
bun ./scripts/commit-intellidealer-snapshot-import.mjs --workspace default --source intellidealer_snapshot_2026-05-14
```

Result:

- self-test: `PASS`
- dry-run: `PASS`
- staged equipment rows: `0`
- staged parts rows: `0`
- staged service/PDI rows: `0`
- direct stage-table samples also returned `0` rows for equipment, parts, service history, and quote history

Linear escalation:

- QEP-68 comment: `a5732a32-0740-48a4-b6bd-6695f77a27c6`

Needed before C1.3 can resume:

- IntelliDealer equipment export file
- IntelliDealer parts export file
- IntelliDealer quotes/history export file
- IntelliDealer service/PDI export file
- Confirmation of workspace/source tag if not `default` / `intellidealer_snapshot_2026-05-14`

Do not run `--commit` or mark C1.3 shipped until the stage tables contain non-zero verified rows.

## Immediate Human Sign-Off Blockers

### A1.1 / QEP-1 — Manual staging QA pass

Blocking downstream:

- A1.4 — Three real customers receive Iron Quote
- D4.1 — Three real customers receive Iron Quote in writing

Engineering evidence already exists. Remaining action is human staging walkthrough.

Required packet:

- `docs/floor/signoffs/QA-A1.1-manual-staging-qa-pass.md`

Linear escalation:

- QEP-1 comment: `cf88cd0b-99cf-4207-aa0e-3a324db4432a`

Owner action:

- Rylee + architect complete staging browser walkthrough.
- Attach dated evidence.
- Mark decision `pass`, `pass with exceptions`, or `fail` in the sign-off file.

### A1.2 / QEP-2 — Q02699 PDF parity sign-off

Blocking downstream:

- A1.4 — Three real customers receive Iron Quote
- D4.1 — Three real customers receive Iron Quote in writing

Engineering parity anchors already exist. Remaining action is side-by-side human review against IntelliDealer Q02699.

Required packet:

- `docs/floor/signoffs/QA-A1.2-q02699-pdf-parity-sign-off.md`

Linear escalation:

- QEP-2 comment: `49bf61f4-33f4-4eca-ab20-6fd3defe49c5`

Owner action:

- Architect + Ryan compare generated QEP customer artifact against IntelliDealer Q02699.
- Attach dated evidence and approved deltas.
- Mark decision `pass`, `pass with exceptions`, or `fail` in the sign-off file.

## External Input Blockers

### A7.3 / QEP-173 — OEM price-sheet parser

Blocker: `BLK-OEM-SHEETS`

Blocking downstream:

- A7.4 — Price diff engine
- A7.5 — Open-quote mispricing scan
- A7.6 — Price Impact card + Today-screen chip
- A7.7 — Re-price action with margin-floor gate
- A7.9 — Re-price audit log + 7-day reversibility

Linear escalation:

- QEP-173 comment: `29ccb554-2ef8-4e97-9a5d-1c39aa194c01`

Needed:

- ASV sample price sheet PDF
- Yanmar sample price sheet PDF
- Bandit sample sheet or confirmed format
- CMI sample sheet or confirmed format
- Known column legends, discount/rebate notes, freight/list-price conventions, and effective-date rules

### B3.1 / QEP-54 — Omi webhook edge function + admin shell

Blocker: `OMI-DOCS`

Blocking downstream:

- B2.5 — Canonical source enum normalization

Linear escalation:

- QEP-54 comment: `afd8c38c-3eb8-4fa1-8d01-8d2c685fffb0`

Needed:

- Omi webhook/API documentation
- HMAC/signature validation rules
- Event payload examples
- Idempotency/event id behavior
- Credential/secrets delivery path for staging
- Omi sandbox/staging endpoint details

### D2.3 / QEP-90 — JAR-105 OEM expansion

Blocker: `JAR-105`

Current note: prerequisite Stream C2 tasks are complete, but the roadmap task still carries the JAR-105 blocker.

Linear escalation:

- QEP-90 comment: `d63fd13c-c9a8-4b7a-be8e-3eb132862566`

Needed:

- Confirm what remains in the JAR-105 OEM expansion packet.
- Identify whether the remaining blocker is an owner decision, missing OEM document/sample, or architecture sign-off.
- Attach/link the packet or remove the blocker if Stream C2 completion satisfies it.

### D3.10 / QEP-104 — DNS for qep.blackrockai.co

Blocker: `QUA-108`

Linear escalation:

- QEP-104 comment: `d2b6362f-5083-44ea-a048-c4f34a5c512d`

Needed:

- DNS provider/account owner for `blackrockai.co`
- DNS target/CNAME/A record value for `qep.blackrockai.co`
- Hosting endpoint expectations for TLS/Netlify/Supabase
- Confirmation that staging is reachable after DNS change

### D3.5 / QEP-99 — Florida TILA / lending rule docs

Blocker: `BLK-TILA`

Blocking downstream:

- E1.6 — ADR-006 financing calculator compliance gate

Linear escalation:

- QEP-99 comment: `bf783336-724e-4d60-88f5-1ae113f498fc`

Needed:

- Florida TILA/lending rule docs or counsel-approved guidance
- Required disclaimer language for payment estimates
- Confirmation whether financing estimates may be shown before formal credit approval
- Required APR/payment assumptions and rounding rules
- Prohibited wording for customer-facing quote/payment surfaces

## Open Decision Blockers

Live `qep_decisions` rows still open:

| Code | Owner | Lane | Required action |
|---|---|---|---|
| Q7 | Rylee | RATIFY | Prospect quote policy: allow/deny and conversion timing |
| Q10 | Rylee | RATIFY | Rebate stack precedence policy |
| Q12 | Rylee | AUTHORIZE | Microsoft 365 consent / mailbox access policy |
| Q14 | Rylee | RATIFY | Source-required alert routing |
| Q15 | Rylee | RATIFY | Sales home priority cut |
| CYBER-INS | Rylee | AUTHORIZE | Cyber insurance coverage for AI-powered internal tools |

Linear blocker comments with recommended answers were already posted for these decisions earlier in the orchestration loop. Q11 has since been answered via audited delegation and is intentionally omitted from the open-decision table above.

## Resume Procedure

When any blocker is resolved:

1. Update the source artifact or `qep_decisions` row with the answer/evidence.
2. Run:

   ```bash
   npm --prefix roadmap-linear-sync run sync
   npm --prefix roadmap-linear-sync run next -- --json
   ```

3. If a task appears, start that task instead of manually choosing a lower-priority item.
4. Do not mark A1.1 or A1.2 shipped until their sign-off files contain dated reviewer evidence and an explicit pass/pass-with-exceptions decision.
