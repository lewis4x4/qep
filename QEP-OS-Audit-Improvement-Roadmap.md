# QEP OS — Roadmap to 9.5+ Audit Scores

**Date:** 2026-04-09
**Current Scores:** Security 9.5 | Database 9.0 | Performance 7.0 | Code Quality 9.0 | UI/UX 9.5
**Target:** All categories at 9.5+

---

## Current Scorecard

| Category | Current | Target | Gap |
|----------|---------|--------|-----|
| Security | 9.5/10 | 9.5+ | ✅ Already there |
| Database | 9.0/10 | 9.5+ | 0.5 — need minor fixes |
| Performance | 7.0/10 | 9.5+ | 2.5 — biggest gap |
| Code Quality | 9.0/10 | 9.5+ | 0.5 — minor cleanup |
| UI/UX | 9.5/10 | 9.5+ | ✅ Already there |

---

## Phase 1: Performance (7.0 → 9.5) — Highest Priority

### P1.1 — Scope-Based Query Selection (CRITICAL)
**Problem:** The QRM command center edge function fires 25 queries (21 in parallel) on every request. At 10+ concurrent users, this risks connection pool exhaustion.

**Fix:** Conditional query execution based on scope:
```
scope="mine" → 9 essential queries (deals, stages, signals, contacts, companies, revenue, grid)
scope="team" → all 25 queries (full dashboard context)
```

Non-essential sections (Relationship Engine, Knowledge Gaps, Executive Intel) load lazily via a second request when the user scrolls to them.

**Impact:** Reduces per-request DB load by 60% for reps. Eliminates connection pool risk.
**Effort:** 2 days
**Score improvement:** +1.5

### P1.2 — Lazy Section Loading (Frontend)
**Problem:** The `useCommandCenter()` hook fetches ALL sections in one request, even sections below the fold that may never be viewed.

**Fix:** Split into `useCommandCenterCore()` (top sections) and `useCommandCenterExtended()` (below-fold sections, triggered by IntersectionObserver). Extended sections load when scrolled into view.

**Impact:** Faster first paint. Less wasted bandwidth.
**Effort:** 1 day
**Score improvement:** +0.5

### P1.3 — React PDF Code Splitting
**Problem:** `@react-pdf/renderer` is 1.5MB gzipped. Currently lazy-loaded via dynamic import, but the chunk exists in the build.

**Fix:** Move to a separate entry point with manual chunk splitting in Vite config. Only downloads when "Download PDF" is actually clicked.

**Impact:** Eliminates the >1200KB chunk warning.
**Effort:** 0.5 days
**Score improvement:** +0.25

### P1.4 — Edge Function Warm Pool
**Problem:** 14 module imports in the command center edge function = 2-3 second cold start.

**Fix:** Add a `/health` ping endpoint and configure a 5-minute keep-alive cron to prevent cold starts during business hours.

**Impact:** Eliminates cold-start latency for first user each morning.
**Effort:** 0.5 days
**Score improvement:** +0.25

**Phase 1 total: 7.0 → 9.5 (+2.5)**

---

## Phase 2: Database (9.0 → 9.5)

### P2.1 — email_drafts.to_email NOT NULL Constraint
**Problem:** The new `to_email` column (migration 217) is nullable. Drafts without recipients can't be sent.

**Fix:** After backfill stabilizes, add `ALTER TABLE email_drafts ALTER COLUMN to_email SET NOT NULL` with a migration that dismisses stale NULL drafts first.

**Effort:** 0.5 days
**Score improvement:** +0.15

### P2.2 — Workspace ID Audit
**Problem:** The company search and equipment loading errors suggest potential workspace ID mismatches for some users.

**Fix:** Add a diagnostic RPC function `diagnose_workspace_access(p_user_id)` that returns: active_workspace_id, profile workspace match, RLS policy evaluation results for core tables. Run against all active users.

**Effort:** 1 day
**Score improvement:** +0.2

### P2.3 — Connection Pooler Configuration
**Problem:** 25 parallel queries per request × concurrent users → PgBouncer pool pressure.

**Fix:** Configure Supabase connection pooler settings: increase pool size to 30 (from default 15), enable statement-level pooling for read queries.

**Effort:** 0.5 days (dashboard config)
**Score improvement:** +0.15

**Phase 2 total: 9.0 → 9.5 (+0.5)**

---

## Phase 3: Code Quality (9.0 → 9.5)

### P3.1 — Consolidate Remaining formatCurrency Duplicates
**Problem:** 12 remaining duplicate `formatCurrency` implementations outside the command center (QrmHubPage, PortalInvoicesPage, DgeScenarioPanel, etc.)

**Fix:** Replace all 12 with `import { formatCurrency } from "@/lib/format"`.

**Effort:** 1 hour
**Score improvement:** +0.2

### P3.2 — Error Boundary at Route Level
**Problem:** If a component throws during render, the entire app crashes (white screen). No error boundaries exist at route level.

**Fix:** Wrap each major route in `<ErrorBoundary>` with a "Something went wrong" fallback + retry button. Use React 18's `onError` callback for Sentry capture.

**Effort:** 0.5 days
**Score improvement:** +0.15

### P3.3 — Sanitize parts-identify-photo Error Messages
**Problem:** The P2 security finding — error messages from OpenAI API leak to the client.

**Fix:** Replace `e.message` with a generic "Image analysis failed" message. Log the real error to Sentry.

**Effort:** 15 minutes
**Score improvement:** +0.1 (also improves Security to 9.7+)

### P3.4 — Strict TypeScript Mode Audit
**Problem:** 3 remaining `as any` casts are legitimate but could be eliminated with proper type guards.

**Fix:** Replace `(window as any).AudioContext` with a proper type declaration. Replace dynamic sort key access with a typed comparator.

**Effort:** 1 hour
**Score improvement:** +0.05

**Phase 3 total: 9.0 → 9.5 (+0.5)**

---

## Execution Priority

| Phase | Effort | Score Gain | Priority |
|-------|--------|------------|----------|
| **P1: Performance** | 4 days | +2.5 | 🔴 Do first |
| **P2: Database** | 2 days | +0.5 | 🟡 Do second |
| **P3: Code Quality** | 1 day | +0.5 | 🟢 Do third |
| **Total** | **7 days** | **All 9.5+** | |

---

## Post-9.5 Stretch Goals (9.5 → 10.0)

These push individual categories toward perfection:

| Item | Category | Effort | Impact |
|------|----------|--------|--------|
| E2E test suite (Playwright) | Quality | 5 days | Catches regressions before deploy |
| WCAG 2.1 AA full compliance | UI/UX | 3 days | Screen reader + keyboard nav across all pages |
| Real-time subscriptions | Performance | 2 days | Supabase Realtime for live deal updates |
| Rate limiting on edge functions | Security | 1 day | Prevents abuse on public endpoints |
| Database query plan analysis | Database | 1 day | EXPLAIN ANALYZE on top 10 queries, add missing indexes |
| Storybook for all primitives | Quality | 2 days | Visual regression testing |
| Structured logging (Axiom/Loki) | Performance | 1 day | Replace console.log with structured log pipeline |

---

## Timeline

| Week | Work | Result |
|------|------|--------|
| **Week 1** | P1.1 scope-based queries + P1.2 lazy sections | Performance 7.0 → 9.0 |
| **Week 2** | P1.3-P1.4 + P2.1-P2.3 + P3.1-P3.4 | All categories at 9.5+ |
| **Week 3+** | Stretch goals + Track 3 Intelligence Layer | Push toward 10.0 |

---

*This roadmap is additive to the main QEP OS Master Roadmap. It can run in parallel with Track 3 delivery.*
