# QEP IronGuides JAR-109 Repo Closeout Requirements

Date: 2026-05-04
Linear: JAR-109
Workbook row: Gap Register — `IronGuides vendor contract pending`
Current workbook status: `PARTIAL`

## Honest Repo Status

The repository does not contain a live IronGuides feed adapter, API contract, authentication contract, vendor payload fixture, or verification run using IronGuides-sourced market valuation data.

Current market valuation/DGE behavior is fallback/blended and demo-safe:

- `supabase/functions/_shared/adapters/ironguides-mock.ts` is explicitly a mock adapter.
- `supabase/functions/_shared/integration-manager.ts` has no live IronGuides adapter in `LIVE_ADAPTERS`.
- `supabase/functions/_shared/market-valuation-refresh.ts` blends IronGuides mock, auction data, and Rouse telemetry when live adapters are unavailable.
- `apps/web/src/features/dge/components/MarketValuationCard.tsx` displays source badges/breakdown, but those badges are not live IronGuides contract evidence.

Therefore, the workbook row must not be marked `BUILT` from current code, mock data, demo mode, fallback/blended valuation, or provider registry evidence.

## Safe Readiness Scaffolding Added

Migration `supabase/migrations/539_ironguides_decision_readiness.sql` records `integration_status.config` metadata for `integration_key = ironguides` when the row is not already replaced:

- `parity_blocker = JAR-109`
- `provider_scope = parity_external_decision`
- `implementation_status = decision_required`
- `decision_required = true`
- `external_dependency_required = true`
- `live_feed_contract_required = true`
- `live_adapter_implemented = false`
- `live_feed_required_for_built = true`
- `replacement_decision_required_for_na = true`

Admin integration surfaces now treat `provider_scope = parity_external_decision` / `implementation_status = decision_required` as readiness-only, so credential entry and connection testing are disabled instead of implying a live feed can be verified from mock behavior.

The replacement UI path is prepared but not activated for IronGuides. It only activates when runtime config contains both:

- `lifecycle = replaced`
- `external_dependency_required = false`

and a replacement surface is named. This requires a real owner-approved decision before the UI will show IronGuides as replaced.

## Path A — Exact Live Feed Requirements

Before any IronGuides live-feed build or workbook `BUILT` target, provide all of the following:

1. Signed IronGuides contract or written vendor authorization for QEP.
2. API/feed documentation, including endpoint shape and rate limits.
3. Authentication method and credential storage/rotation owner.
4. Sandbox credentials or sample payloads suitable for source-controlled fixtures.
5. Feed cadence and freshness expectations.
6. Allowed valuation fields: FMV, low/high estimates, comparables, pricing intelligence, or full feed.
7. Data retention, customer/privacy, and downstream reporting constraints.
8. Required error/status vocabulary for auth failures, no-match, stale data, rate limits, and upstream outages.
9. Source-controlled live adapter/feed ingestion code that does not reuse the mock contract as proof.
10. Verification using IronGuides-sourced market valuation data.
11. UI/report evidence that valuations cite live IronGuides data where applicable.
12. `integration_status` row outside demo/mock readiness with configured credentials/readiness and audited cutover evidence.

## Path B — Exact Replacement Decision Requirements

Before workbook `N_A` / replaced target, provide all of the following:

1. Source-controlled business decision explicitly stating live IronGuides is not required for this QEP deployment.
2. Owner approval and effective date.
3. Replacement policy naming QEP fallback/blended valuation as the standard valuation policy.
4. Impact statement for sales, rental, trade-in, and executive reporting.
5. Runtime `integration_status` update for `ironguides` with:
   - `status = demo_mode` or another non-live status approved by the owner
   - `config.lifecycle = replaced`
   - `config.external_dependency_required = false`
   - `config.replacement_surface = QEP fallback/blended valuation`
   - `config.replacement_label` / `replacement_summary` suitable for admin UI display
6. Workbook evidence note citing the source-controlled decision and runtime readiness state.

## Blocker Remaining

JAR-109 remains blocked by external decision evidence. The repo can prepare decision/readiness guardrails, but it cannot honestly close the row without either live IronGuides contract/feed evidence or a signed/source-controlled replacement decision from the valuation/business owner.
