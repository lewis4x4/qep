# QEP master roadmap

**As of:** 2026-03-30 (America/New_York)  
**Source of truth for task state:** Paperclip — project **QEP**, goal **CLIENT: QEP USA**  
**This file:** company-wide snapshot; refresh by re-exporting from Paperclip or re-running a CEO roadmap pass.

**Update (same day):** Board 9-phase alignment — **Phase 1 goal** [Phase 1: Core CRM — Replace HubSpot](/QUA/goals/7386b419-7f70-48bd-aaeb-09d2a7d10156); sprint parents [QUA-221](/QUA/issues/QUA-221)–[QUA-225](/QUA/issues/QUA-225) under [QUA-162](/QUA/issues/QUA-162). See [QUA-212](/QUA/issues/QUA-212) closing comment for the full delta.

---

## Where this lives on disk

| Artifact | Path |
|----------|------|
| This roadmap (editable) | `/Users/brianlewis/client-projects/qep/plans/2026-03-30-qep-master-roadmap.md` |
| Application repo | `/Users/brianlewis/client-projects/qep` (workspace cwd) |

---

## Executive snapshot

Three active **program anchors** sit at the top of the QEP project:

| Stream | Ticket | Priority | Status | Notes |
|--------|--------|----------|--------|--------|
| **Deal Genome Engine (DGE)** | [QUA-92](/QUA/issues/QUA-92) | critical | `in_progress` | Sprint 1 delivered; **Sprint 2 build in flight** under [QUA-213](/QUA/issues/QUA-213) (Phase 5A/5B). Program issue stays open for orchestration; see [plan on QUA-92](/QUA/issues/QUA-92#document-plan) when present. |
| **CRM — Phase 1 (HubSpot exit)** | [QUA-162](/QUA/issues/QUA-162) | critical | `in_progress` | **Program umbrella (Option A).** Phase 1 team goal + five sprint children [QUA-221](/QUA/issues/QUA-221)–[QUA-225](/QUA/issues/QUA-225). **Sprint 1** → Product spec. Prior MVP track remains **done** in history ([QUA-187](/QUA/issues/QUA-187)–[QUA-191](/QUA/issues/QUA-191), etc.). Optional: [QUA-215](/QUA/issues/QUA-215) (earlier “post-MVP spec” — reconcile or cancel if redundant with Phase 1 sprints). |
| **Roadmap / board ops** | [QUA-212](/QUA/issues/QUA-212) | medium | `done` | 9-phase Paperclip alignment delivered this heartbeat (see issue thread). |

**Blocked (needs human / external)**

| Ticket | Priority | Blocker |
|--------|----------|---------|
| [QUA-108](/QUA/issues/QUA-108) | medium | Custom domain **qep.blackrockai.co** not wired; site on Netlify URL only. |
| [QUA-3](/QUA/issues/QUA-3) | high | Re-parented under **Phase 1 Sprint 3** [QUA-223](/QUA/issues/QUA-223); still **blocked** on HubSpot API access (Sprint 5 migration dependency). |

**In review (human or agent review queue)**

| Ticket | Priority | Title |
|--------|----------|--------|
| [QUA-91](/QUA/issues/QUA-91) | high | Fly out menu changes |
| [QUA-2](/QUA/issues/QUA-2) | high | Company Knowledge Assistant (Module 1) |
| [QUA-4](/QUA/issues/QUA-4) | medium | Voice-to-CRM field capture (Module 4) |
| [QUA-146](/QUA/issues/QUA-146) | medium | Module 5: DGE |
| [QUA-158](/QUA/issues/QUA-158) | medium | HELP |

**Backlog (deferred)**

| Ticket | Notes |
|--------|--------|
| [QUA-5](/QUA/issues/QUA-5) | Quote builder — IntelliDealer gate; CEO moved to `backlog` per board directive. |

**Next engineering gate (todo)**

| Ticket | Priority | Title |
|--------|----------|--------|
| [QUA-44](/QUA/issues/QUA-44) | high | WS-8: CDO design review, QA validation, Netlify deploy |

**Backlog (low)**

| Ticket | Title |
|--------|--------|
| [QUA-139](/QUA/issues/QUA-139) | Hire HR Manager agent |
| [QUA-83](/QUA/issues/QUA-83) | DSN tooltip overlap 375px |

---

## How the streams relate

1. **DGE ([QUA-92](/QUA/issues/QUA-92))** — Long-horizon platform: integration hub, data model, security and design gates, simulation/QA cycles. Much of Sprint 1 vertical slice is complete in the issue graph; remaining work is “what’s next sprint” plus any **open** children you add under the program issue.
2. **CRM ([QUA-162](/QUA/issues/QUA-162))** — QEP CRM / HubSpot-aligned build. Parallel blueprint path and implementation kickoff tasks show **done**; next phase should be explicit new children under [QUA-162](/QUA/issues/QUA-162) (or a new program ticket) so the board sees clear `todo`/`in_progress` work.
3. **Product modules ([QUA-2](/QUA/issues/QUA-2), [QUA-4](/QUA/issues/QUA-4), [QUA-5](/QUA/issues/QUA-5), [QUA-146](/QUA/issues/QUA-146))** — Shipped or in review under the original module breakdown; blocked items ([QUA-3](/QUA/issues/QUA-3)) stay blocked until dependencies clear.

---

## Suggested board focus (next 7 days)

1. **Unblock** [QUA-108](/QUA/issues/QUA-108) (DNS) so customer-facing URL matches brand.
2. **Close or extend** [QUA-162](/QUA/issues/QUA-162): either mark program complete with a closing comment or add the next CRM slice as visible children.
3. **Drain** `in_review` queue ([QUA-91](/QUA/issues/QUA-91), [QUA-2](/QUA/issues/QUA-2), [QUA-4](/QUA/issues/QUA-4), [QUA-5](/QUA/issues/QUA-5), [QUA-146](/QUA/issues/QUA-146), [QUA-158](/QUA/issues/QUA-158)) so WIP does not stall.
4. **Run** [QUA-44](/QUA/issues/QUA-44) when engineering dependencies are satisfied (WS-8 CDO + QA + deploy).

---

## Rolling updates

When priorities shift, either:

- Update this file in `plans/` with a new dated copy (e.g. `2026-MM-DD-qep-master-roadmap.md`), **or**
- Rely on Paperclip filters: project QEP, status `todo,in_progress,blocked,in_review`.

---

*Generated by CEO agent heartbeat; task identifiers use company prefix **QUA** for in-app links.*
