# SLICE 06 — Admin UI Polish

**Status:** Planned. Not yet started.

**Depends on:** Slice 05 (Conversational Deal Engine) — shipped 2026-04-17.

---

## Objective

Bring the Quote Builder admin and configuration surfaces to production quality. Slice 05 deferred all admin UI work to keep the conversational engine scope tight. This slice closes that gap.

---

## Scope (placeholder — details TBD at kickoff)

| Area | What's needed |
|---|---|
| Brand discount configuration | UI for admin/manager to set `dealer_discount_pct`, `pdi_pct`, `good_faith_pct`, `default_markup_pct` per brand; unlocks forestry brands + "other" brands that currently return non-fatal `discount_configured = false` errors from the deal engine |
| Freight zone management | UI to view, add, edit, delete freight zones (`qb_freight_zones`) by state + brand; replaces the fallback hardcoded rate |
| Program admin | UI for viewing and managing program eligibility rules; currently programs are seeded/imported but have no admin surface |
| Price sheet status | Surface showing which brands have official price books loaded (from Slice 04 ingestion) vs. seed/approximate data |
| `qb_ai_request_log` viewer | Elevated role view of deal engine request history for ops visibility; latency, confidence scores, error rates |

---

## Out of Scope for Slice 06

- New pricing features or engine changes (Slice 07)
- Scenario → quote save flow refinement (Slice 07)
- P50/P95 latency analytics dashboard (future analytics pass)

---

## Open Items Carried from Slice 05

1. **Forestry + other brand scenarios** — 10 brands with `discount_configured = false` blocked from deal engine until discount rates are entered here.
2. **Real list prices** — 6 ASV demo models use approximate prices; superseded once Slice 04 price book upload runs.
3. **`home-route.test.ts` pre-existing failure** — `resolveHomeRoute("owner")` returns `/owner`, test expects `/qrm`. Unrelated to QB. Tracked for cleanup.

---

## Acceptance Criteria (to be finalized at kickoff)

- [ ] Admin can configure brand discount rates from the UI without touching the DB directly
- [ ] Admin can manage freight zones per brand/state
- [ ] At least one forestry brand configured end-to-end: discount rates set → deal engine returns valid scenarios
- [ ] `bun run typecheck` + `bun run build` exit 0
- [ ] RLS enforced on all new admin API paths (admin/manager/owner only)
