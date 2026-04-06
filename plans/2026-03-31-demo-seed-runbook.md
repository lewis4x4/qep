# QEP Thursday demo seed runbook

## Why this exists

The Thursday, April 2, 2026 demo should not wait for full CRM completion. It needs realistic data on the surfaces that already exist and are stable enough to show well:

- contacts and companies
- hierarchy and equipment registry
- duplicate review
- pipeline and deal detail
- activity timelines and unified inbox
- communication templates
- quote linkage
- one DGE-linked customer profile

This seed pack is intentionally scoped to those flows. It does not fake unfinished phases.

It now also covers the Phase 1 admin/operator story needed to show Sprint 1 through Sprint 4 together:

- integration hub status cards
- HubSpot import run history and reconciliation detail
- parallel-run / cutover controls in the HubSpot drawer
- closed won / closed lost examples for pipeline and deal-detail review

## Data strategy

- Workspace target: `default`
- Seed type: deterministic and disposable
- Cleanup mode: fixed-id reset plus demo auth-user deletion
- Realism: believable heavy-equipment dealership records with no real client/customer PII

## Commands

```bash
cd /Users/brianlewis/client-projects/qep
bun run demo:plan
```

Recommended for the Netlify demo target:

```bash
cd /Users/brianlewis/client-projects/qep
cp .env.demo.example .env.demo.local
# fill in the real staging SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
bun run demo:reseed
```

```bash
cd /Users/brianlewis/client-projects/qep
SUPABASE_URL="https://<project>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
bun run demo:seed
```

```bash
cd /Users/brianlewis/client-projects/qep
SUPABASE_URL="https://<project>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
bun run demo:reset
```

```bash
cd /Users/brianlewis/client-projects/qep
SUPABASE_URL="https://<project>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
bun run demo:reseed
```

## Optional overrides

```bash
QEP_DEMO_WORKSPACE_ID="default"
QEP_DEMO_PASSWORD="<set-in-env-or-.env.demo.local>"
```

Credential resolution order:

1. shell exports
2. `.env.demo.local`
3. `.env.local`
4. `.env`
5. `supabase status -o env` from a running local Supabase environment

For the Netlify demo, use `.env.demo.local` with the staging Supabase project credentials. The Netlify URL itself is not enough; the seed script writes directly to the backing Supabase database.

## Demo accounts created

- `demo.owner@qep-demo.local`
- `demo.manager@qep-demo.local`
- `demo.rep@qep-demo.local`
- `demo.rep2@qep-demo.local`

Default password:

```text
QepDemo!2026
```

## Seeded story

- A parent/child forestry account structure
- A municipal/utility clearing account
- A rental fleet account
- One duplicate-contact queue item
- One negotiation-stage loader deal
- One demo-scheduled chipper deal
- One quote-working tracked-machine deal
- One discovery-stage rental/fleet deal
- One closed-won machine package
- One closed-lost municipal replacement with loss reason + competitor
- Failed, manual, sent, overdue, and completed activities in the timeline/inbox
- A linked quote for CRM handoff
- One DGE-linked customer profile to support the AI-native story
- Integration Hub cards spanning connected, demo, pending, and error states
- Two HubSpot import runs plus reconciliation error rows
- HubSpot cutover package state with a seeded final handoff call and owner-facing note

## What is intentionally not seeded

- production credentials or live communication sends
- parts/service/rental ops phase data beyond what current CRM surfaces need
- full HubSpot OAuth connection material or real portal credentials
- real customer names, real phones, or real emails

Note:

- Integration Hub demo rows are non-destructive. The seed only takes over integration rows that are blank or already owned by this demo batch.
- `demo:reset` only unwinds integration rows marked with this demo batch id.
