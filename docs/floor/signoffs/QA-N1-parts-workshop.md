# QA-N1 Parts Workshop Sign-Off

Status: unsigned. Final lost-sales logging and supplier-health depth are blocked until this document is completed and signed by Brian and Norman.

Owner: Norman and Brian Lewis.
Required before: claiming `parts.lost-sales` and deep `parts.supplier-health` logic as final.

## Decision Record

Meeting date:
Attendees:
Signed by:
Signed at:

## Required Decisions

1. Lost-sale reason codes:
   - Question: What exact reason codes should be selectable?
   - Decision:

2. Lost-sale required fields:
   - Question: Which fields are required to log a lost sale?
   - Decision:

3. Lost-sale logging owner:
   - Question: Who logs a lost sale: counter staff, parts manager, sales admin, or the system?
   - Decision:

4. Supplier-health dimensions:
   - Question: Which dimensions matter: fill rate, backorder age, late PO count, price variance, freight cost, return quality, or others?
   - Decision:

5. Stockout thresholds:
   - Question: What inventory level, demand signal, or days-of-cover threshold counts as stockout risk?
   - Decision:

6. Branch handling:
   - Question: Should Lake City and Ocala share stockout/lost-sales views or have branch-specific layouts and metrics?
   - Decision:

## Implementation Gate

Until the decisions above are signed, Floor widgets must label parts lost-sales and supplier-health values as source/proxy data. Do not add final reason-code schema or supplier scoring from assumptions.
