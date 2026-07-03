# QA-N1 Parts Workshop Sign-Off

Roadmap item: E5.4 / QEP-135
Source evidence: `QEP (1)/CLAUDE_CODE_HANDOFF_2026-04-23.md` §9
Status: SUPERSEDED FOR PRICING — the returned Parts Department Discovery closes the pricing-ruleset portion of this gate.

Owner: Norman, Juan, Brian Lewis, and Architect.
Required before: claiming final `parts.lost-sales` reason-code depth or deep `parts.supplier-health` scoring. Parts-pricing schema/ruleset behavior now uses `docs/architecture/parts-pricing-ruleset.md`.

## Decision Record

Meeting date: 2026-05-26 returned discovery packet
Attendees: QEP Parts Discovery respondents; engineering record transcribed in `QEP (1)/QEP_PARTS_DEPARTMENT_DISCOVERY_COMPLETED_2026-05-26.md`
Signed by: Roadmap migration `650_qep_phase_one_source_of_truth_streams_g_to_k.sql` marks E5.4 shipped and D3.7 unblocked from returned discovery
Signed at: 2026-05-26 source artifacts, reconciled in repo on 2026-07-02

## Required Decisions

1. Parts pricing matrix:
   - Question: What categories, vendor families, customer classes, or branch rules drive parts markup?
   - Decision: Standard parts sell at list price unless a Parts Manager-set customer or volume price applies. Parts target 35% margin and must not go below the 25% margin floor.

2. Core charges and exchange programs:
   - Question: Which parts require core charge, exchange, return-window, or refund handling?
   - Decision:

3. Freight and vendor-direct pricing:
   - Question: How should freight, vendor-direct orders, emergency buys, and special-order fees affect price?
   - Decision:

4. Discount authority and exceptions:
   - Question: Who can override parts pricing, what approval threshold applies, and where is the audit trail stored?
   - Decision: Counter staff may discount up to 5% off the parts price. Discounts beyond 5% require Parts Manager approval and block ticket close until approved. Customer-specific and volume pricing are owned by the Parts Manager. Audit fields must capture rule/source identifier, approver metadata, override reason, price/cost/margin snapshots, and floor-applied flag.

5. Price-file source of truth:
   - Question: Which dealer/OEM files or IntelliDealer exports are authoritative for current parts cost/list pricing?
   - Decision:

6. Lost-sale reason codes:
   - Question: What exact reason codes should be selectable?
   - Decision:

7. Lost-sale required fields:
   - Question: Which fields are required to log a lost sale?
   - Decision:

8. Lost-sale logging owner:
   - Question: Who logs a lost sale: counter staff, parts manager, sales admin, or the system?
   - Decision:

9. Supplier-health dimensions:
   - Question: Which dimensions matter: fill rate, backorder age, late PO count, price variance, freight cost, return quality, or others?
   - Decision:

10. Stockout thresholds:
   - Question: What inventory level, demand signal, or days-of-cover threshold counts as stockout risk?
   - Decision:

11. Branch handling:
   - Question: Should Lake City and Ocala share stockout/lost-sales views or have branch-specific layouts and metrics?
   - Decision:

## Implementation Gate

Pricing ruleset implementation may proceed from `docs/architecture/parts-pricing-ruleset.md`. Until the non-pricing decisions above are signed, Floor widgets must label lost-sales and supplier-health values as source/proxy data. Do not add final lost-sale reason-code schema or supplier scoring from assumptions.

## Current blocker status

The original Norman/Juan workshop blocker is closed for parts pricing by the returned discovery and D3.7 ruleset. Remaining manual follow-ups are limited to non-pricing QA-N1 dimensions and the Controller sign-off required before G11 internal work-order pricing goes live.
