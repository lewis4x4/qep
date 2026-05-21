# QA-N1 Parts Workshop Sign-Off

Roadmap item: E5.4 / QEP-135
Source evidence: `QEP (1)/CLAUDE_CODE_HANDOFF_2026-04-23.md` §9
Status: BLOCKED — Norman parts-pricing ruleset workshop not yet signed

Owner: Norman, Juan, Brian Lewis, and Architect.
Required before: claiming final `parts.lost-sales`, deep `parts.supplier-health`, or parts-pricing schema/ruleset behavior.

## Decision Record

Meeting date:
Attendees:
Signed by:
Signed at:

## Required Decisions

1. Parts pricing matrix:
   - Question: What categories, vendor families, customer classes, or branch rules drive parts markup?
   - Decision:

2. Core charges and exchange programs:
   - Question: Which parts require core charge, exchange, return-window, or refund handling?
   - Decision:

3. Freight and vendor-direct pricing:
   - Question: How should freight, vendor-direct orders, emergency buys, and special-order fees affect price?
   - Decision:

4. Discount authority and exceptions:
   - Question: Who can override parts pricing, what approval threshold applies, and where is the audit trail stored?
   - Decision:

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

Until the decisions above are signed, Floor widgets must label parts pricing, lost-sales, and supplier-health values as source/proxy data. Do not add final parts-pricing schema, reason-code schema, or supplier scoring from assumptions.

## Current blocker

Norman and Juan have not yet provided the parts pricing ruleset document required by `CLAUDE_CODE_HANDOFF_2026-04-23.md` §9. This is a human pricing-policy gate, not a code implementation gate.
