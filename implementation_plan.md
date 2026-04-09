# Haven Global UX/UI Systems Overhaul Roadmap

*This specification is synced to the implementation spec inside `docs/specs/UX-OVERHAUL-ROADMAP.md`.*

Provide a master blueprint designed to direct LLM execution agents in refactoring the entire Haven application interface from a passive data viewer into an exception-driven multi-facility Command Center.

## 1. UX Transformation Principles (Rules for the LLM)

When refactoring components, the LLM must apply these principles strictly:
1. **Triage-First**: No page should begin with static counts or historical data. The top of every page MUST surface exceptions, warnings, expiring items, blocked tasks, or overdue actions.
2. **Remove Component Bloat**: Strip out unused `Card` wrappers, unused variables, and decorative graphs. Utilize `V2Card` and `KineticGrid` to establish high-granularity density.
3. **One-Click Resolves**: Avoid deep page navigations for simple sign-offs. Use slide-overs (Drawers) or modals for completing triage tasks (e.g., signing off an incident, charting a missed med).
4. **Context Preservation**: Avoid opening new tabs or forcing full-page reloads. Workflow must maintain context of the underlying module.

---

## 2. Navigation Architecture (The Great Collapse)

**Execution Goal**: Reduce the 25 top-level sidebar items in `AdminShell.tsx` into 6 collapsible contextual domains.

### [MODIFY] `src/components/layout/AdminShell.tsx`
Refactor the flat `<Link>` map into an accordion/group-based navigation model:

1. **Command & Triage**
   - My Triage (Default Landing)
   - Executive Reporting
2. **Resident Pipeline**
   - Referrals & Inquiries
   - Admissions & Move-In Readiness
   - Discharges & Transitions
3. **Clinical & Daily Ops**
   - Active Directory (Roster)
   - Clinical Desk (Assessments & Plan Reviews combined)
   - eMAR & Pharmacy
   - Logistics (Dietary, Maintenance, Transport)
4. **Quality & Risk**
   - Incident Command
   - Infection Control & Labs
   - Compliance Engine
5. **Workforce**
   - Staff Alignment & Scheduling
   - Credentials & Training
   - Time Records & Payroll
6. **Finance & Business**
   - Revenue (Billing & AR)
   - Expenditures (AP & Purchasing)

---

## 3. Post-Login Routing Logic

**Execution Goal**: Stop sending all users to `<All Facilities Dashboard>`. Configure a role-aware router.

### [NEW] `src/components/layout/RoleRouter.tsx` or Middleware changes
Implement redirect logic immediately upon detecting the `user.role` claim:
- `owner` / `org_admin` $\rightarrow$ `/admin/executive`
- `facility_admin` $\rightarrow$ `/admin/triage`
- `nurse` / `caregiver` $\rightarrow$ `/admin/desk` (My Shift)
- `finance` / `billing` $\rightarrow$ `/admin/finance`

---

## 4. Module Rewrite Directives

The following instructions dictate how the LLM should restructure the individual pages in the `src/app/(admin)/*` directories.

### Phase 1: The Triage Inbox (Replaces Root Dashboard)
#### [MODIFY] `src/app/(admin)/page.tsx`
- **Tear down**: Remove the Hero Image, `<CampusOverview>`, and static Census Cards.
- **Build**: Implement `<TriageInbox>`.
- **Data Hookup**: Fetch a unified list of outstanding tasks from `incidents`, `staffing_gaps`, `compliance_alerts`, and `med_exceptions`. Filter by urgency: Red (Urgent Now), Orange (Due Today), Yellow (Needs Review).

### Phase 2: Shift / Clinical Desk Merge
#### [MODIFY] `src/app/(admin)/assessments/page.tsx` & `plan-reviews/page.tsx`
- **Tear down**: Remove independent tables.
- **Build**: Create a unified `ClinicalDesk`. Left drawer shows upcoming/overdue assessments. Right pane shows auto-generated care plan drafts triggered by those assessments. 

### Phase 3: Incident Command Overhaul
#### [MODIFY] `src/app/(admin)/incidents/page.tsx`
- **Tear down**: Remove the flat historic list.
- **Build**: Implement a Kanban or State-Machine layout (`New` $\rightarrow$ `Investigating` $\rightarrow$ `Regulatory Review` $\rightarrow$ `Closed`). Add explicit countdown ribbons (e.g., `<Badge variant="destructive">2 Hours to DOH Deadline</Badge>`).

### Phase 4: Workforce Consolidation
#### [MODIFY] `src/app/(admin)/staffing/page.tsx`
- **Tear down**: Remove basic shift calendar.
- **Build**: Implement HPPD (Hours Per Patient Day) variance indicators at the top. Surface specific roles/shifts that are unstaffed for the next 48 hours. Integrate `certifications` directly into the shift assignment warnings (e.g., preventing assigning an expired CNA).

---

## 5. Development Execution Phasing

To execute safely without breaking the current CI/CD gates, the LLM should process the overhaul in these discrete chunks:

1. **Chunk A (Navigation Structure)**: Rewrite `AdminShell.tsx`. Deploy collateral UI component adjustments.
2. **Chunk B (The Default Router)**: Implement role-based redirecting middleware.
3. **Chunk C (Triage Global)**: Delete the legacy dashboard and stand up the global action queue.
4. **Chunk D+ (Module Sweeps)**: Work through domains 2 through 6, reshaping tables into actionable grids based on the "Exception-First" rule.

## User Review Required

Please review and approve this overarching IA blueprint. Once approved, I can commence **Execution Phasing**, generating atomic branches or commits starting directly with **Chunk A**.
