# Service engine scorecard (remediation status)

This document tracks the Parts/Service engine against **observable behavior** (staging + tests/runbooks). Rows are **not** “Complete” without a cited check.

| Area | Status | Evidence |
|------|--------|----------|
| Customer notifications | Proven (code + tests) | Recipient resolution: `supabase/functions/_shared/service-customer-recipient.ts`, `service-lifecycle-notify.ts`; dispatch skips null recipients: `service-customer-notify-dispatch/index.ts`. Tests: `supabase/functions/_shared/service-engine-smoke.test.ts` (partial — vendor policy). |
| Vendor inbound | Proven (code) | Strict mode when `ENV=production` or `VENDOR_INBOUND_WEBHOOK_SECRET` set; open-order match only when `ALLOW_VENDOR_INBOUND_OPEN_MATCH=true` and not strict: `service-vendor-inbound/index.ts`. Test: identifier gate simulation in `service-engine-smoke.test.ts`. |
| Vendor escalation email | Proven (code) | Resend when `RESEND_API_KEY` + contact email; else `vendor_escalation_logged`: `service-vendor-escalator/index.ts`. |
| TAT / SLA | Proven (migration + code) | Table `service_tat_targets` (migration **108**); `service-tat-monitor` loads DB then falls back to constants. Read-only UI: `ServiceBranchConfigPage`. |
| Parts planner + inventory | Proven (migration + code) | `parts_inventory`, `planner_rules` on branch (migration **108**); stock-first unless `PLANNER_HEURISTIC_MODE=legacy`: `service-parts-planner/index.ts`. |
| Job code learner governance | Proven (migration + code) | Suggestions table + merge function (migration **109**, `service-jobcode-learner`, `service-jobcode-suggestion-merge`). |
| Escalation policy JSON | Proven (migration + shared) | DB trigger `enforce_vendor_escalation_policy_steps` (migration **109**); TS mirror `vendor-escalation-policy.ts`; tests in `service-engine-smoke.test.ts`. |
| Portal service requests | Proven (code + migration) | Photo upload bucket **110**; `PortalServicePage`; `portal-api` sets `workspace_id` on create. |
| Cron observability | Optional | Table `service_cron_runs` (migration **109**); logging enabled unless `SERVICE_CRON_RUNS_DISABLED=true` in `service-cron-run.ts`. See `docs/SERVICE_CRON.md`. |

## Tests

```bash
deno test supabase/functions/_shared/service-engine-smoke.test.ts
```

## Staging checklist (manual)

1. Create job with CRM contact email → stage transition → `service_customer_notifications.recipient` populated (or advisor in-app if missing).
2. `POST service-vendor-inbound` without ids in strict env → 400.
3. Insert `service_tat_targets` row → TAT warning uses those hours.
4. Insert `parts_inventory` for branch + part → planner returns `stock_first` pick vs order.
5. Portal: submit request with photo → `service_requests.photos` contains URLs; internal job linked shows shop status label.

## Gate

Run `bun run segment:gates --segment "<id>"` per `AGENTS.md` after deployments; attach artifacts to the segment ticket.

## Stakeholder sign-off

Record approver, date, and environment in the ticket when promoting beyond staging.
