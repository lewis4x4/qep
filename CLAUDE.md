# CLAUDE.md - QEP Engineering Contract

This file is the repo-level implementation contract for QEP OS work.

## Mission Lock (Mandatory)

All product, engineering, design, and QA decisions must be vetted against this mission statement:

> "Create a Moonshot Application That is built around an equipment and parts, sales and rental For the employees, salesman, company corporate operations and management. Your sole function is to identify, design, and pressure-test transformational AI application ideas that are not fully possible today but will be unlocked by superintelligence."

If a change does not directly strengthen this mission, it does not ship.

Required mission checks for every segment:

1. `Mission Fit`: The segment advances equipment/parts sales+rental operations for field reps, employees, corporate operations, and management.
2. `Transformation`: The segment includes or enables a capability that is materially beyond commodity QRM behavior.
3. `Pressure Test`: The segment is validated under realistic usage, edge cases, and failure modes before closure.
4. `Operator Utility`: The segment improves decision speed or execution quality for at least one real dealership role.

## Scope

- Repository: `/Users/brianlewis/client-projects/qep`
- Product track: QEP OS, with active parallel streams:
  - QRM Phase 1 (HubSpot replacement)
  - DGE Sprint 2 stabilization

## Non-Negotiables

- No architecture reset. Build from the current in-flight baseline.
- Zero-blocking integration architecture: missing external credentials must fall back safely and keep workflows usable.
- Role and workspace security must be enforced in both API logic and database policy.
- No secrets in frontend code or committed files.
- Mobile-first UX quality is required for all operator-facing surfaces.

## Backend Conventions

- All new tables:
  - `id uuid primary key default gen_random_uuid()`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`
  - `deleted_at timestamptz` for soft-delete where applicable
- RLS is required on every user-facing table.
- Use helper role/workspace functions (`get_my_role()`, `get_my_workspace()`) in policies.
- Add indexes with explicit purpose and avoid unbounded table scans on QRM list views.
- New migrations must follow canonical sequence naming:
  - `NNN_snake_case_name.sql` (3-digit prefix, no gaps)

## Edge Function Conventions

- Validate auth before business logic.
- Return typed JSON responses; avoid leaking internals.
- Enforce role/workspace checks for admin and integration operations.
- Keep idempotency and auditability for QRM import/sync paths.
- For integration flows, preserve explicit live/demo/manual-safe status output.

## Frontend Conventions

- Keep existing app shell, navigation, and UI primitives.
- Prefer feature-local API adapters for QRM behavior.
- Mutation-heavy workflows should go through QRM router contracts.
- Keep loading, error, and empty states explicit in every operator workflow.

## Build and Release Gates

Required before closing a delivery slice:

1. `bun run migrations:check`
2. `bun run build` from repo root
3. `bun run build` in `apps/web`
4. Edge function and contract tests for touched surfaces
5. Role/workspace security checks for modified flows

## Working Rules

- Preserve existing in-flight changes unless explicitly directed otherwise.
- Do not introduce breaking API shape changes without documenting them in sprint tickets.
- Keep implementation and ticket state aligned (QUA sprint parents and children).

## Execution Cadence

- After every green delivery slice, continue directly into the next highest-value roadmap item without waiting for another user prompt.
- The default operating mode is autonomous execution, not status-only reporting.
- Only pause for user input when blocked by:
  - a real external dependency,
  - an irreversible or destructive decision,
  - or a product ambiguity that cannot be resolved from repo context.
- Status updates are not stopping points. Commit, push, report, and continue unless one of the blockers above is present.
