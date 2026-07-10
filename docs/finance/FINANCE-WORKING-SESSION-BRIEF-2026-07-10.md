# Finance Working Session — Decision Brief

**Date prepared:** 2026-07-10
**Unblocks:** M0.1, M6.1 (BLK-FIN-WORKING-SESSION), interacts with K2.1 / K3.1 (BLK-FIN-MIGRATION-PATH)
**Source of truth:** [REVENUE-CONVERGENCE-BLUEPRINT.md](REVENUE-CONVERGENCE-BLUEPRINT.md) §10 decision register (ratified 2026-07-08). This brief adds options and a recommendation per item so the session can run in ~30 minutes. Recommendations are engineering's; final say is Brian + accountant.

Everything **not** listed here is already unblocked engineering per the blueprint.

---

## 1. Company id-space ratification (§1)

**Context.** Rental anchors on `qrm_company_id`; `customer_invoices` carries `crm_company_id`. Post-m170 these are the same `qrm_companies` ids through compat views, but rental rate rules still store portal-space customer ids (`rental_resolve_rates` records `id_space` and raises mismatch exceptions), and the AR mirror skips counter-only contracts because it requires a portal identity.

**Options.**
- **A (recommended): qrm ids everywhere for financial anchors.** Portal identities become auth-only aliases (the `qep_find_or_create_portal_identity` bridge already exists and is used by the share-link signer and fleet writer). One-time backfill migrates rate-rule customer ids; an audit query lints future violators.
- **B: dual-space with a mapping table.** Preserves existing rows untouched but every join pays the mapping cost forever and every new writer is a fresh chance to pick the wrong space.

**Consequence of deferral.** Counter rental revenue keeps skipping the AR mirror; rate rules keep firing mismatch exceptions; every Stream M writer built before ratification risks rework.

## 2. Invoice number format per department (§3)

**Context.** `invoice_number_sequences` (m655/m662) is branch-prefixed and the admin UI already offers a `rental` department type. Rental's private `next_rental_invoice_number` (m776) mints numbers like `00-R1000` today.

**Options.**
- **A (recommended): branch prefix + department letter + sequence** (`{BB}-{D}{NNNN}`, e.g. `00-R1042`, `00-S0311`, `00-P2210`, `00-E0007`). Matches what rental already prints; a human on the phone can tell department and branch from the number.
- **B: unified numeric sequence, department only as a column.** Simpler minting, but numbers are opaque and cross-department gaps invite "missing invoice?" questions from the accountant.

**Also ratify:** `next_rental_invoice_number` is demoted to internal correlation only (blueprint direction) — rental draws from the shared sequences like everyone else.

**Consequence of deferral.** Equipment and parts invoice writers (the two biggest revenue lines, currently invoice-less) cannot mint numbers, so M2/M3 stay parked.

## 3. GL account mapping + internal-GL posting basis (§5)

**Context.** `_shared/quickbooks-gl.ts` has no rental or equipment revenue account; `inferRevenueAccount` silently falls back to misc revenue (RF-011 — rental invoices manually synced today post to misc). Internal GL (`gl_journal_entries`) is written only by the reversal path.

**Options.**
- **A (recommended): explicit per-workspace account map** — add `rental_revenue_account_id`, `equipment_revenue_account_id`, plus damage-recovery and deposit-liability accounts; replace the misc fallback with an exception (blueprint-ratified direction). Internal GL: post simple entries at invoice posting (revenue/AR), **no allocation basis yet** — defer allocation to the K3.1 QuickBooks-reduction decision in the same session so it's decided once.
- **B: keep inference + misc fallback.** Zero setup, permanently wrong books.

**Needed from the accountant in-session:** the actual QuickBooks account ids for the four revenue lines + deposit liability.

**Consequence of deferral.** Every synced rental dollar keeps landing in misc revenue; equipment invoices would too the day M2 ships.

## 4. Finance-charge policy + statement cadence (§8)

**Context.** `ar_statement_runs` (m448) is writer-less; `run_ar_dunning_cycle` exists with a cron (N5.1) but no charge assessment. M6.1 builds statements + charges once policy exists.

**Recommendation (strawman to react to):**
- Statements: monthly, calendar-month close, generated the 1st, delivered via the consent-checked notify path.
- Finance charges: 1.5%/month (18% APR) on balances >30 days past due, $5 minimum, per-workspace config, override-with-approver to waive. **Accountant confirms FL usury/disclosure requirements before first assessment.**
- Dunning cadence: weekly cron (exists) with statement-linked escalation tiers.

**Consequence of deferral.** M6.1 stays parked; AR ages with no systematic pressure.

## 5. Deposit application order + trade-credit treatment (§2)

**Recommendation:**
- Rental deposits: settle against the **final rental invoice** first (matches the built L9.2/wave-1 settlement path), residue refunds.
- Equipment deposits: apply to the equipment invoice at posting, oldest-first if multiple.
- Trade credit: **negative line item on the equipment invoice** (not a separate credit memo) — one document for the customer and one QuickBooks artifact. Flag: if the accountant prefers credit memos for audit trail, engineering cost is similar; decide once.

## 6. FET handling on equipment invoices (§2)

**Context.** Federal excise tax applies to certain highway trucks/tractors (12%), generally **not** to construction/ag equipment. QEP's mix is mostly non-FET, but trade-ins/haulers can trigger it.

**Recommendation:** per-item `fet_applicable` flag, default **off**; when on, FET renders as a distinct invoice line with its own tax code slot (m477 machinery). Accountant confirms which stocked categories can ever trigger FET; no automation beyond the flag in v1.

---

## Suggested session agenda (30 min)

1. Items 1–2: ratify (5 min — recommendations align with what's already built).
2. Item 3: accountant brings QuickBooks account ids (10 min).
3. Item 4: react to the strawman policy (10 min).
4. Items 5–6: confirm or redirect (5 min).

**Output wanted:** a one-line ruling per item recorded in the roadmap notes for M0.1 — that flips M0.1 to buildable and unblocks M2/M3/M6.1 and the K2.1/K3.1 follow-ons.
