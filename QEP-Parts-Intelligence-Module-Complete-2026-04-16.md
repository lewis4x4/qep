# QEP Parts Intelligence Module — Complete

**Date:** 2026-04-16
**Status:** Phase 1 + Phase 2 + Phase 3 shipped. Only Slice 3.7 (competitive pricing scrape) remains — explicitly parked behind Sales.

---

## Final scorecard vs. master plan

### Phase 1 — Foundation · 100% ✅
| Slice | Status | Evidence |
|---|---|---|
| 1.1 Schema extensions | ✅ | m257 |
| 1.2 `parts-bulk-import` | ✅ | edge fn deployed |
| 1.2b Conflict reconciliation | ✅ | `ImportConflictsPage` |
| 1.3 Admin import UI | ✅ | `/parts/companion/import` |
| 1.4 Initial hydration | ✅ | 4,317 parts · 17,881 Yanmar prices · 47 vendors |
| 1.5 Re-import guardrails | ✅ | drift view m259 + hash-dedup |

### Phase 2 — Intelligence · 100% + 1 bonus ✅
| Slice | Status | Evidence |
|---|---|---|
| 2.1 Seeded demand forecast (v2 blended_cdk) | ✅ | |
| 2.2 Auto-replenish w/ vendor schedules | ✅ | |
| 2.3 Dead/slow/hot stock detection | ✅ | `v_parts_dead_capital` |
| 2.4 Vendor price arbitrage | ✅ | `v_parts_margin_signal` |
| 2.5 Stockout prevention | ✅ | `v_parts_stockout_risk` |
| 2.6 Machine↔parts knowledge graph | ✅ | m261 |
| 2.7 Replenish Queue Review UI | ✅ | `ReplenishPage` |
| **P2.5 Pricing Rules Engine** (bonus) | ✅ | m264 |

### Phase 3 — Moonshot · 6 of 7 shipped ✅
| Slice | Status | Evidence |
|---|---|---|
| 3.1 Natural-language parts search | ✅ | `match_parts_hybrid` + HNSW |
| 3.2 Voice-first counter ops | ✅ | `parts-voice-ops` (4 Claude tools) |
| 3.3 Predictive failure → pre-position | ✅ | m262, 12 live plays in prod |
| 3.3b Claude-augmented predictive plays | ✅ | `parts-predictive-ai` |
| **3.4 Visual Parts ID** (this session) | ✅ | `VisualPartIdModal` → LookupPage |
| **3.5 Supplier Health Scorecard** (this session) | ✅ | m281 + `SupplierHealthPage` |
| **3.6 Post-Sale Parts Playbook** (this session) | ✅ | m280 + Claude edge fn + `PostSalePlaysPage` |
| 3.7 Competitive pricing intel | 🔖 parked | Deferred — needs public-dealer scrape, ethical/legal review |

---

## What shipped today (4 commits on main)

### Commit `62e994b` — Slice 3.4 Visual Parts ID
- `VisualPartIdModal.tsx` dark-themed modal matching LookupPage design tokens
- Camera icon in search bar → device camera or upload → `parts-identify-photo` (Claude Vision GPT-4o) → ranked catalog matches
- Equipment-context hint input boosts accuracy
- Selecting a match populates search input + runs hybrid search

### Commit `9746b53` — Slice 3.6 Post-Sale Parts Playbook
- Migration 280: `post_sale_parts_playbooks` table + `post_sale_playbook_summary()` RPC + `eligible_deals_for_playbook()` RPC
- Edge fn `post-sale-parts-playbook` (Claude Sonnet 4.6):
  - Reads qrm_deals + qrm_equipment + machine_profiles.maintenance_schedule + common_wear_parts + qrm_companies
  - Outputs STRICT JSON 30/60/90-day plan with narratives
  - Grounds every part hint via `match_parts_hybrid` — no hallucinated SKUs
  - Batch path for cron, single path for rep-triggered refresh
- `PostSalePlaysPage` at `/parts/companion/post-sale`:
  - 4-card summary grid (open revenue, drafts, accepted, eligible deals)
  - "Generate for N eligible" button fires the batch path
  - Detail drawer shows per-window service description + parts list with match scores
  - Status lifecycle: draft → reviewed → sent → accepted (or dismissed at any stage)

### Commit `970425f` — Slice 3.5 Supplier Health Scorecard
- Migration 281: three new `security_invoker=true` views
  - `v_supplier_price_creep`: weighted YoY list-price change per vendor
  - `v_supplier_fill_rate`: 90-day replenish lifecycle aggregation
  - `v_supplier_health_scorecard`: one-row-per-vendor rollup + tier derivation
- `supplier_health_summary()` RPC for dashboard consumption
- `SupplierHealthPage` at `/parts/companion/suppliers` (admin-only):
  - Tier counts card grid (Healthy / Watch / Intervene)
  - Signal panels: top red vendors, top price creep, lowest fill
  - Full table with color-graded YoY% + fill% + last-file staleness

**Tier derivation logic:**
- **red** = ≥5% YoY price creep OR ≤60% fill rate OR no vendor file in 120+ days
- **yellow** = ≥2% YoY price creep OR ≤80% fill rate OR no vendor file in 60+ days
- **green** = everything else

Currently 21 vendors, all green — tiers will light up as parts_vendor_prices accumulates multi-year rows and the replenish queue builds lifecycle history.

---

## Parts module — cumulative production state

**Schema:** 20 migrations (257 → 281) dedicated to parts intelligence.

**Edge functions (Parts-specific):**
- `parts-bulk-import`, `parts-auto-replenish`, `parts-demand-forecast`, `parts-reorder-compute`
- `parts-pricing-autocorrect`, `parts-embed-backfill`
- `parts-predictive-ai`, `parts-predictive-failure`, `parts-predictive-kitter`
- `parts-voice-ops`, `parts-identify-photo`, `ai-parts-lookup`
- `parts-network-optimizer`, `parts-order-customer-notify`, `parts-order-manager`
- `post-sale-parts-playbook` (new today)
- `voice-to-parts-order`, `process-parts-request`
- `service-parts-manager`, `service-parts-planner`

**Frontend pages in Parts Companion:**
- Queue, Lookup (with Visual Parts ID), Machines, Machine Profile, Arrivals
- Intelligence, Predictive Plays, **Post-Sale** (new), Replenish, Pricing
- Import, Import Conflicts
- **Suppliers** (new)

**Claude-powered surfaces:**
| Surface | Model | Use |
|---|---|---|
| `parts-voice-ops` | Sonnet 4.6 | Counter rep voice commands with 4 tools |
| `parts-predictive-ai` | Sonnet 4.6 | Per-machine predictive play generation |
| `parts-identify-photo` | GPT-4o | Visual parts identification |
| `post-sale-parts-playbook` | Sonnet 4.6 | 30/60/90 maintenance plan generation |

**Live prod data flowing through it all:**
- 4,317 parts catalog
- 17,881 Yanmar list prices
- 47 vendor contacts
- 12 open predictive plays ($1,351 projected revenue)
- 3,560 critical stockouts tracked
- $79,469 dead capital identified

---

## What's parked

**Slice 3.7 — Competitive pricing intel** (public-dealer scrape). Deferred. Needs:
- Legal review on public price scraping
- Choice of data broker or custom scrape infrastructure
- Schema for competitive_prices + benchmark deltas

Low urgency vs Sales moonshot impact. Recommend revisiting after Sales ships.

---

## Cleared for Sales

The Parts module is production-ready and genuinely ahead of commodity DMS. Every mission check in CLAUDE.md is satisfied per slice. Pipeline forward revenue forecast from post-sale playbooks will feed directly into the Sales moonshot (sales reps see "your customer has 3 open playbooks worth $2,400 projected" when they open a deal).

Ready to move to Sales.
