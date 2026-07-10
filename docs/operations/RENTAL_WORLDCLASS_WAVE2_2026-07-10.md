# Rental World-Class Wave 2 — 2026-07-10

## Shipped

| Slice | Delivery |
|---|---|
| **Geofence writer** | `rental_evaluate_geofence_crossings` — telematics GPS vs `customer_jobsite` polygons → `geofence_events` (enter/exit). Hooked into `rental_intelligence_scan` + 15-min cron `rental-geofence-evaluate`. Existing exit trigger + flow fire as designed. |
| **Availability calendar** | Command Center 14-day grid over `rental_availability_calendar` (fleet or selected unit). |
| **Conversion board** | Workspace RPC `rental_conversion_board` ranked by RPO + trailing billed; Command Center list; account Conversion Engine rebuilt on rental truth with convert CTA. |
| **RPO / re-rent origination** | Counter `create_contract` accepts `rpo` (buyout + credit % + deadline) and `rerent` (vendor + cost on sub-rental line). |

## Production

- Migration **820** applied
- `rental-ops` redeployed

## Residual (Wave 3+)

- Commissions writer on checkout/close
- Voice/Iron origination doors
- Availability.low scanner branch
- Live geofence UI map for jobsite setup
