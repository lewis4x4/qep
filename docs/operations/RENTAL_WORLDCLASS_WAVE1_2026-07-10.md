# Rental World-Class Wave 1 — 2026-07-10

## Plan (operator utility × mission)

| # | Slice | Why |
|---|---|---|
| 1 | Return ancillary cents (fuel/clean/env/damage) | Final invoices were still missing yard assessments |
| 2 | Deposit settlement on final bill | Paid deposits never flipped after apply/refund |
| 3 | Issue-quote desk UI | L9.5 API existed with zero counter surface |
| 4 | Close returned contracts | Trunk stopped at `returned` |
| 5 | Counter book rates from L1 resolver | Day-only sticker preview underbilled |

Deferred (Wave 2+): geofence writer, availability calendar UI, conversion board rank from rental truth, RPO/rerent origination, commissions writer, voice/Iron origination.

## Shipped

- Migration `819_rental_worldclass_desk_money.sql`
- `rental-ops` create_contract auto-fills book rates; `close_contract` action
- `rental-billing-runner` deposit `applied` / `refund_due` + refund exception
- `/ops/returns` fuel/clean/env + cents on dispose
- Rental Command Center: draft quotes, close returned, day/week/month book

## Gates

- `bun run migrations:check`
- Focused tests for m819 + rental billing/ops
- Deploy `rental-ops`, `rental-billing-runner`
- Apply m819 via `bun run db:push:apply`
