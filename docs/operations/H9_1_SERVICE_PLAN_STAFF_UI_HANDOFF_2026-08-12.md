# H9.1 Service-Plan Staff UI Handoff — 2026-08-12

## Outcome

H9.1 is complete in source control on top of migration 829. The staff-facing service surface now provides catalog review, separately guarded activation, agreement-equipment enrollment, cadence and entitlement visibility, and generated-PM prompt handling.

## Delivered workflow

- `/service/plans` lists provisional, reviewed, active, and inactive programs with their hour/calendar intervals.
- Elevated QEP operators can record required review notes. The page displays the immutable recorded evidence and does not offer an invalid re-review action for an already-reviewed program.
- Activation is a separate action and remains disabled unless the program is non-provisional, has at least one active interval, and has reviewer, timestamp, and non-empty notes evidence.
- `/service/agreements/:agreementId` binds a catalog program and enrolls its covered machine through `service_plan_enroll_equipment` only after reviewed, active, non-provisional evidence resolves.
- Enrollment shows baseline provenance, hour/calendar due anchors, entitlement availability/reservations/consumption, and guarded pause/resume/end controls.
- The PM prompt inbox opens the generated work order, clears it from the scheduling inbox once `scheduled_start_at` is recorded, and requires a reason before calling `service_plan_cancel_pm_due_event`; it never edits append-only prompt or ledger rows directly.

## Safeguards preserved

- Migration 829 remains authoritative. Its inactive BlackRock draft rows are not reviewed or activated by this segment.
- Review and activation remain separate database writes; activation cannot use a same-write boolean bypass.
- Unknown or still-loading program evidence fails closed in enrollment readiness.
- Program binding is disabled for non-elevated roles and once an enrollment exists.
- Agreement insert/update RLS is restricted to authenticated admin, manager, and owner roles in the active workspace; reps retain read-only service visibility.
- OEM/model applicability, kits, labor, pricing, and commercial terms are not inferred or invented by the UI.

## Focused regression evidence

- `service-plan-utils.test.ts`: activation evidence, provisional/draft blocking, unresolved-program enrollment blocking, normalization, role gates, and baseline parsing.
- `ServicePlansPage.integration.test.tsx`: inactive draft disclosure, disabled activation, review notes, reviewed activation, prompt rendering, and reason-bearing controlled cancellation.
- `ServiceAgreementDetailPage.integration.test.tsx`: reviewed active program enrollment through the migration 829 RPC adapter.
- `829_service_plan_pm_automation_and_entitlement_ledger.test.ts`: 13 static database-contract tests, including inactive seeds, prior-review activation, enrollment, idempotent scanning, append-only prompts, cancellation, and entitlements.
- `835_h91_service_plan_staff_ui_closeout.test.ts`: roadmap closeout and UI safety-contract coverage.

## Required segment gates

`bun run segment:gates --segment "H9.1-service-plans-ui" --ui` passed all 15 checks. The final artifact is `test-results/agent-gates/20260812T210715Z-H9.1-service-plans-ui.json`; authenticated design evidence is in `test-results/design-review/service-plans-desktop.png` and `test-results/design-review/service-plans-mobile.png`.

The integrated release gate is `test-results/agent-gates/20260812T211957Z-H9.1-service-plans-ui-release.json`: source release is `GO`; remote deployment is `NO_GO` until the linked Supabase project's remote-only timestamp migration history is reconciled.

## Mission alignment

**PASS.** Reviewed preventive-maintenance intent can now become auditable machine enrollment, due work, and entitlement truth for service staff. Provisional source assumptions stay blocked from customer-live use, so the workflow improves equipment uptime without fabricating OEM or commercial facts.

## Remaining operational boundary

QEP service leadership must validate OEM/model fit, kit, labor, and commercial terms before recording review notes for any provisional program. Each generated PM job still requires an operator to schedule, complete, or cancel it; that is the intended human control point, not unfinished software.
