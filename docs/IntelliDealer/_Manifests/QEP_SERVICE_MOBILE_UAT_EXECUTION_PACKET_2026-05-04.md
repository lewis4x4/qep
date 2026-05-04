# QEP Service Mobile UAT Execution Packet

Date: 2026-05-04  
Roadmap slice: Slice 10 — Service Mobile Technician UAT  
Workbook row: Gap Register — `Service Mobile Web UI not production-validated for technicians`  
Current workbook status: `PARTIAL`  
Surface: `/m/service`

## Objective

Collect real technician acceptance evidence for the shipped Service Mobile workflow. This packet turns the existing checklist and result template into a concrete execution request.

This packet does not close the workbook row by itself. The row remains `PARTIAL` until the completed result evidence exists and any blockers are fixed or waived.

## Required Evidence

Use the existing artifacts:

- `QEP-Phase-4-Service-Mobile-UAT-Checklist-20260422.md`
- `QEP-Phase-4-Service-Mobile-UAT-Operator-Guide-20260422.md`
- `QEP-Phase-4-Service-Mobile-UAT-Result-Template-20260422.md`

Required completion evidence:

- named technician
- reviewer or observer
- device model
- browser
- branch/location
- production account used
- normal network result
- degraded/intermittent network result
- at least one assigned job opened
- at least one work-order detail reviewed
- at least one valid stage transition executed
- persistence confirmed from the main service surface
- screenshots/video or equivalent field proof, if source-control-safe
- explicit pass/fail result
- blocking issue disposition

## UAT Run Request

1. Schedule a 30-minute production mobile UAT session with a real service technician.
2. Open `/m/service` on the technician's actual phone.
3. Execute the checklist under normal network conditions.
4. Repeat the stage-transition and persistence portion under degraded/intermittent network conditions.
5. Fill out the result template during the session, not from memory later.
6. Attach proof that is safe to store in the repo or record where the proof is stored if it contains customer-sensitive data.
7. If the result is `PASS`, update the workbook row from `PARTIAL` to `BUILT` with the completed-result artifact cited.
8. If the result is `FAIL`, keep the workbook row `PARTIAL`, create repair tasks for blockers, and record whether non-blocking issues are follow-up work.

## Pass Criteria

The workbook row may close only when:

- technician verdict is `PASS`
- manager/reviewer signoff is present
- no blocking issues remain unresolved
- any waivers include owner, reason, expiration, and remediation link

## Current Status

Queued for external field UAT. No workbook status promotion yet.
