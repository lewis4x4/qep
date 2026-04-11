# 7C Entry Check

## Purpose

This document is the operational checklist for opening `7C`.
It exists so the roadmap entry condition is testable instead of implicit.

## Current Status

- `7B` signed off: yes
- Phase 5 ethics process documented: yes
- `7C.1` ethics note exists: yes
- Honesty Calibration full fiscal year evidenced: no
- `7C` open for implementation: no

## Blocking Condition

The remaining blocker is the roadmap requirement:

> Honesty Calibration has run for a full fiscal year.

Until that is evidenced, no `7C` slice opens.

## Evidence Check

Run this repo command against the target environment before opening `7C`:

```bash
bun scripts/verify/7c-entry-check.mjs --workspace=default --days=365
```

For manual verification or spot-checking, use these SQL queries against the
target database:

```sql
select min(rollup_date) as first_rollup_date,
       max(rollup_date) as latest_rollup_date,
       count(*) as rollup_days
from public.qrm_honesty_daily
where workspace_id = 'default';
```

```sql
select rollup_date
from public.qrm_honesty_daily
where workspace_id = 'default'
order by rollup_date asc;
```

## Pass Criteria

All of the following must be true:

1. The earliest `rollup_date` is at least one full fiscal year before the
   intended `7C` start date.
2. Rollups are materially continuous across that period.
3. There is no known backfill or data-reset event that makes the year
   untrustworthy.
4. The owner explicitly records that the fiscal-year condition is satisfied.

If any item is false, `7C` remains blocked.

The script uses a conservative continuity heuristic:

- earliest rollup date must be at least `365` days before the check date
- at least `330` daily rollups must exist in that window
- no single observed gap may exceed `7` days

## Required Output

Before any `7C` slice opens, add a short entry-check note that records:

- date checked
- environment checked
- first rollup date
- latest rollup date
- continuity judgment
- owner decision: `open_7c` or `blocked`

Latest recorded result:

- `docs/operations/7c-entry-check-2026-04-11.md`

## Next Allowed Step

Once the fiscal-year condition is evidenced, update:

- `docs/operations/7c1-trust-thermostat-ethics-review.md`
- this document
- the relevant roadmap status line

Only then may `7C.1 — Trust Thermostat` open for implementation.
