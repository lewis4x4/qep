# Rental World-Class Wave 3 — 2026-07-10

## Shipped

| Slice | Delivery |
|---|---|
| **Commissions writer** | `rental_ensure_default_commission` + on_rent trigger; create_contract / check_out / Iron draft seed 100% originator split |
| **availability.low + cycle.due** | Extended `rental_lifecycle_scan`; workflows `rental-availability-low` and `rental-cycle-due` |
| **Jobsite geofence UI** | `rental_upsert_jobsite_geofence` (lat/lng/radius → circular PostGIS fence) + Command Center form |
| **Voice/Iron origination** | Iron action stamps `originated_by` + channel voice|iron + commission; counter supports `origination_channel=voice` |

## Production

- Migration **821** applied
- Deployed: `rental-ops`, `flow-runner`

## Residual

- Multi-rep commission editor UI (schema supports splits; default is 100% originator)
- Map picker for jobsite fences (form is numeric lat/lng)
- Feature-flag rollout for Iron open-rental in production voice
