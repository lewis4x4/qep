# Parts Pricing Ruleset

Status: Canonical D3.7 ruleset for Phase 3 Parts build slices.
Roadmap: D3.7 / QEP-101, "Parts pricing ruleset documented".
Primary sources:
- `QEP (1)/QEP_PARTS_DEPARTMENT_DISCOVERY_COMPLETED_2026-05-26.md`
- `QEP (1)/QEP_PHASE3_PARTS_BLUEPRINT_2026-05-26.md`

## Baseline Policy

1. Standard parts sell at list price unless a Parts Manager-set customer or volume price applies.
2. Parts pricing targets 35 percent margin and must not go below a 25 percent margin floor.
3. Counter staff have standing authority to discount up to 5 percent off the parts price.
4. Discounts beyond 5 percent require Parts Manager approval and block ticket close until approved.
5. Parts pricing is not rep-negotiable. Customer-specific and volume pricing are owned by the Parts Manager.
6. Customer-pay service work orders use the standard parts price.
7. Internal work orders, including recon, rental-fleet maintenance, and PDI, use standard sell price minus 10 percent, never below the 25 percent margin floor.

Formula for internal work-order parts pricing:

```text
customer work order: list_price
internal work order: max(list_price * 0.90, current_cost / 0.75)
```

Controller sign-off on the internal work-order rate remains required before G11 goes live. That sign-off does not block the G8 pricing engine baseline.

## Schema Validation Gate

Any G8 implementation must be able to represent and audit:

- `target_margin_pct = 35`
- `min_margin_pct = 25`
- `counter_discount_cap_pct = 5`
- price source: list price, Parts Manager customer price, Parts Manager volume price, or internal work-order formula
- approval state for discounts over 5 percent
- approver, approval timestamp, and override reason
- pricing rule/source identifier on each priced line
- final price snapshot, cost snapshot, margin snapshot, and floor-applied flag

Cost and margin fields must remain hidden from `sales_rep` and `parts_counter` roles by policy, not only by UI.

## Deferred Extensions

These are not required to close D3.7, but they should not be guessed during implementation:

- full freight, emergency-buy, vendor-direct, and special-order fee markup matrix
- core-charge and exchange-program pricing rules beyond existing core schema fields
- controller sign-off for the G11 internal-pricing launch
- 22-brand OEM portal/login list for G2
- current kit catalog export for G10
- IntelliDealer parts usage history export for G6

Until a deferred extension is signed, represent it as a separate explicit fee, manager-reviewed adjustment, or blocked follow-up rather than embedding assumed markup behavior in the pricing engine.
