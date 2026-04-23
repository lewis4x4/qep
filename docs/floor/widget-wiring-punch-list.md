# The Floor — Widget Wiring Punch List

**Status as of 2026-04-23:**

- ✅ **Shipped Week 1:** `exec.owner-brief` (10-min direct wrap) and
  `nervous.customer-health` (new list wrapper). Ryan's Owner Floor now
  renders 3 real widgets + 1 stub (up from 2 real + 2 stubs).
- 🔁 **Pivoted away from Week 1:** `exec.morning-brief`. On inspection
  the existing `AdvisorMorningBriefingCard` is the SLA+leads card
  already in use by `qrm.advisor-brief`, not an overnight narrative.
  A real morning briefing needs the queued `floor-narrative` edge fn
  to mean anything distinct — re-queued for a later slice once that
  edge fn lands.
- ⏳ **Remaining:** `parts.serial-first` (#1), `sales.commission-to-date`
  (#2), `parts.quote-drafts` (#4).



**Context:** The Floor shell is live at `/floor` on production
(`qualityequipmentparts.netlify.app`). Of the 29 widget ids registered in
`floor-widget-registry.tsx`, **14 render real data** (reused directly from
the pre-existing Iron dashboard registry) and **15 render branded
"Preview" stubs**. This file ranks the top 5 stubs to wire first, with
per-widget implementation briefs so any engineer can pick one up cold.

**Prioritization lens:** highest-impact-per-hour against the QEP team's
adoption curve. Juan (Parts) and Rylee (Sales Manager) are the two
heaviest adopters; their Floors should be the most real, the soonest.

---

## Ranking summary

| # | Widget id | Role | Effort | Unlock | Status |
|---|---|---|---|---|---|
| 1 | `parts.serial-first` | iron_parts_counter | **M** | Juan's Floor becomes functional, not cosmetic | ⏳ pending |
| 2 | `sales.commission-to-date` | iron_advisor, iron_manager | **M** | Sales adoption lever (per handoff §7, "make-or-break") | ⏳ pending QA-R2 |
| 3 | `exec.morning-brief` | iron_manager, iron_advisor, iron_owner | ~~**S**~~ **M** | "AI Briefing" rename (C6) lands with substance for three roles | 🔁 deferred — needs narrative edge fn |
| 4 | `parts.quote-drafts` | iron_parts_counter, iron_parts_manager | **M** | Pairs with #1 — counter gets lookup + drafts on one surface | ⏳ pending QA-N1 |
| 5 | `nervous.customer-health` | iron_manager, iron_owner | **S** | Ryan's Owner Floor goes from 2 real / 2 stubs → 3 real / 1 stub | ✅ shipped |
| + | `exec.owner-brief` | iron_owner, iron_manager | **XS** | Zero-prop wrap of OwnerBriefCard — fastest unlock for Ryan | ✅ shipped |

**Effort legend:** S ≤ 2 hours (wraps existing component), M ≤ 4 hours
(new component + data query), L > 4 hours (new schema + component).

---

## 1 — `parts.serial-first`

**Role slot:** Juan's Floor hero (wide tile). Currently a stub card that
reads "Paste or scan a serial — we'll find the machine and owner."

**Why first:** Juan's entire Floor is 5 stubs. Until `parts.serial-first`
is real, his `/floor` surface is literally non-functional — he can log
in, but every quick action leads somewhere and every widget says
"Preview." Wiring this one widget plus quick-action #1 (`new_parts_quote`
route already lands on `/parts/new`) makes the parts-counter experience
useful on first load.

**Build plan:**

1. New component: `apps/web/src/features/floor/widgets/SerialFirstCard.tsx`
2. Single large input with autofocus. On every keystroke, progressively
   filter `equipment` by serial via an RPC already in the repo —
   `qb_search_equipment_fuzzy` (migration 298) can be leveraged or
   a new `parts_lookup_by_serial` RPC added.
3. On match: render a 3-line result — machine name, current owner,
   latest part order date + ticket button.
4. On miss: fall-through link to full catalog at `/parts/catalog`.
5. Empty state: the existing stub copy, unchanged.
6. Replace `stub()` call in `floor-widget-registry.tsx` entry with the
   real component.

**ADR-004 alignment:** This IS the ADR-004 surface ("Serial Number Is the
Primary Entry Point for Parts"). Wiring this widget is a down payment
on that ADR; the full `/parts/command` page (C7) remains a separate slice.

**Effort:** M. ~3 hours including RPC if the existing fuzzy search needs
an alias.

---

## 2 — `sales.commission-to-date`

**Role slot:** iron_advisor (default layout) and iron_manager (default
layout, as an aggregate view). Currently a stub showing "$14,250 booked
· $8,900 in flight."

**Why:** The handoff is explicit — "Commissions are the make-or-break
adoption lever for sales. Sales reps do not trust a new system until
they can verify commission." (§7, adoption constraints). Without this
widget rendering real numbers, David (and any rep who comes after) has
no behavioral reason to check the Floor.

**Build plan:**

1. **Prerequisite:** QA-R2 session with Rylee (commission structure deep
   dive). The calculation rules aren't in the schema yet. Layered logic
   per the handoff includes base %, manufacturer SPIFFs, margin-tier
   overrides, trade-in impact, finance reserve splits. **Do NOT wire
   the widget against guesses** — run QA-R2 first.
2. New migration: `commission_rules` (per-workspace, versioned),
   `commission_ledger` (per-deal, per-rep, computed).
3. New RPC: `compute_commission_to_date(p_user_id uuid, p_period text)`
   returning `{ bookedCents, inFlightCents, periodStart, periodEnd }`.
4. Component: `apps/web/src/features/floor/widgets/CommissionToDateCard.tsx`
   — hero number (booked, Montserrat 48pt) + sub-number (in-flight,
   Inter 14pt) + tiny sparkline of prior 6 months (optional polish).

**Effort:** M on the widget once QA-R2 lands. Expect **L** total
including the schema + RPC.

---

## 3 — `exec.morning-brief`

**Role slot:** Wide tile for iron_manager + iron_advisor + iron_owner
Floors. Currently stubbed as "Overnight changes across your pipeline
surfaced as actions."

**Why:** The handoff's C6 commitment is "Rename Morning Briefing to AI
Briefing with on-demand refresh." The existing
`AdvisorMorningBriefingCard` (`features/dashboards/components/`) already
does the work — it's in the legacy Iron dashboard. Wrapping it for the
Floor is a **1-hour lift** that instantly makes three roles' Floors
feel alive.

**Build plan:**

1. In `floor-widget-registry.tsx`, replace the stub for
   `exec.morning-brief` with a direct component import:

   ```ts
   import { AdvisorMorningBriefingCard } from
     "@/features/dashboards/components/AdvisorMorningBriefingCard";

   "exec.morning-brief": {
     ...existing metadata,
     component: AdvisorMorningBriefingCard,
   },
   ```

2. The existing component may need a wrapper to present it inside the
   Floor's branded frame (charcoal + orange vs. whatever chrome it
   currently has). If it already uses the shared `Card` primitive,
   it'll look right on the Floor with no change.
3. **Check the refresh behavior.** The handoff calls for on-demand
   refresh — if the underlying hook only polls on mount, add a refresh
   button to the Floor's widget frame that re-triggers `queryClient.
   invalidateQueries(['briefing'])`.

**Effort:** S. 1–2 hours.

---

## 4 — `parts.quote-drafts`

**Role slot:** iron_parts_counter (normal tile). Pairs with widget #1.

**Why:** The handoff's C8 ("Implement auto-save + drafts section across
parts, sales, service") requires this surface exist. And the transcript
is explicit — Juan said "save the drafts. Let's say that I'm in the
middle of doing a stock order... it'll save it. Maybe we have, like, a
little section where it's, like, hey. You left this unfinished."

**Build plan:**

1. **Schema check:** a `parts_quote_drafts` table may already exist
   (likely not — parts quoting hasn't been built yet). If absent,
   migration 375 adds `parts_quote_drafts (id, workspace_id, author_user_id,
   customer_id, equipment_serial, line_items jsonb, draft_state text
   check in ('open', 'processing', 'follow_up'), auto_saved_at)`.
2. Component: renders up to 3 most-recent drafts for `auth.uid()` with
   customer name, machine serial, line-item count, and last-saved
   relative time. Click → opens `/parts/drafts/{id}`.
3. Empty state: "No drafts. You'll see resumable work here when you
   walk away mid-quote."

**Effort:** M. ~3 hours if schema is net-new.

**Dependency:** Sprint 1D prerequisite (QA-N1 parts workflow capture
with Norman) could sharpen this.

---

## 5 — `nervous.customer-health`

**Role slot:** iron_manager + iron_owner (normal tile).

**Why:** Ryan's Owner Floor is currently 2 real (`iron.inventory-aging`,
`iron.approval-queue`) and 2 stubs (`exec.owner-brief`,
`nervous.customer-health`). Wrapping the existing
`CustomerHealthScore` component
(`features/nervous-system/components/CustomerHealthScore.tsx`) is the
fastest way to elevate Ryan's Floor from "1 signal working" to "3 of 4
working" — a visible jump for the Ryan-UI walkthrough (QA-R1) without
new schema.

**Build plan:**

1. Inspect `CustomerHealthScore` props. If it takes a single customer id
   (likely), write a wrapper that shows the top 5 *at-risk* customers
   (score < 50 or trending down) based on the existing scoring fn
   from the nervous-system feature.
2. Component: `apps/web/src/features/floor/widgets/CustomerHealthListWidget.tsx`
   — list of 5 rows, each customer name + score + direction arrow.
3. Click row → opens `/qrm/companies/{id}` or the existing health
   drawer.

**Effort:** S. 1–2 hours for the wrapper + list query. Depends on how
the existing nervous-system feature exposes a "list by score"
query — may require a small helper export.

---

## Sequencing recommendation

```
Week 1
├── #3 exec.morning-brief           (1-2h)   — quick win, 3 roles lit up
└── #5 nervous.customer-health       (1-2h)   — Ryan-ready for QA-R1

Week 2
└── #1 parts.serial-first            (3h)     — Juan's Floor becomes real

Week 3 (post-QA-R2, post-QA-N1)
├── #2 sales.commission-to-date      (Lshaped — schema + widget)
└── #4 parts.quote-drafts            (3-4h)
```

Wiring #3 and #5 first buys the biggest "it feels live" perception jump
at the lowest cost. #1 is a week-2 push because it rightly belongs
after a brief Norman + Juan workflow capture so the serial search
behaves the way counter staff expect. #2 and #4 need external
prerequisites (QA-R2 for commission rules, QA-N1 for parts pricing
ruleset).

---

## Out of scope for this punch list

- **The other 10 stubs.** They render correctly as Previews today; Brian
  can keep composing against them. They're queued as follow-ups behind
  these 5.
- **Command palette (⌘K).** Explicit deferral per
  `docs/floor/visual-language.md` §14.
- **Quick-action editing in the composer.** Read-only v1; separate slice.

---

## Related anti-pattern finding (surfaced during verification)

During Step 5 prep, I queried the `profiles` table to find admin emails.
One row violates the handoff's **anti-`Riley` rule** (§11):

```
  riley@qepusa.com   (role=owner, iron_role=iron_manager, floor_mode=false)
```

The handoff is explicit: "It is `Rylee`, not `Riley`. There is no `Riley`."
This profile appears to be a misspelled duplicate (the correct one is
`rylee@qepusa.com`, which also exists). Recommend:

```sql
-- Audit first:
select id, email, full_name, created_at, active_workspace_id
  from public.profiles
 where email ilike 'riley@qepusa.com';

-- If it's a stray dupe, soft-disable:
update public.profiles
   set is_active = false
 where email = 'riley@qepusa.com';

-- Then verify no auth.users row remains active:
delete from auth.users where email = 'riley@qepusa.com';
```

Not doing this silently — it's a judgment call. Flagging for your
decision.
