# People Operations Lab — Implementation Roadmap

> **Status:** Pre-approval — roadmap ready for execution if the deal closes.
> **Module:** People Operations Lab
> **Family:** QEP OS Showcase Module Family
> **Owner:** Brian Lewis
> **Created:** April 2026

---

## Executive Summary

People Operations Lab is the future people-operations layer for QEP OS. It is not an HR portal, a handbook viewer, or an employee file cabinet. It is operational infrastructure that helps QEP onboard people faster, answer policy questions instantly, deliver training by role, track acknowledgments and compliance, route employee issues correctly, support managers without creating bureaucracy, and preserve company culture as the business grows.

The goal is not to replace humans. The goal is to remove the low-leverage administrative drag that normally forces a growing company to need a full-time HR person earlier than it otherwise would.

**Owner-level positioning:** QEP does not need a traditional HR department before it is ready for one. It needs a structured people-operations system that makes onboarding, policy access, employee support, compliance, and manager workflow easier to execute every day.

---

## Phase 1 — Foundation: Handbook Intelligence & Policy Q&A

**Objective:** Turn the employee handbook from a static PDF into a live, searchable, conversational knowledge layer.

**Estimated effort:** 2–3 weeks

### Deliverables

| # | Task | Description |
|---|------|-------------|
| 1.1 | **Handbook ingestion** | Ingest the full QEP employee handbook into the knowledge base. Chunk by policy section, preserving section titles, policy names, and cross-references. |
| 1.2 | **Policy-specific embeddings** | Generate embeddings tagged with `source_type: "policy"` so the chat engine can prioritize policy sources when questions are HR/people-related. |
| 1.3 | **Policy Q&A intent detection** | Extend the chat engine to detect people-operations questions (tardy policy, dress code, probation, jury duty, company card, etc.) and bias retrieval toward handbook chunks. |
| 1.4 | **Answer + source + next step** | When a policy question is answered, include: the answer, the policy source (section name), and the recommended next step or form/workflow if applicable. |
| 1.5 | **Role-gated access** | Ensure all employees can ask policy questions. Manager-only policies (corrective action, termination, etc.) should only surface for `manager` / `owner` roles. |

### Success Criteria
- An employee can ask "What is the tardy policy?" and get the correct answer with the handbook section cited.
- A manager can ask "What do I need to document before ending probation?" and get an actionable, policy-grounded response.
- Policy answers include source citation and next-step guidance.

---

## Phase 2 — Onboarding Engine

**Objective:** Build a structured, role-based onboarding flow that drives every new hire from day one through 90-day milestones.

**Estimated effort:** 3–4 weeks

### Deliverables

| # | Task | Description |
|---|------|-------------|
| 2.1 | **Employee profile schema** | Create `employees` table: id, name, email, role, department, manager_id, location, start_date, probation_end_date, status, onboarding_path_id, created_at, updated_at, deleted_at. |
| 2.2 | **Onboarding path templates** | Create `onboarding_paths` and `onboarding_tasks` tables. Paths are role-based (sales, parts, service, rental, admin, manager). Each path contains ordered tasks with due-day offsets. |
| 2.3 | **Task types** | Support task types: acknowledgment, training, checklist, manager action, system access, equipment readiness, milestone check-in. |
| 2.4 | **New hire launch flow** | When a new employee is created, automatically generate their onboarding task list from the matching path template. Assign due dates based on start date + offset. |
| 2.5 | **Onboarding dashboard** | Employee-facing view: "Your onboarding progress" — checklist with completion status, upcoming tasks, and percentage complete. |
| 2.6 | **Manager onboarding view** | Manager can see all direct reports in onboarding, their progress, overdue tasks, and upcoming milestones. |
| 2.7 | **Milestone check-in prompts** | Automated prompts for 7-day, 14-day, 30-day, 60-day, and 90-day manager check-ins. Track completion. |
| 2.8 | **Probation tracking** | Track probation end date. Alert manager before probation ends. Require documented review before status change. |

### Success Criteria
- A new sales hire gets a role-specific onboarding path with 15–25 tasks auto-assigned.
- Manager receives milestone check-in prompts at 7, 14, 30, 60, 90 days.
- Probation end date is tracked and manager is alerted before it expires.
- Onboarding completion rate is visible on the dashboard.

---

## Phase 3 — Policy Acknowledgments & Compliance Tracking

**Objective:** Replace paper-based or email-based policy acknowledgments with a tracked, auditable digital workflow.

**Estimated effort:** 2 weeks

### Deliverables

| # | Task | Description |
|---|------|-------------|
| 3.1 | **Acknowledgment schema** | Create `policy_acknowledgments` table: id, employee_id, policy_id, policy_version, acknowledged_at, ip_address, signature_hash. |
| 3.2 | **Policy registry** | Create `policies` table: id, title, category, content_hash, version, effective_date, requires_acknowledgment, acknowledgment_frequency (one-time, annual, on-change). |
| 3.3 | **Acknowledgment workflow** | Employee views policy → confirms reading → digital signature recorded → completion tracked. |
| 3.4 | **Compliance dashboard** | Leadership view: which policies are pending acknowledgment, by whom, how overdue. Filter by department, role, policy category. |
| 3.5 | **Re-acknowledgment triggers** | When a policy is updated, automatically queue re-acknowledgment for all affected employees. |
| 3.6 | **Onboarding integration** | Required acknowledgments are automatically included in the new hire's onboarding path. |

### Success Criteria
- All handbook policies that require acknowledgment are tracked digitally.
- Leadership can see a real-time compliance view: who has acknowledged, who has not.
- Policy updates trigger automatic re-acknowledgment workflows.

---

## Phase 4 — Training & Role Readiness

**Objective:** Deliver role-specific training content and track completion as part of onboarding and ongoing development.

**Estimated effort:** 2–3 weeks

### Deliverables

| # | Task | Description |
|---|------|-------------|
| 4.1 | **Training module schema** | Create `training_modules` table: id, title, description, department, role, content_type (video, document, checklist, quiz), estimated_duration, required. |
| 4.2 | **Training assignment** | Assign training modules to employees based on role, department, or onboarding path. Track assignment date, due date, completion date. |
| 4.3 | **Training completion tracking** | Employee marks training complete. Manager can verify. Completion status is auditable. |
| 4.4 | **Role readiness score** | Calculate a readiness score per employee based on: onboarding tasks completed + training modules completed + acknowledgments signed. |
| 4.5 | **Department training dashboard** | Manager and leadership view: training completion rates by department, role, and module. Identify gaps. |
| 4.6 | **Certification tracking** | Track external certifications (CDL, safety, equipment-specific) with expiration dates and renewal alerts. |

### Success Criteria
- A new parts employee receives 8–12 role-specific training modules as part of onboarding.
- Training completion rate is visible at the department level.
- Certification expirations trigger renewal alerts 30/60/90 days in advance.

---

## Phase 5 — Manager Support & Workflow Engine

**Objective:** Give managers structured support for the people-operations tasks they handle most often — without requiring HR expertise.

**Estimated effort:** 3–4 weeks

### Deliverables

| # | Task | Description |
|---|------|-------------|
| 5.1 | **Manager action queue** | Surface pending people-operations actions for each manager: overdue check-ins, pending reviews, unsigned acknowledgments, open issues. |
| 5.2 | **Coaching & documentation prompts** | When a manager logs an attendance issue or performance concern, the system suggests the right documented next step based on company policy and prior history. |
| 5.3 | **Corrective action workflow** | Guided workflow for verbal warning → written warning → final warning → termination path. Each step requires documentation and acknowledgment. |
| 5.4 | **Performance review prompts** | Scheduled review cycles with guided forms. Track completion. Alert managers when reviews are overdue. |
| 5.5 | **Leave request guidance** | When a manager receives a leave request, surface the applicable policy, approval requirements, and documentation needs. |
| 5.6 | **Incident & concern routing** | Employee-reported concerns are routed to the appropriate manager or escalation path. Tracked for resolution. |
| 5.7 | **Manager copilot integration** | Extend the chat engine for manager-specific queries: "What do I need to do before ending probation?", "What policy applies here?", "Who still has not completed acknowledgments?" |

### Success Criteria
- A manager can see all their pending people-operations actions in one queue.
- The corrective action workflow guides the manager through the documented process with policy references.
- Manager copilot answers manager-specific questions with policy-grounded, actionable responses.

---

## Phase 6 — Employee Self-Service

**Objective:** Let employees handle routine people-operations tasks without interrupting managers or leadership.

**Estimated effort:** 2–3 weeks

### Deliverables

| # | Task | Description |
|---|------|-------------|
| 6.1 | **Employee portal** | Personal view: onboarding progress, pending acknowledgments, training modules, upcoming milestones, policy access. |
| 6.2 | **Policy Q&A (employee-facing)** | Conversational interface where any employee can ask policy questions and receive grounded, cited answers. |
| 6.3 | **Time-off request flow** | Submit time-off requests with automatic policy guidance (accrual, notice requirements, approval chain). |
| 6.4 | **Benefits information** | Surface benefits eligibility timing, enrollment windows, and benefit-specific policy references. |
| 6.5 | **Concern submission** | Structured form for reporting concerns, with routing to the appropriate manager or escalation path. Tracked for resolution. |
| 6.6 | **Acknowledgment self-service** | Employee can view and complete outstanding policy acknowledgments from their portal. |

### Success Criteria
- An employee can check their onboarding status, ask a policy question, and request time off without interrupting anyone.
- Concern submissions are routed correctly and tracked.
- Outstanding acknowledgments are visible and completable from the employee portal.

---

## Phase 7 — People Intelligence & Oversight

**Objective:** Give leadership visibility into people-operations health across the company — without requiring manual reporting.

**Estimated effort:** 2–3 weeks

### Deliverables

| # | Task | Description |
|---|------|-------------|
| 7.1 | **People operations dashboard** | Leadership view: KPIs for onboarding completion, acknowledgment compliance, training rates, open manager actions, probation milestones, issue trends. |
| 7.2 | **Department readiness tracking** | By-department view of onboarding, training, and compliance completion rates. |
| 7.3 | **Drift detection** | Automated alerts when people-operations processes are falling behind: overdue onboarding tasks, missed check-ins, unsigned policies, incomplete training. |
| 7.4 | **Manager follow-through visibility** | Leadership can see which managers are completing their people-operations tasks on time and which are falling behind. |
| 7.5 | **Issue trend reporting** | Track and surface patterns: recurring attendance issues, complaint categories, departments with higher concern volume. |
| 7.6 | **Turnover-risk signals** | Based on engagement indicators (missed milestones, overdue reviews, unresolved concerns), surface employees who may be at risk. |

### Success Criteria
- Leadership dashboard shows real-time people-operations KPIs.
- Drift detection alerts surface when onboarding, compliance, or manager follow-through falls behind.
- Turnover-risk signals are visible before they become attrition.

---

## Phase 8 — Culture Scaling Engine (Moonshot Layer)

**Objective:** Use the platform to preserve and reinforce company culture as QEP grows — making expectations visible, standards repeatable, and values consistent across every department and location.

**Estimated effort:** 3–4 weeks (can begin after Phase 5)

### Deliverables

| # | Task | Description |
|---|------|-------------|
| 8.1 | **Culture module** | Dedicated section for QEP's core values: treat others like family, excellence in the ordinary, fearless decision-making, integrity, no gossip. Integrated into onboarding and ongoing reference. |
| 8.2 | **Values-linked onboarding** | Each onboarding path includes culture-specific content that connects daily work expectations to company values. |
| 8.3 | **Recognition workflow** | Peer and manager recognition tied to company values. Track recognition frequency and distribution. |
| 8.4 | **Culture consistency scoring** | Measure consistency of onboarding quality, training completion, and expectation communication across departments and locations. |
| 8.5 | **Manager rhythm enforcement** | Ensure managers across the company follow the same check-in cadence, review process, and documentation standards. |
| 8.6 | **Policy-to-workflow engine** | Transform static handbook policies into executable workflows: acknowledgments become tracked tasks, expense policies become receipt workflows, conduct policies become issue-routing pathways. |

### Success Criteria
- Every new hire receives the same culture messaging regardless of department or location.
- Recognition events are tracked and tied to company values.
- Culture consistency is measurable across the organization.

---

## Phase 9 — Manager Copilot (Advanced AI Layer)

**Objective:** Extend the AI chat engine to serve as a full people-operations copilot for managers.

**Estimated effort:** 3–4 weeks (can begin after Phase 5 + Phase 7)

### Deliverables

| # | Task | Description |
|---|------|-------------|
| 9.1 | **Manager intent detection** | Chat engine detects manager-specific people-operations questions and routes to the copilot flow. |
| 9.2 | **Guided workflow conversations** | "Walk me through what I need to do for this new hire" → system generates a step-by-step checklist from the onboarding path. |
| 9.3 | **Gap analysis queries** | "What steps are missing for this employee?" → system checks onboarding, training, acknowledgments, milestones and surfaces gaps. |
| 9.4 | **Policy application** | "What policy applies here?" → system retrieves the relevant handbook section and recommends the documented next step. |
| 9.5 | **Documentation guidance** | "What should be documented before I move forward?" → system references the corrective action or performance management policy and generates a documentation template. |
| 9.6 | **Acknowledgment status queries** | "Who still has not completed acknowledgments?" → system returns a filtered list by team, department, or policy. |

### Success Criteria
- A manager can have a natural-language conversation about people-operations tasks and receive policy-grounded, actionable guidance.
- Gap analysis queries return accurate results based on real employee data.
- The copilot reduces the time managers spend figuring out the right process.

---

## Database Schema Overview

### Core Tables (New)

| Table | Purpose |
|-------|---------|
| `employees` | Employee profiles with role, department, manager, start date, probation tracking |
| `onboarding_paths` | Role-based onboarding templates |
| `onboarding_tasks` | Individual tasks within an onboarding path |
| `employee_onboarding` | Assignment of onboarding tasks to specific employees with completion tracking |
| `policies` | Policy registry with versioning and acknowledgment requirements |
| `policy_acknowledgments` | Tracked acknowledgment records with timestamps and signatures |
| `training_modules` | Training content registry by role and department |
| `training_assignments` | Assignment and completion tracking per employee |
| `certifications` | External certification tracking with expiration alerts |
| `manager_actions` | Pending people-operations actions for managers |
| `corrective_actions` | Corrective action workflow history |
| `performance_reviews` | Scheduled and completed review records |
| `employee_concerns` | Reported concerns with routing and resolution tracking |
| `recognition_events` | Peer and manager recognition tied to company values |
| `people_ops_alerts` | Drift detection and risk alerts |

### RLS Strategy
- Employees see their own records.
- Managers see direct reports.
- Leadership (`manager`, `owner`) see department or company-wide views.
- All tables follow standard QEP conventions: `id uuid`, `created_at`, `updated_at`, `deleted_at`.

---

## Integration Points

| System | Integration |
|--------|-------------|
| **Knowledge Base** | Handbook chunks feed the policy Q&A engine |
| **Chat Engine** | Manager copilot and employee Q&A use the existing chat infrastructure |
| **Morning Briefing** | People-operations alerts (overdue onboarding, missing check-ins) surface in daily briefings |
| **Anomaly Scan** | Drift detection runs on the same scheduling infrastructure as deal/activity anomaly scans |
| **Executive Intelligence Center** | People-operations KPIs feed into the leadership dashboard |

---

## Risk & Dependencies

| Risk | Mitigation |
|------|------------|
| Handbook not yet digitized | Phase 1 handles ingestion — requires the current handbook document |
| Role-based onboarding paths need content | Work with QEP operations to define department-specific task lists |
| Manager adoption | Start with the action queue (Phase 5.1) — low friction, high value |
| Legal sensitivity | Frame as operational support, not legal HR advice. Include appropriate disclaimers |
| Data privacy | Employee records require strict RLS. Follow existing workspace security patterns |

---

## Recommended Build Sequence

```
Phase 1 (Handbook Intelligence)     → Foundation — unlocks policy Q&A immediately
Phase 2 (Onboarding Engine)         → Highest-visibility feature for ownership
Phase 3 (Acknowledgments)           → Compliance — often a board/insurance requirement
Phase 4 (Training)                  → Extends onboarding into ongoing development
Phase 5 (Manager Support)           → Highest daily-use value for managers
Phase 6 (Employee Self-Service)     → Reduces interruption overhead across the company
Phase 7 (People Intelligence)       → Leadership visibility — ties into Executive Intelligence Center
Phase 8 (Culture Scaling)           → Long-term strategic value
Phase 9 (Manager Copilot)           → Advanced AI layer — builds on all previous phases
```

**Estimated total effort:** 22–30 weeks (phases can overlap; Phases 3+4 can run in parallel with Phase 2)

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Onboarding completion rate (90-day) | > 95% |
| Policy acknowledgment compliance | > 98% |
| Manager check-in completion rate | > 90% |
| Employee policy Q&A resolution (no escalation needed) | > 80% |
| Time-to-productivity for new hires | 20% reduction |
| Manager people-ops admin time | 30% reduction |
| Training completion rate | > 90% |

---

*This roadmap is ready for execution. Phases are designed to deliver incremental value — each phase is independently useful and does not require all subsequent phases to be valuable.*
