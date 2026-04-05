# Parts service — §15 pressure matrix (handoff alignment)

Maps handoff §15-style scenarios to automated checks, manual/SQL follow-ups, or documented gaps.

| §15 scenario | Planned coverage |
|--------------|------------------|
| Machine-down urgency | **Automated:** `service-parts-planner` JSON includes `is_machine_down`; pressure script greps/asserts response shape in code paths. |
| Partial stock | Planner + inventory heuristic (`parts_inventory` stock-first); **doc** + optional live assert when DB credentials present. |
| Wrong vendor ETA | Vendor escalator / `vendor_profiles.avg_lead_time_hours`; **document gap** — no dedicated automated assert yet. |
| Portal order + internal job collision | Same `fulfillment_run_id` on job + portal order allowed; **manual/SQL:** verify two `service_jobs` or job + `parts_orders` can share a run; no unique constraint today. |
| Internal billing routes | **P2 / not built** — skip automated; document only. |
| Completed but uninvoiced | **P2** — service invoice path; skip or spot-check `invoice_ready` / billing flags when that surface exists. |
| Notification dedupe | **Doc:** current behavior in `portal-api` / notify edges; recommend unique constraint on idempotent notification keys as follow-up. |
| Branch-scoped routing | **Checklist:** `profile_workspaces` + `get_my_workspace()` + `portalWorkspaceId` patterns; grep/review in pressure script + code review. |

## Running checks

- Always (no secrets): `bun run pressure:parts` — filesystem, `migrations:check`, grep guards.
- Optional live DB: set `SUPABASE_SERVICE_ROLE_KEY` and a project URL (`SUPABASE_URL`, or `VITE_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` from app env files). Script probes `parts_fulfillment_events`; if that returns 404 (migrations not on remote), it falls back to `profiles` and still passes with a note. Prints `SKIP` and exits 0 if URL or service key unset.
