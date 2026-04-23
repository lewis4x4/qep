# QA-R2 Commission Rules Sign-Off

Status: unsigned. Final commission math is blocked until this document is completed and signed by Brian and Rylee.

Owner: Rylee McKenzie and Brian Lewis.
Required before: claiming `sales.commission-to-date` as final commission logic.

## Decision Record

Meeting date:
Attendees:
Signed by:
Signed at:

## Required Decisions

1. Eligible quote statuses:
   - Question: Which `quote_packages.status` values are commission-eligible?
   - Decision:

2. Rep attribution:
   - Question: Is commission credited to `quote_packages.created_by`, CRM deal assigned rep, quote owner, or another field?
   - Decision:

3. Split deals:
   - Question: How are deals split between multiple reps or managers?
   - Decision:

4. Payout basis:
   - Question: Is payout based on revenue, gross margin, net margin, equipment subtotal, parts subtotal, or another value?
   - Decision:

5. Timing:
   - Question: Is commission earned at quote acceptance, invoice creation, payment received, delivery, or month close?
   - Decision:

6. Refunds and chargebacks:
   - Question: How do refunds, cancellations, returned units, and chargebacks adjust earned commission?
   - Decision:

7. Manager overrides:
   - Question: Who can override commission, what fields are required, and where is the audit trail stored?
   - Decision:

## Implementation Gate

Until the decisions above are signed, Floor widgets must label commission values as source/proxy data. Do not add final `commission_rules` or `commission_ledger` behavior from assumptions.
