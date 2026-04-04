# CODEX.md - QEP OS Runtime Mission Anchor

This file is the runtime contract for all QEP OS engineering execution.

## Mission Statement (Non-Negotiable)

> "Create a Moonshot Application That is built around an equipment and parts, sales and rental For the employees, salesman, company corporate operations and management. Your sole function is to identify, design, and pressure-test transformational AI application ideas that are not fully possible today but will be unlocked by superintelligence."

## Moonshot Standard

We don't settle for anything less than exceptional. If it has not been done before, that's what we strive for. Every feature must push beyond what exists in the market. No shortcuts. The foundation determines everything — we build it right or we build it twice.

## Canonical Build Contract

The master build roadmap lives at:

- **`QEP-OS-Build-Roadmap-LLM.md`** — the single source of truth for all implementation specs, data structures, acceptance criteria, and phase sequencing. Derived from ownership SOPs on April 3, 2026.

All engineering decisions, schema designs, edge function contracts, and UI behavior must trace back to this document. If the roadmap doesn't specify it, confirm with ownership before building.

## Phase Execution Order

| Phase | Name | Priority | Status |
|-------|------|----------|--------|
| Pre-Build | Critical Bug Fixes (3 CRITICAL + 2 HIGH) | BLOCKER | **COMPLETE** |
| 1 | Sales Pipeline Foundation & Voice-First QRM | CRITICAL | **COMPLETE** |
| 2 | Field Operations & Revenue Engine | HIGH | **COMPLETE** |
| 3 | Operational Intelligence & Logistics | HIGH | **COMPLETE** |
| 4 | Deal Genome Engine & Predictive Intelligence | HIGH | **COMPLETE** |
| 5 | Customer Portal & Autonomous Operations | MEDIUM | **NEXT** |

Phases execute sequentially. No phase starts until the prior phase passes all acceptance criteria.

## Mission Gate (Apply to Every Change)

Every feature must pass ALL four gates before it ships:

1. **Mission Fit** — Advances equipment/parts sales+rental operations for field reps, employees, corporate operations, or management.
2. **Transformation** — Creates capability materially beyond commodity CRM/QRM behavior.
3. **Pressure Test** — Validated under realistic usage, edge cases, and failure modes before closure.
4. **Operator Utility** — Improves decision speed or execution quality for at least one real dealership role.

If a change does not pass all four gates, it does not ship.

## Glossary (Use These Terms Everywhere)

| Term | Meaning |
|------|---------|
| **QRM** | Quality Relationship Manager — the CRM system. Always use "QRM" not "CRM" in UI, docs, and user-facing strings. Internal code retains `crm_` prefixes on existing tables/functions. |
| **Iron Manager** | Manager role. Pipeline oversight, approvals, pricing authority, forecasting, KPI enforcement. System role: `manager`. |
| **Iron Advisor** | Field sales rep. Owns customer relationships end-to-end, 10 calls/visits per day, 15-min lead response SLA. System role: `rep`. |
| **Iron Woman** | Sales admin. Order processing, credit apps, deposits, invoicing, warranty, inventory management. System role: `admin`. |
| **Iron Man** | Sales support tech. Equipment prep, PDI, inspections, demo setup, rental returns, attachment installs. System role: `rep` with `is_support = true`. |
| **IntelliDealer** | Existing DMS (Dealer Management System). External dependency. API status: unconfirmed. All features must work without it (zero-blocking). |
| **PDI** | Pre-Delivery Inspection. OEM-required checklist before equipment is sale-ready. |
| **Traffic Ticket** | Internal logistics request for moving equipment. No equipment moves without one. |
| **DGE** | Deal Genome Engine. 14-variable deal optimization system. |

## Execution Rules

1. Before implementing or approving any segment, verify mission gate (all 4 checks).
2. The change must be transformational — not commodity-only.
3. Pressure-tested under realistic conditions before closure.
4. Zero-blocking integration architecture: missing external credentials fall back safely.
5. Role and workspace security enforced in both API logic and database policy.
6. No secrets in frontend code or committed files.
7. Mobile-first UX quality required for all operator-facing surfaces.

## Schema Conventions (Verified)

- `crm_deal_stages.sort_order` (integer) — NOT `display_order`
- `crm_deal_stages.probability` — 0-100 scale (NOT 0-1), CHECK `(probability >= 0 AND probability <= 100)`
- All new tables: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`
- `deleted_at timestamptz` for soft-delete where applicable
- RLS required on every user-facing table using `get_my_role()` and `get_my_workspace()`
- Indexes with explicit purpose; no unbounded scans on list views
- Migration naming: `NNN_snake_case_name.sql` (3-digit prefix, next after 080)

## Edge Function Conventions

- Validate auth before business logic
- Return typed JSON; never leak internals
- Enforce role/workspace checks for admin and integration operations
- Keep idempotency for all mutation paths
- Use `safeCorsHeaders()` from `_shared/` for CORS handling

## Frontend Conventions

- Keep existing app shell, navigation, shadcn/ui + Radix primitives
- Dark mode only with QEP Orange accents
- Mobile-first responsive design
- Feature-local API adapters
- Explicit loading, error, and empty states on every view
- State management: React hooks + React Query (no Redux/Zustand)
- Routing: React Router v6 with role-based guards

## Build Gates (Required Before Closing Any Slice)

1. `bun run build` from repo root
2. `bun run build` in `apps/web`
3. `deno check supabase/functions/*/index.ts` on touched functions
4. RLS verification on all touched tables
5. Role/workspace security check on all modified flows
6. Agent gate chain: `bun run segment:gates --segment "<segment-id>"`

## See Also

- `QEP-OS-Build-Roadmap-LLM.md` — canonical implementation contract
- `CLAUDE.md` — repo-level engineering contract
- `AGENTS.md` — agent operating system and gate chain
- `docs/mission-statement.md` — mission decision filter
