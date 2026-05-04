# QEP Tethr JAR-107 Repo Closeout Requirements

Date: 2026-05-04
Linear: JAR-107
Source packet: `QEP_TETHR_PROVIDER_DECISION_PACKET_2026-05-04.md`

## Repo-truth summary

JAR-107 cannot be honestly closed as `BUILT` from repo code alone. The repo has provider-neutral telematics foundation and readiness surfaces, but no live Tethr auth contract, provider adapter, webhook contract, payload mapping, or device-to-equipment mapping policy.

This note does not update the workbook and does not update the global parity decision queue.

## Existing foundation verified in repo

- `supabase/migrations/090_social_telematics.sql` creates `telematics_feeds` with provider/device/equipment linkage, last hours, last GPS, and freshness fields.
- `supabase/migrations/093_schema_hardening.sql` requires each telematics feed to target equipment or a subscription.
- `supabase/functions/telematics-ingest/index.ts` accepts a normalized provider-neutral reading shape and updates `telematics_feeds`; unknown devices are rejected.
- `supabase/functions/telematics-signal-ingest/index.ts` accepts normalized fault/idle signals and resolves `deviceId` through `telematics_feeds` before creating operator signals.
- `supabase/migrations/535_wave5_deferred_provider_registry_seed.sql`, `IntegrationHub`, `integration-availability`, and `integration-test-connection` register `tethr_telematics` as deferred/provider-readiness only.
- Asset 360 and Fleet Map read provider-neutral `telematics_feeds` for hours, location, and stale/fresh status.

## Safe scaffolding added for JAR-107

Provider-neutral disabled `Tethr It Now` readiness actions now appear on these workbook surfaces without submitting provider calls:

| Workbook surface | Repo surface | Behavior |
| --- | --- | --- |
| Equipment Invoicing / Sales Support Portal | `apps/web/src/features/equipment/pages/AssetDetailPage.tsx` telematics tab | Shows `Tethr It Now` disabled and links to generic fleet fallback. |
| Parts Invoicing | `apps/web/src/features/parts/pages/PartsOrderDetailPage.tsx` order detail | Shows `Tethr It Now` disabled next to parts order/invoice context. |
| Customer Portal | `apps/web/src/features/portal/pages/PortalEquipmentDetailPage.tsx` action rail | Shows `Tethr It Now` disabled and links to portal fleet fallback. |

The shared implementation is intentionally readiness-only:

- `apps/web/src/features/telematics/lib/tethr-readiness.ts`
- `apps/web/src/features/telematics/components/TethrReadinessAction.tsx`

## Exact external requirements before live Tethr implementation

Live provider work must not start until all of these are supplied or explicitly replaced/de-scoped in source control:

1. Tethr credentials and auth contract.
2. Webhook/API payload samples for hours, GPS, faults, and device metadata.
3. Device-to-equipment mapping source of truth.
4. Unknown-device handling policy.
5. Stale-data and failed-provider policy.
6. UI owner approval for each exact `Tethr It Now` action surface.

## Implementation implications after requirements arrive

- Add a Tethr adapter boundary, likely under `supabase/functions/_shared/adapters/tethr.ts`, that maps only documented Tethr payload fields into the existing normalized reading/signal shapes.
- Persist provider event IDs/idempotency markers and raw provider envelopes only after retention/security policy is approved.
- Add or verify a manual mapping workflow for unknown devices with audit trail.
- Wire enabled `Tethr It Now` behavior separately for Equipment Invoicing, Parts Invoicing, and Customer Portal.
- Keep Asset 360/Fleet Map as fallback/deeplink targets, not `BUILT` proof.

## Current blocker verdict

Status remains provider-blocked. Existing code plus the added readiness scaffolding is closeout evidence for repo honesty only, not workbook promotion evidence.
