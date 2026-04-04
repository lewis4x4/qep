# QEP OS — Build Roadmap (LLM Implementation Guide)

> **Purpose**: This document is the canonical implementation contract for building QEP OS. It is written for consumption by language models operating as engineering agents. Every section contains the exact specifications, constraints, data structures, and acceptance criteria needed to implement each phase without ambiguity.
>
> **Source of Truth**: All requirements in this document are derived from operational SOPs provided directly by QEP ownership on April 3, 2026. These SOPs represent exactly how the business operates and how the system must behave. Do not deviate from these flows.
>
> **Repository**: `lewis4x4/qep` on GitHub, `main` branch
>
> **Current State**: 63 tables, 25 edge functions, 64 migrations. Full system context in `QEP-OS-System-Context.md`.

---

## Mission Gate (Apply to Every Change)

```
mission: "Create a transformational AI application built around equipment and parts,
sales and rental, for the employees, salesmen, company corporate operations, and management."
```

Every feature must pass ALL four gates:

1. **Mission Fit** — Advances equipment/parts sales+rental operations for field reps, employees, corporate operations, or management.
2. **Transformation** — Creates capability materially beyond commodity CRM/QRM behavior.
3. **Pressure Test** — Validated under realistic usage, edge cases, and failure modes before closure.
4. **Operator Utility** — Improves decision speed or execution quality for at least one real dealership role.

If a change does not pass all four gates, it does not ship.

---

## Glossary (Use These Terms Everywhere)

| Term | Meaning |
|------|---------|
| QRM | Quality Relationship Manager — the CRM system. Always use "QRM" not "CRM" in UI, docs, and user-facing strings. Internal code can retain `crm_` prefixes on existing tables/functions. |
| Iron Manager | Manager role. Reports to VP of Iron. Pipeline oversight, approvals, pricing authority, forecasting, KPI enforcement. System role: `manager`. |
| Iron Advisor | Field sales rep. Reports to Iron Manager. Owns customer relationships end-to-end, 10 calls/visits per day, 15-min lead response SLA. System role: `rep`. |
| Iron Woman | Sales admin. Reports to Iron Manager. Order processing, credit apps, deposits, invoicing, warranty, inventory management. System role: `admin`. |
| Iron Man | Sales support tech. Reports to Iron Manager. Equipment prep, PDI, inspections, demo setup, rental returns, attachment installs. System role: `rep` with `support` flag. |
| IntelliDealer | Existing DMS (Dealer Management System). External dependency. API status: unconfirmed. All features must work without it (zero-blocking). |
| PDI | Pre-Delivery Inspection. OEM-required checklist before equipment is sale-ready. |
| Traffic Ticket | Internal logistics request for moving equipment. No equipment moves without one. |
| DGE | Deal Genome Engine. 14-variable deal optimization system. |

---

## Pre-Build: Code Audit Remediation (Do First)

These 3 critical bugs from the March 27, 2026 code audit must be fixed before any new feature work begins. They affect system reliability.

### CRITICAL-1: voice-capture jsonError() undefined variable
- **File**: `supabase/functions/voice-capture/index.ts`
- **Bug**: `jsonError()` references undefined `ch` variable, breaking CORS error responses
- **Fix**: Replace `ch` with correct channel/error reference. Verify all CORS error paths return valid JSON.
- **Test**: Trigger an error condition in voice-capture and verify CORS headers and JSON body are correct.

### CRITICAL-2: HubSpot tokens stored as plaintext
- **Table**: `hubspot_connections`
- **Bug**: OAuth tokens stored unencrypted in database
- **Fix**: Implement encryption at rest using `HUBSPOT_CRYPTO_KEY` env var. Encrypt on write, decrypt on read. Backfill existing tokens.
- **Test**: Verify raw database query returns encrypted blob, not readable token.

### CRITICAL-3: PDF ingestion binary file handling
- **File**: `supabase/functions/ingest/index.ts`
- **Bug**: Calls `file.text()` on binary PDF files, producing garbage text that gets embedded as vectors
- **Fix**: Use proper binary handling. Read PDF as ArrayBuffer, pass to pdf-parse library.
- **Test**: Upload a PDF, verify extracted text is readable English, not binary garbage.

### HIGH-1: RLS recursion risk
- **Tables**: 6+ tables with recursive policy chains
- **Fix**: Audit all RLS policies. Flatten recursive chains. Use `get_my_role()` and `get_my_workspace()` helper functions.

### HIGH-2: Chat history localStorage overflow
- **File**: `apps/web/src/components/ChatPage.tsx`
- **Fix**: Migrate to database-backed chat history (tables `chat_conversations` and `chat_messages` already exist). Add pagination. Remove localStorage usage.

---

## Phase 1 — Sales Pipeline Foundation & Voice-First QRM

**Priority**: CRITICAL
**Dependencies**: None (builds on existing schema)
**Builds on**: Existing `crm_deals`, `crm_deal_stages`, `crm_contacts`, `crm_companies`, `crm_activities`, `voice_captures` tables

### 1.1 Pipeline Stage Reconfiguration

Replace existing deal stages with the owner's exact 21-step pipeline. Each step has an owner, SLA, and automation trigger.

```sql
-- Delete existing stages and insert owner's 21-step pipeline
-- Table: crm_deal_stages (already exists, UPDATE rows)

DELETE FROM crm_deal_stages WHERE workspace_id = 'default';

INSERT INTO crm_deal_stages (workspace_id, name, display_order, probability, description) VALUES
('default', 'Lead Received',         1,  0.05, 'Inbound lead routed by territory to correct Iron Advisor'),
('default', 'Initial Contact',       2,  0.10, 'First customer conversation. SLA: <30 minutes from lead receipt'),
('default', 'Needs Assessment',      3,  0.15, 'Structured assessment: application, machine, timeline, budget, trade-in, decision maker'),
('default', 'QRM Entry',             4,  0.15, 'All assessment data entered in QRM. Voice capture auto-fill preferred'),
('default', 'Inventory Validation',  5,  0.20, 'Validate stock availability via IntelliDealer or manual check'),
('default', 'Quote Created',         6,  0.25, 'Quote generated. SLA: <1 hour from needs assessment conversation'),
('default', 'Quote Sent',            7,  0.30, 'Quote package sent: quote + photos + brochure + credit app + video link'),
('default', 'Quote Presented',       8,  0.35, 'Walk-through of proposal with customer. SLA: <30 min after quote sent'),
('default', 'Ask for Sale',          9,  0.40, 'Close attempt. Next step identified: demo, finance, or site visit'),
('default', 'QRM Updated',          10,  0.40, 'Post-presentation status entered. Voice capture preferred'),
('default', 'Follow-Up Set',        11,  0.45, 'Auto-cadence activated: Day 0, 2-3, 7, 14, 30, then monthly'),
('default', 'Ongoing Follow-Up',    12,  0.45, 'Active follow-up until decision. Monthly nurture if no sale'),
('default', 'Sales Order Signed',   13,  0.70, 'Customer signature on sales order. Margin check: <10% routes to manager'),
('default', 'Credit Submitted',     14,  0.75, 'Credit application submitted to bank. Track approval status'),
('default', 'Deal Shared',          15,  0.80, 'Invoice shared with bank and Iron Woman for processing'),
('default', 'Deposit Collected',    16,  0.85, 'Deposit received and verified. HARD GATE: no deposit = no order'),
('default', 'Equipment Ready',      17,  0.90, 'Machine washed, attachments installed, PDI complete, payment confirmed'),
('default', 'Delivery Scheduled',   18,  0.92, 'Traffic ticket created. Delivery date confirmed with customer'),
('default', 'Delivery Completed',   19,  0.95, 'Equipment delivered. Delivery report signed. Hour meter recorded'),
('default', 'Invoice Closed',       20,  0.98, 'Invoice closed. Warranty registration filed'),
('default', 'Post-Sale Follow-Up',  21,  1.00, 'Ongoing: 1 week, 1 month, 90 days, quarterly/bi-annual');
```

#### SLA Enforcement Rules

| Step | SLA | Enforcement |
|------|-----|-------------|
| 1→2 | Lead to initial contact: 15 minutes (owner says <30 min, we enforce tighter) | Timer starts on lead creation. Alert Iron Advisor at 10 min. Escalate to Iron Manager at 15 min. |
| 3→6 | Needs assessment to quote: 1 hour | Timer starts when needs assessment is completed. Alert at 45 min. |
| 7→8 | Quote sent to presented: 30 minutes | Timer starts on quote send. Alert if no activity logged. |
| Any | Deal stale: no activity in 7 days | Anomaly detection (already exists) flags stalling deals. |

Implementation: Add columns `sla_started_at timestamptz` and `sla_deadline_at timestamptz` to `crm_deals`. Create a `pipeline-enforcer` edge function that runs on a cron schedule (every 5 minutes) checking for SLA violations and creating `crm_in_app_notifications`.

### 1.2 Iron Role System

Map existing system roles to Iron nomenclature. Do NOT create new auth roles — extend the existing `profiles` table.

```sql
-- Add Iron role metadata to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS iron_role text CHECK (iron_role IN ('iron_manager', 'iron_advisor', 'iron_woman', 'iron_man'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS iron_role_display text; -- "Iron Manager", "Iron Advisor", etc.

-- Mapping:
-- role = 'manager' → iron_role = 'iron_manager'
-- role = 'rep' (no support flag) → iron_role = 'iron_advisor'
-- role = 'admin' → iron_role = 'iron_woman'
-- role = 'rep' + support flag → iron_role = 'iron_man'
```

#### Role-Specific Dashboard Views

| Iron Role | Dashboard Components |
|-----------|---------------------|
| Iron Manager | Pipeline health (all reps), team KPI scoreboard, approval queue (demos, trades, margin exceptions), inventory aging alerts, wholesale/auction suggestions |
| Iron Advisor | Personal pipeline (21-step board), daily task queue, follow-up queue with countdown timers, prospecting visit counter, morning briefing |
| Iron Woman | Order processing queue, deposit tracker, equipment intake pipeline (Kanban), invoice status, credit application tracker, warranty filing queue |
| Iron Man | Equipment prep queue, PDI checklists, demo schedule with prep tasks, rental return inspection queue, attachment install tasks |

### 1.3 Voice-First QRM Entry

**This is the most critical feature in Phase 1.** The owner's SOPs repeatedly specify "voice capture" as the primary data entry method. The existing `voice_captures` table and `voice-capture` edge function must be enhanced to create a full voice-to-QRM pipeline.

#### Current State
- Voice capture records audio → Whisper transcription → GPT extracts contact name, company, equipment interest, budget, next steps, sentiment, competitor mentions → saves to `voice_captures` table → creates CRM activity note

#### Target State
- All of the above PLUS:
  - Auto-match or create `crm_contacts` record (fuzzy name + company match)
  - Auto-match or create `crm_companies` record
  - Auto-create or update `crm_deals` record in correct pipeline stage
  - Auto-populate `needs_assessments` record (new table, see below)
  - Auto-set follow-up cadence (new table, see below)
  - Auto-score deal via existing anomaly detection
  - Generate QRM log entry in owner's preferred narrative format

#### Extraction Schema

The GPT extraction prompt must be updated to extract ALL of these fields from voice transcripts:

```typescript
interface VoiceQrmExtraction {
  // Contact
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_role: string | null; // "owner", "operator", "manager", etc.
  contact_phone: string | null;
  contact_email: string | null;

  // Company
  company_name: string | null;
  company_location: string | null;

  // Needs Assessment
  application: string | null; // "land clearing", "tree service", "excavation", etc.
  terrain_material: string | null;
  machine_interest: string | null; // "Yanmar ViO 55"
  attachments_needed: string[] | null;
  brand_preference: string | null;
  current_equipment: string | null;
  current_equipment_issues: string | null; // "dissatisfied - not enough power"
  timeline: string | null; // "end of month", "ASAP", "Q3"
  timeline_urgency: 'urgent' | 'normal' | 'flexible' | null;
  budget_amount: number | null;
  budget_type: 'cash' | 'financing' | 'lease' | null;
  monthly_payment_target: number | null;
  financing_preference: string | null; // "0% financing"
  trade_in: boolean | null;
  trade_in_details: string | null;
  decision_maker: boolean | null;
  decision_maker_name: string | null;

  // Deal
  next_step: 'quote' | 'demo' | 'credit_application' | 'site_visit' | 'follow_up' | null;
  deal_stage_suggestion: number | null; // 1-21

  // Intelligence
  competitor_mentions: Array<{ brand: string; context: string }>;
  sentiment: 'positive' | 'neutral' | 'negative';
  buying_intent: 'high' | 'medium' | 'low';

  // QRM Narrative (owner's preferred format)
  qrm_narrative: string; // Natural language summary in the style the owner specified
}
```

#### Owner's QRM Narrative Example (replicate this format)

Input voice note: "I spoke to Mr John Smith with Smith's outdoor services of Lake City. He said that he wants a Yanmar ViO 55..."

Output `qrm_narrative`: "I spoke to Mr John Smith with Smith's Outdoor Services of Lake City. He is interested in a Yanmar ViO 55 for land clearing and tree service. He is currently running a Kubota and is dissatisfied with the power. He would like to trade his current machine. Timeline is end of month with big jobs coming up. He wants 0% financing at around $800/month. He is the owner and decision maker. Next step is to schedule a demo."

### 1.4 Needs Assessment Table

```sql
CREATE TABLE needs_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT 'default',
  deal_id uuid REFERENCES crm_deals(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES crm_contacts(id),
  voice_capture_id uuid REFERENCES voice_captures(id),

  -- Application (from SOP: "What are you using the machine for?")
  application text,
  work_type text,
  terrain_material text,

  -- Machine Requirements (from SOP)
  current_equipment text,
  current_equipment_issues text,
  machine_interest text,
  attachments_needed text[],
  brand_preference text,

  -- Timeline (from SOP: "When do you need it?")
  timeline_description text,
  timeline_urgency text CHECK (timeline_urgency IN ('urgent', 'normal', 'flexible')),
  job_scheduled boolean DEFAULT false,

  -- Budget & Payment (from SOP)
  budget_type text CHECK (budget_type IN ('cash', 'financing', 'lease')),
  budget_amount numeric,
  monthly_payment_target numeric,
  financing_preference text,

  -- Trade-In (from SOP: "Any equipment to trade?")
  has_trade_in boolean DEFAULT false,
  trade_in_details text,

  -- Decision Process (from SOP: "Who is the decision maker?")
  is_decision_maker boolean,
  decision_maker_name text,

  -- Next Step (from SOP: "Quote, Demo, Credit application")
  next_step text CHECK (next_step IN ('quote', 'demo', 'credit_application', 'site_visit', 'follow_up')),

  -- Metadata
  entry_method text CHECK (entry_method IN ('voice', 'manual', 'ai_chat')) DEFAULT 'manual',
  qrm_narrative text, -- Natural language summary

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES profiles(id)
);

-- RLS
ALTER TABLE needs_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own workspace assessments" ON needs_assessments
  FOR SELECT USING (workspace_id = get_my_workspace());
CREATE POLICY "Users can insert assessments" ON needs_assessments
  FOR INSERT WITH CHECK (workspace_id = get_my_workspace());
CREATE POLICY "Users can update own assessments" ON needs_assessments
  FOR UPDATE USING (workspace_id = get_my_workspace() AND created_by = auth.uid());

-- Index
CREATE INDEX idx_needs_assessments_deal ON needs_assessments(deal_id);
CREATE INDEX idx_needs_assessments_contact ON needs_assessments(contact_id);
```

Add to `crm_deals`:
```sql
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS needs_assessment_id uuid REFERENCES needs_assessments(id);
```

### 1.5 Follow-Up Cadence Engine

The owner's Follow-Up SOP defines an exact cadence. The system must auto-schedule these touchpoints AND generate value-add content for each one. The core rule from the SOP: **every follow-up must include VALUE. Eliminate "just checking in."**

```sql
CREATE TABLE follow_up_cadences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT 'default',
  deal_id uuid NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES crm_contacts(id),
  assigned_to uuid REFERENCES profiles(id),
  cadence_type text NOT NULL CHECK (cadence_type IN ('sales', 'post_sale')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE follow_up_touchpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cadence_id uuid NOT NULL REFERENCES follow_up_cadences(id) ON DELETE CASCADE,

  -- Schedule
  touchpoint_type text NOT NULL, -- 'day_0', 'day_2_3', 'day_7', 'day_14', 'day_30', 'monthly', 'post_1wk', 'post_1mo', 'post_90d', 'post_quarterly'
  scheduled_date date NOT NULL,

  -- Content
  purpose text NOT NULL, -- From SOP: "Confirm receipt of quote", "Revisit needs", etc.
  suggested_message text, -- AI-generated value-add content
  value_type text, -- 'quote_confirmation', 'solution_refinement', 'roi_analysis', 'objection_handling', 'timeline_reset', 'nurture'

  -- Execution
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'skipped', 'overdue')),
  completed_at timestamptz,
  completed_by uuid REFERENCES profiles(id),
  completion_notes text,
  delivery_method text CHECK (delivery_method IN ('call', 'text', 'email', 'visit', 'voice_note')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE follow_up_cadences ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_up_touchpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Workspace access" ON follow_up_cadences FOR ALL USING (workspace_id = get_my_workspace());
CREATE POLICY "Via cadence" ON follow_up_touchpoints FOR ALL USING (
  cadence_id IN (SELECT id FROM follow_up_cadences WHERE workspace_id = get_my_workspace())
);

-- Indexes
CREATE INDEX idx_touchpoints_scheduled ON follow_up_touchpoints(scheduled_date) WHERE status = 'pending';
CREATE INDEX idx_touchpoints_cadence ON follow_up_touchpoints(cadence_id);
CREATE INDEX idx_cadences_deal ON follow_up_cadences(deal_id);
```

#### Sales Cadence Schedule (from SOP)

When a new deal enters the pipeline with a quote, auto-create these touchpoints:

| Touchpoint | Offset | Purpose | AI Content Generation |
|------------|--------|---------|----------------------|
| `day_0` | Same day as quote sent | Confirm receipt, answer questions | Auto-send quote recap email/text |
| `day_2_3` | +2 days | Revisit needs, refine solution | Suggest alternative configs, attachment options based on needs assessment |
| `day_7` | +7 days | Provide additional value | Generate ROI comparison or attachment bundle suggestion based on application |
| `day_14` | +14 days | Ask for decision, address objections | Draft objection-handling talking points based on deal context and competitor mentions |
| `day_30` | +30 days | Final push or reset timeline | Suggest timeline reset with lost-sale reason tracking options |
| `monthly` | +60, +90, +120... | Ongoing nurture (even lost deals) | Generate relevant content: new inventory matching interest, promotions, seasonal offers |

#### Post-Sale Cadence Schedule (from SOP)

When a deal reaches step 19 (Delivery Completed), auto-create:

| Touchpoint | Offset | Purpose | AI Content Generation |
|------------|--------|---------|----------------------|
| `post_delivery` | Delivery day | Walkaround training, maintenance basics, service contact intro | Generate delivery report template, capture hour meter |
| `post_1wk` | +7 days | Check-in for early issues | Equipment-specific tips and common first-week questions |
| `post_1mo` | +30 days | Site visit for upsell | Suggest attachments and efficiency improvements for their application |
| `post_90d` | +90 days | Service quality check | Auto-generate survey about parts/service department experience |
| `post_quarterly` | +180, +270, +365... | Retention and future sales | Identify replacement cycle timing, new model availability |

### 1.6 Deposit Management System

The owner's Deposit SOP is non-negotiable. This is a hard system gate: **no deposit = no order**.

```sql
CREATE TABLE deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT 'default',
  deal_id uuid NOT NULL REFERENCES crm_deals(id),

  -- Calculation
  equipment_value numeric NOT NULL,
  required_amount numeric NOT NULL, -- Calculated from tier
  deposit_tier text NOT NULL, -- 'tier_1' ($0-10K), 'tier_2' ($10K-100K), 'tier_3' ($100K-250K), 'tier_4' ($250K+)

  -- Collection
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'requested', 'received', 'verified', 'applied', 'refund_requested', 'refunded')),
  payment_method text CHECK (payment_method IN ('cash', 'check', 'cashiers_check', 'credit_card', 'debit_card', 'ach', 'wire')),
  received_at timestamptz,
  verified_at timestamptz,
  verified_by uuid REFERENCES profiles(id),

  -- Invoice
  invoice_reference text,
  applied_to_final_invoice boolean DEFAULT false,

  -- Refund (for special orders)
  refund_policy text CHECK (refund_policy IN ('non_refundable', 'management_discretion')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES profiles(id)
);

ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Workspace access" ON deposits FOR ALL USING (workspace_id = get_my_workspace());
```

#### Deposit Tier Calculation (from SOP, exact values)

```typescript
function calculateDeposit(equipmentValue: number): { amount: number; tier: string; refundPolicy: string } {
  if (equipmentValue <= 10000) {
    return { amount: 500, tier: 'tier_1', refundPolicy: 'non_refundable' };
  } else if (equipmentValue <= 100000) {
    return { amount: 1000, tier: 'tier_2', refundPolicy: 'non_refundable' };
  } else if (equipmentValue <= 250000) {
    return { amount: 2500, tier: 'tier_3', refundPolicy: 'non_refundable' };
  } else {
    const onePercent = equipmentValue * 0.01;
    return { amount: Math.max(5000, onePercent), tier: 'tier_4', refundPolicy: 'non_refundable' };
  }
}
```

#### Pipeline Gate Enforcement

When a deal transitions to stage 16 (Deposit Collected):
1. System auto-calculates required deposit based on equipment value on the deal
2. Creates `deposits` record with `status = 'pending'`
3. Notifies Iron Woman with customer details, amount, and invoice reference
4. **BLOCKS stage progression past 16 until `deposits.status = 'verified'`**

Add to `crm_deals`:
```sql
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS deposit_status text DEFAULT 'not_required';
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS deposit_amount numeric;
ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS margin_check_status text DEFAULT 'not_checked';
```

### 1.7 Phase 1 Edge Functions

| Function | Method | Purpose |
|----------|--------|---------|
| `voice-to-qrm` | POST | Enhanced voice capture: transcribe → extract all fields → match/create contact+company → create/update deal → populate needs assessment → set follow-up cadence → score deal → return structured result |
| `needs-assessment` | GET/POST/PUT | CRUD for needs assessment records. GET by deal_id or contact_id. POST creates new. PUT updates existing. Voice auto-fill populates all fields. |
| `deposit-calculator` | POST | Calculate deposit tier for given equipment value. Create deposit record. Enforce pipeline gate. Track collection status. |
| `follow-up-engine` | POST (cron) | Run every hour. Check for touchpoints where `scheduled_date <= today` and `status = 'pending'`. Generate AI content for each. Create notifications. Mark overdue if past deadline. |
| `pipeline-enforcer` | POST (cron) | Run every 5 minutes. Check SLA violations (15-min lead response, 1-hr quote creation). Enforce deposit gate at stage 16. Enforce margin check at stage 13. Create alerts. |

### 1.8 Phase 1 Acceptance Criteria

- [ ] 21-step pipeline visible in deal board with drag-and-drop stage transitions
- [ ] Voice capture creates fully populated deal + contact + company in <10 seconds
- [ ] Needs assessment auto-populated from voice with 90%+ field accuracy
- [ ] Follow-up cadence auto-set on every new deal matching Day 0/2-3/7/14/30 timing
- [ ] AI-generated value content for each follow-up touchpoint (not "just checking in")
- [ ] Deposit calculator auto-fires at Step 16 with correct tiered amount
- [ ] Stage progression blocked past Step 16 without verified deposit
- [ ] Iron role labels visible throughout UI with role-appropriate dashboard views
- [ ] 15-minute SLA alert on inbound leads
- [ ] 1-hour SLA alert on quote creation
- [ ] QRM narrative generated in owner's specified format for every voice capture

---

## Phase 2 — Field Operations & Revenue Engine

**Priority**: HIGH
**Dependencies**: Phase 1 (pipeline stages, voice-to-QRM, needs assessments)

### 2.1 Equipment Demo Lifecycle

Full demo management per owner's Equipment Demo SOP.

```sql
CREATE TABLE demos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT 'default',
  deal_id uuid NOT NULL REFERENCES crm_deals(id),
  equipment_id uuid REFERENCES crm_equipment(id),

  -- Qualification (from SOP: all must be true before demo approved)
  needs_assessment_complete boolean NOT NULL DEFAULT false,
  quote_presented boolean NOT NULL DEFAULT false,
  buying_intent_confirmed boolean NOT NULL DEFAULT false,

  -- Approval
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'denied', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  requested_by uuid REFERENCES profiles(id),
  approved_by uuid REFERENCES profiles(id),
  approved_at timestamptz,
  denial_reason text,

  -- Scheduling
  scheduled_date date,
  scheduled_time_start timestamptz,
  scheduled_time_end timestamptz,
  traffic_ticket_id uuid, -- FK to traffic_tickets (Phase 3)

  -- Execution (from SOP: max hours)
  equipment_category text CHECK (equipment_category IN ('construction', 'forestry')),
  max_hours numeric NOT NULL, -- 10 for construction, 4 for forestry
  starting_hours numeric, -- Hour meter at demo start
  ending_hours numeric, -- Hour meter at demo end
  hours_used numeric GENERATED ALWAYS AS (ending_hours - starting_hours) STORED,

  -- Cost allocation (from SOP: demo costs added to machine cost)
  transport_cost numeric DEFAULT 0,
  fuel_cost numeric DEFAULT 0,
  prep_labor_cost numeric DEFAULT 0,
  wear_cost numeric DEFAULT 0,
  total_demo_cost numeric GENERATED ALWAYS AS (transport_cost + fuel_cost + prep_labor_cost + wear_cost) STORED,

  -- Follow-up
  followup_due_at timestamptz, -- 24 hours after completion per SOP
  followup_completed boolean DEFAULT false,
  customer_decision text CHECK (customer_decision IN ('purchase', 'decline', 'undecided')),

  -- Customer responsibilities (from SOP)
  customer_responsible_fuel boolean DEFAULT true,
  customer_responsible_def boolean DEFAULT true,
  customer_responsible_damage boolean DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE demo_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_id uuid NOT NULL REFERENCES demos(id),
  inspection_type text NOT NULL CHECK (inspection_type IN ('pre_demo', 'post_demo')),
  inspector_id uuid REFERENCES profiles(id), -- Iron Man

  -- Checklist
  checklist_items jsonb NOT NULL DEFAULT '[]', -- [{item: "Fuel level", status: "pass", notes: "Full tank"}]
  photos jsonb DEFAULT '[]', -- [{url: "...", caption: "Left side"}]

  -- Condition
  overall_condition text CHECK (overall_condition IN ('excellent', 'good', 'fair', 'poor')),
  damage_found boolean DEFAULT false,
  damage_description text,
  damage_photos jsonb DEFAULT '[]',

  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE demos ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Workspace access" ON demos FOR ALL USING (workspace_id = get_my_workspace());
CREATE POLICY "Via demo" ON demo_inspections FOR ALL USING (
  demo_id IN (SELECT id FROM demos WHERE workspace_id = get_my_workspace())
);
```

#### Demo Approval Flow
1. Iron Advisor requests demo → system verifies: needs assessment complete AND quote presented AND buying intent flagged
2. If prerequisites missing → request blocked with specific missing items listed
3. If prerequisites met → Iron Manager receives approval notification with: customer context, deal value, qualification score
4. Iron Manager approves (one-tap) or denies with reason
5. On approval → Iron Man receives prep task with inspection checklist
6. During demo → real-time hour tracking. Alert at 80% of max hours. Auto-notify manager at 100%.
7. Within 24 hours of completion → mandatory follow-up auto-scheduled
8. If customer declines → auto-generate traffic ticket for equipment pickup
9. Demo costs auto-allocated to machine cost in deal margin calculation

### 2.2 AI Trade-In Valuation

Transform trade evaluation from manual to AI-powered per owner's Equipment Trade SOP.

```sql
CREATE TABLE trade_valuations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT 'default',
  deal_id uuid REFERENCES crm_deals(id),

  -- Equipment details (from SOP: required information)
  make text NOT NULL,
  model text NOT NULL,
  year integer,
  serial_number text,
  hours numeric,

  -- Media (from SOP: 4 corner photos, walkaround video, serial plate, hours photo)
  photos jsonb NOT NULL DEFAULT '[]', -- [{type: "front", url: "..."}, {type: "rear"}, {type: "left"}, {type: "right"}, {type: "serial_plate"}, {type: "hours_meter"}]
  video_url text,

  -- Condition (from SOP)
  operational_status text CHECK (operational_status IN ('daily_use', 'operational', 'non_operational')),
  last_full_service text,
  needed_repairs text,
  attachments_included text[],

  -- AI Assessment
  ai_condition_score numeric, -- 0-100 from vision analysis
  ai_condition_notes text,
  ai_detected_damage text[],

  -- Market Comps (from SOP: 3 comps required)
  market_comps jsonb DEFAULT '[]', -- [{source: "Machinery Trader", price: 45000, url: "..."}, ...]

  -- Pricing (from SOP: auction value - 8% - reconditioning)
  auction_value numeric,
  discount_percentage numeric DEFAULT 8, -- SOP specifies 8%
  discounted_value numeric, -- auction_value * (1 - discount_percentage/100)
  reconditioning_estimate numeric, -- PM + repairs + wash + paint
  preliminary_value numeric, -- discounted_value - reconditioning_estimate
  final_value numeric, -- Approved value

  -- Target margins (from SOP: 20-25% on resale)
  target_resale_margin_min numeric DEFAULT 20,
  target_resale_margin_max numeric DEFAULT 25,
  suggested_resale_price numeric,

  -- Approval (from SOP: over-allowance requires manager approval)
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'preliminary', 'manager_review', 'approved', 'rejected')),
  over_allowance boolean DEFAULT false,
  approved_by uuid REFERENCES profiles(id),
  approval_notes text,

  -- Quote language (from SOP: mandatory conditional language)
  conditional_language text DEFAULT 'Traded machine must be in the same condition as when it was evaluated',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES profiles(id)
);

ALTER TABLE trade_valuations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Workspace access" ON trade_valuations FOR ALL USING (workspace_id = get_my_workspace());
```

#### Trade Valuation Flow
1. Iron Advisor uploads: 4-corner photos + walkaround video + hours/serial plate photo
2. Equipment Vision AI analyzes: make, model, year, condition, visible damage, attachments
3. System pulls 3 market comps from integrated sources (Machinery Trader VIP, auction databases)
4. Pricing engine: `Auction Value × 0.92 (8% discount) - Reconditioning Estimate = Preliminary Value`
5. AI estimates reconditioning cost from condition assessment
6. **Preliminary value presented to Iron Advisor within 60 seconds of upload**
7. If value exceeds formula by >10% → auto-flag for Iron Manager approval with justification required
8. Final value locked → added to deal quote with conditional language auto-inserted
9. Target resale margin overlay shows 20-25% requirement and suggested resale price

### 2.3 Prospecting KPI Enforcement

From owner's Customer Prospecting SOP. Non-negotiable: **10 positive visits per day, QRM updated same day, no drive-by visits counted.**

```sql
CREATE TABLE prospecting_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT 'default',
  rep_id uuid NOT NULL REFERENCES profiles(id),
  visit_date date NOT NULL DEFAULT CURRENT_DATE,

  -- Location
  contact_id uuid REFERENCES crm_contacts(id),
  company_id uuid REFERENCES crm_companies(id),
  location_name text,
  location_lat numeric,
  location_lng numeric,

  -- Quality criteria (from SOP: at least one must be true for "positive" visit)
  spoke_with_decision_maker boolean DEFAULT false,
  identified_need_or_opportunity boolean DEFAULT false,
  equipment_discussion boolean DEFAULT false,
  followed_up_on_active_deal boolean DEFAULT false,

  -- Computed
  is_positive boolean GENERATED ALWAYS AS (
    spoke_with_decision_maker OR identified_need_or_opportunity OR
    equipment_discussion OR followed_up_on_active_deal
  ) STORED,

  -- Details (from SOP: mandatory same-day logging)
  contact_name text,
  contact_role text,
  conversation_summary text,
  opportunities_identified text,
  competitive_equipment_on_site text,
  next_action text,
  follow_up_date date,

  -- Linked records
  deal_id uuid REFERENCES crm_deals(id),
  voice_capture_id uuid REFERENCES voice_captures(id),

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE prospecting_kpis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT 'default',
  rep_id uuid NOT NULL REFERENCES profiles(id),
  kpi_date date NOT NULL DEFAULT CURRENT_DATE,

  total_visits integer DEFAULT 0,
  positive_visits integer DEFAULT 0,
  target integer DEFAULT 10,
  target_met boolean GENERATED ALWAYS AS (positive_visits >= 10) STORED,

  -- Streak
  consecutive_days_met integer DEFAULT 0,

  -- Derived
  opportunities_created integer DEFAULT 0,
  quotes_generated integer DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(workspace_id, rep_id, kpi_date)
);

ALTER TABLE prospecting_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospecting_kpis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Workspace access" ON prospecting_visits FOR ALL USING (workspace_id = get_my_workspace());
CREATE POLICY "Workspace access" ON prospecting_kpis FOR ALL USING (workspace_id = get_my_workspace());
```

#### KPI Enforcement Rules
- Real-time counter visible on Iron Advisor mobile dashboard
- Only visits where `is_positive = true` count toward daily target
- Iron Manager dashboard shows all advisors' KPI status in real-time
- Automated nudge notification at 2 PM if advisor is under 50% of daily target (5 visits)
- End-of-day alert if target not met
- Streak tracking for consecutive days meeting target

### 2.4 Post-Sale Follow-Up Automation

See follow-up cadence engine in Phase 1 (1.5). Phase 2 adds the post-sale cadence type with AI content generation for each touchpoint.

#### Issue Escalation from Post-Sale Follow-Up (from SOP)

The owner's example: *"Today I spoke with John Smith on our 90 Day follow up post sale. He mentioned that the timeliness of the parts for his Yanmar machine has put him in a bind. Please write an email to Norman Udstad Lake City Parts Manager about the problems he is having. Please note for him to make a courtesy call to Mr. John Smith. Make a follow up task for me to check with Norman tomorrow."*

The system must handle this from a single voice command:
1. Log the post-sale touchpoint as completed with issue noted
2. Auto-draft email to the relevant department manager (identified from org data)
3. Create follow-up task for the Iron Advisor for the next day
4. Create escalation ticket linking the customer, issue, department, and status

```sql
CREATE TABLE escalation_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT 'default',

  -- Source
  touchpoint_id uuid REFERENCES follow_up_touchpoints(id),
  deal_id uuid REFERENCES crm_deals(id),
  contact_id uuid REFERENCES crm_contacts(id),

  -- Issue
  issue_description text NOT NULL,
  department text, -- 'parts', 'service', 'sales', 'admin'
  branch text, -- 'lake_city', 'ocala'
  severity text DEFAULT 'normal' CHECK (severity IN ('low', 'normal', 'high', 'critical')),

  -- Routing
  assigned_to uuid REFERENCES profiles(id), -- Department manager
  escalated_by uuid REFERENCES profiles(id), -- Iron Advisor

  -- Resolution
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  resolution_notes text,
  resolved_at timestamptz,

  -- Auto-generated actions
  email_drafted boolean DEFAULT false,
  follow_up_task_created boolean DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE escalation_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Workspace access" ON escalation_tickets FOR ALL USING (workspace_id = get_my_workspace());
```

### 2.5 Quote Builder V2

The existing Quote Builder (1,500+ lines, `QuoteBuilderPage.tsx`) is gated behind IntelliDealer credentials. Phase 2 implements zero-blocking architecture.

#### Entry Modes (from QuoteBuilder-V2-System-Prompt.md)
1. **Voice-first**: Record deal description → AI populates all fields
2. **AI chat**: Type description → AI populates
3. **Traditional form**: Manual entry

#### Key Features
- AI Equipment Recommendation: describe the job → get optimal machine + attachment suggestions with reasoning
- Trade-in integration: pull valuation from Phase 2 trade system
- Financing preview: 3 scenarios (cash, 60-month finance, 48-month lease) from admin-configured `financing_rate_matrix` table (already exists)
- Smart Proposal PDF: 4-page branded proposal
- Margin check: deals under 10% margin auto-route to Iron Manager for approval
- Quote package auto-send: photos, brochure, credit application, video link per SOP
- E-signature for sales order at pipeline step 13

#### Zero-Blocking Architecture
```
IF IntelliDealer API connected:
  → Pull live inventory, pricing, stock status
ELSE:
  → Use manual equipment catalog entry
  → Admin can bulk-import inventory via CSV
  → Quote Builder fully functional with manual data
```

### 2.6 Phase 2 Edge Functions

| Function | Method | Purpose |
|----------|--------|---------|
| `demo-manager` | GET/POST/PUT | Full demo lifecycle: qualification check, approval routing, hour tracking, cost allocation, follow-up scheduling |
| `trade-valuation` | POST | Photo upload → Equipment Vision AI → market comp pull → pricing formula → preliminary value. Target: <60 seconds. |
| `prospecting-tracker` | GET/POST | Log visits with quality validation, calculate daily KPIs, trigger manager alerts |
| `post-sale-engine` | POST (cron) | Auto-schedule post-sale touchpoints, generate AI content, handle escalation ticket creation |
| `quote-builder-v2` | POST | Voice/AI/form entry, equipment recommendation, financing preview, margin check, PDF generation |
| `escalation-router` | POST | Create escalation tickets, draft emails, create follow-up tasks from voice commands |

### 2.7 Phase 2 Acceptance Criteria

- [ ] Demo lifecycle: request → qualification gate → approval → prep → execution → 24hr follow-up → return inspection
- [ ] Hour tracking with alerts at 80% and 100% of SOP limits (10hr construction / 4hr forestry)
- [ ] Trade valuation: photo upload to preliminary price in <60 seconds
- [ ] 3 market comps auto-pulled, pricing formula applied (auction - 8% - reconditioning)
- [ ] Prospecting KPI dashboard with real-time positive visit counter
- [ ] Manager alert at 2 PM for advisors under 50% of daily target
- [ ] Post-sale cadence auto-scheduled at delivery
- [ ] Voice command creates complete escalation (email + task + ticket)
- [ ] Quote Builder works without IntelliDealer (manual inventory mode)
- [ ] Margin check blocks quotes under 10% without manager approval

---

## Phase 3 — Operational Intelligence & Logistics

**Priority**: HIGH
**Dependencies**: Phase 1 pipeline, Phase 2 field ops

### 3.1 Equipment Intake Pipeline (8 Stages)

From owner's New Equipment Intake document. Kanban-style board with stage-gated progression.

```sql
CREATE TABLE equipment_intake (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT 'default',
  equipment_id uuid REFERENCES crm_equipment(id),

  -- Stage tracking (from SOP: 8 stages)
  current_stage integer NOT NULL DEFAULT 1 CHECK (current_stage BETWEEN 1 AND 8),
  -- 1: Purchase & Logistics
  -- 2: Equipment Arrival
  -- 3: PDI Completion
  -- 4: Inventory Labeling
  -- 5: Sales Readiness
  -- 6: Online Listing
  -- 7: Internal Documentation
  -- 8: Sale Ready

  -- Stage 1: Purchase & Logistics (Owner: Iron Manager / Iron Woman)
  po_number text,
  stock_number text,
  ship_to_branch text, -- 'lake_city' or 'ocala'
  freight_method text,
  estimated_arrival date,
  demand_assessment text, -- 'stock' or 'retail_deal'

  -- Stage 2: Equipment Arrival (Owner: Service Department)
  arrival_date date,
  freight_damage_found boolean DEFAULT false,
  freight_damage_notes text,
  arrival_photos jsonb DEFAULT '[]', -- 4 corners + serial + BOL
  received_in_intellidealer boolean DEFAULT false,

  -- Stage 3: PDI (Owner: Iron Woman / Service)
  pdi_checklist jsonb DEFAULT '[]', -- [{item: "OEM check 1", completed: true, photo_url: "..."}]
  pdi_completed boolean DEFAULT false,
  pdi_signed_off_by uuid REFERENCES profiles(id),
  decals_installed boolean DEFAULT false, -- QEP black decals
  qr_code_installed boolean DEFAULT false, -- Contact QR in cab
  attachments_mounted boolean DEFAULT false,

  -- Stage 4: Inventory Labeling (Owner: Iron Woman)
  barcode_interior boolean DEFAULT false,
  barcode_exterior boolean DEFAULT false,

  -- Stage 5: Sales Readiness (Owner: Iron Woman / Detail)
  detail_needed boolean DEFAULT false,
  detail_scheduled boolean DEFAULT false,
  detail_contractor text,
  photo_ready boolean DEFAULT false,

  -- Stage 6: Online Listing (Owner: Iron Woman / Marketing)
  machinery_trader_listed boolean DEFAULT false,
  facebook_listed boolean DEFAULT false,
  equipment_trader_listed boolean DEFAULT false,
  pricing_verified boolean DEFAULT false,
  listing_photos jsonb DEFAULT '[]',

  -- Stage 7: Internal Documentation (Owner: Iron Woman)
  intellidealer_notes_added boolean DEFAULT false,
  spare_parts_documented boolean DEFAULT false,
  special_setup_documented boolean DEFAULT false,

  -- Stage 8: Sale Ready (Owner: Iron Manager / Iron Woman)
  team_notified boolean DEFAULT false,
  high_demand_flagged boolean DEFAULT false,

  -- Metadata
  stage_history jsonb DEFAULT '[]', -- [{stage: 1, entered_at: "...", completed_at: "...", completed_by: "..."}]

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE equipment_intake ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Workspace access" ON equipment_intake FOR ALL USING (workspace_id = get_my_workspace());
CREATE INDEX idx_intake_stage ON equipment_intake(current_stage) WHERE current_stage < 8;
```

### 3.2 Traffic & Logistics System

From owner's Traffic Manual. No equipment moves without a traffic ticket.

```sql
CREATE TABLE traffic_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT 'default',

  -- Required fields (from Traffic Manual: minimum required)
  stock_number text NOT NULL,
  equipment_id uuid REFERENCES crm_equipment(id),
  from_location text NOT NULL,
  to_location text NOT NULL,
  to_contact_name text NOT NULL,
  to_contact_phone text NOT NULL,
  shipping_date date NOT NULL,
  department text NOT NULL,
  billing_comments text NOT NULL, -- Who pays + reason

  -- Type (from Traffic Manual: 12 ticket types)
  ticket_type text NOT NULL CHECK (ticket_type IN (
    'demo', 'loaner', 'rental', 'sale', 'purchase', 'service',
    'trade_in', 'customer_transfer', 'job_site_transfer',
    'location_transfer', 'miscellaneous', 're_rent'
  )),

  -- Status (from Traffic Manual: color coding)
  status text NOT NULL DEFAULT 'haul_pending' CHECK (status IN (
    'haul_pending',   -- Gray
    'scheduled',      -- Yellow (Low)
    'being_shipped',  -- Orange (Medium)
    'completed'       -- Red (High/Delivered)
  )),
  urgency text, -- Set by Logistics Coordinator only, not requestor

  -- GPS (from Traffic Manual: use Google Maps pins)
  delivery_lat numeric,
  delivery_lng numeric,
  delivery_address text,

  -- Assignment
  requested_by uuid REFERENCES profiles(id),
  driver_id uuid REFERENCES profiles(id),
  coordinator_id uuid REFERENCES profiles(id),

  -- Driver checklist (from Traffic Manual)
  driver_checklist jsonb DEFAULT '[]', -- [{item: "Verify unit", done: false}, {item: "Inspect for damage", done: false}, ...]
  delivery_signature_url text,
  delivery_photos jsonb DEFAULT '[]',
  hour_meter_reading numeric,
  problems_reported text,

  -- Links
  deal_id uuid REFERENCES crm_deals(id),
  demo_id uuid REFERENCES demos(id),

  -- Requestor lock (from Traffic Manual: requestors cannot modify after submission)
  locked boolean DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE traffic_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Workspace access" ON traffic_tickets FOR ALL USING (workspace_id = get_my_workspace());
```

**Auto-creation rule**: When a deal reaches pipeline step 18 (Delivery Scheduled), auto-create a traffic ticket pre-filled with deal data.

### 3.3 Rental Deposit Return System

From owner's Rental Deposit Return Process. Branching workflow.

```sql
CREATE TABLE rental_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT 'default',
  equipment_id uuid REFERENCES crm_equipment(id),

  -- Inspection (Step 1: Iron Man inspects)
  inspection_date date,
  inspector_id uuid REFERENCES profiles(id),
  inspection_checklist jsonb DEFAULT '[]',
  condition_photos jsonb DEFAULT '[]',

  -- Decision (Step 2: Rental Asset Manager decides)
  has_charges boolean, -- null = pending, false = clean, true = damaged
  decided_by uuid REFERENCES profiles(id),

  -- Clean return path (Steps 4A/4B)
  credit_invoice_number text, -- Part# SD1
  rental_contract_reference text,

  -- Damaged return path (Steps 5A-5D)
  work_order_number text,
  damage_description text,
  charge_amount numeric,
  deposit_amount numeric,
  deposit_covers_charges boolean,
  balance_due numeric, -- If deposit doesn't cover

  -- Refund (same method as payment per SOP)
  original_payment_method text CHECK (original_payment_method IN ('cash', 'check', 'wire', 'credit_card', 'debit_card', 'ach')),
  refund_method text, -- Must match original
  refund_status text DEFAULT 'pending' CHECK (refund_status IN ('pending', 'processing', 'completed')),
  refund_check_turnaround text, -- '7-14 days' per SOP

  status text NOT NULL DEFAULT 'inspection_pending' CHECK (status IN (
    'inspection_pending', 'decision_pending', 'clean_return', 'damage_assessment',
    'work_order_open', 'refund_processing', 'completed'
  )),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rental_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Workspace access" ON rental_returns FOR ALL USING (workspace_id = get_my_workspace());
```

### 3.4 Payment Policy Enforcement

From owner's Check Acceptance Policy.

```sql
CREATE TABLE payment_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL DEFAULT 'default',
  customer_id uuid REFERENCES crm_contacts(id),

  payment_type text NOT NULL, -- 'business_check', 'personal_check', 'cashiers_check', 'credit_card', 'debit_card', 'ach', 'wire'
  amount numeric NOT NULL,
  validation_date date NOT NULL DEFAULT CURRENT_DATE,

  -- Running totals
  daily_check_total numeric, -- Sum of checks today for this customer

  -- Rules applied
  rule_applied text, -- 'business_check_limit', 'personal_check_limit', 'delivery_day_cashiers_only', 'rental_no_checks'
  passed boolean NOT NULL,
  override_by uuid REFERENCES profiles(id), -- A/R approval for exceptions
  override_reason text,

  -- Context
  invoice_reference text,
  transaction_type text, -- 'equipment_sale', 'rental', 'parts', 'service'
  is_delivery_day boolean DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payment_validations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Workspace access" ON payment_validations FOR ALL USING (workspace_id = get_my_workspace());
```

#### Rules (from SOP, exact values)
- Business checks: $2,500 max per customer per day
- Personal checks: $1,000 max per customer per day
- Equipment sales on delivery day: Cashier's Check ONLY (regular checks disabled)
- Equipment rentals: Cashier's Check, ACH, Card, or Wire ONLY (no regular checks)
- Over-limit exceptions: require A/R approval (documented and initialed)
- Returned checks: $30 fee auto-applied, check privileges flagged

### 3.5 GL Account Routing

From owner's Sales Department Internal Account Guide. Auto-suggest the correct GL account based on work order context.

```sql
CREATE TABLE gl_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gl_code text NOT NULL, -- 'EQUIP001', 'RENTA001', 'RENTA003', 'LOSS01', 'SALEM001', 'TRKM008', 'EXPO01', 'SALEW001'
  gl_name text NOT NULL,
  gl_number text, -- Actual GL number from accounting system

  -- Matching rules (evaluated in order)
  equipment_status text, -- 'inventory', 'rental', null
  ticket_type text, -- 'rental', null
  is_customer_damage boolean,
  has_ldw boolean, -- Loss Damage Waiver
  is_sales_truck boolean,
  truck_numbers text[], -- ['251', '252', '253', '254']
  is_event_related boolean,
  requires_ownership_approval boolean DEFAULT false, -- SALEW001 requires Ryan/Dad approval

  description text,
  usage_examples text,

  created_at timestamptz NOT NULL DEFAULT now()
);
```

**SALEW001 (Good Faith) special rule**: From SOP: "THIS WILL NEED TO BE DISCUSSED WITH RYAN, DAD, OR MYSELF, before mentioning anything to customers about us covering it." System must enforce ownership-level approval gate before this GL code can be applied to any invoice.

### 3.6 Phase 3 Acceptance Criteria

- [ ] Equipment intake Kanban board with 8 stages, drag-and-drop, photo requirements per stage
- [ ] PDI as tap-through mobile checklist with required photo evidence
- [ ] Traffic ticket auto-created at deal step 18 with pre-filled data
- [ ] Driver mobile workflow: checklist, GPS, signature capture, photos
- [ ] Rental return branching workflow: clean vs. damaged paths
- [ ] Check acceptance rules enforced at invoice creation
- [ ] GL account auto-suggested on work orders with 95%+ accuracy
- [ ] Good Faith (SALEW001) requires ownership approval gate

---

## Phase 4 — Deal Genome Engine & Predictive Intelligence

**Priority**: HIGH
**Dependencies**: All prior phases + market data integrations
**Existing Schema**: 13 DGE tables already exist (`customer_profiles_extended`, `market_valuations`, `auction_results`, `competitor_listings`, `fleet_intelligence`, `manufacturer_incentives`, `financing_rate_matrix`, `deal_scenarios`, `deal_feedback`, `margin_waterfalls`, `pricing_persona_models`, `outreach_queue`, `customer_deal_history`)

### 4.1 The 14-Variable Deal Optimization

Each deal is decomposed into 14 variables. The DGE analyzes all simultaneously and produces optimal deal structures.

| # | Variable | Source | Existing Table |
|---|----------|--------|---------------|
| 1 | Base Equipment Price | Quote/catalog | `quotes` |
| 2 | Market Value Position | Machinery Trader, auctions | `market_valuations`, `auction_results` |
| 3 | Inventory Age Pressure | Days in stock → carrying cost | `crm_equipment.created_at` |
| 4 | Trade-In Valuation | Phase 2 trade system | `trade_valuations` |
| 5 | Attachment Bundle | Application-matched upsells | `crm_equipment` (attachments) |
| 6 | Service Contract | Predicted maintenance cost | `fleet_intelligence` |
| 7 | Financing Structure | Rate matrix optimization | `financing_rate_matrix` |
| 8 | Manufacturer Incentives | Active rebates/bonuses | `manufacturer_incentives` |
| 9 | Customer Price Sensitivity | Historical behavior | `customer_profiles_extended`, `pricing_persona_models` |
| 10 | Customer Lifetime Value | Predicted future revenue | `customer_deal_history` |
| 11 | Competitive Pressure | Competitor pricing | `competitor_listings`, `competitive_mentions` |
| 12 | Seasonal Demand | Time-of-year pricing power | `economic_indicators` |
| 13 | Fleet Replacement Cycle | Equipment aging in customer fleet | `fleet_intelligence` |
| 14 | Deal Close Probability | Engagement signal scoring | `crm_deals.deal_score` |

#### Output: 3 Deal Scenarios per Opportunity

For every active deal, the DGE produces:

1. **Conservative**: Maximum margin, lower close probability. Prioritizes dealer profitability.
2. **Balanced**: Optimized across all 14 variables. Best overall expected value.
3. **Aggressive**: Maximum close probability, minimum acceptable margin. Prioritizes winning the deal.

Each scenario includes: equipment price, trade allowance, attachment recommendations, financing terms, service contract pricing, and total margin waterfall.

### 4.2 Predictive Prospecting Engine

Transform morning briefing from "here's what happened" to "here's exactly what to do today."

For each Iron Advisor, generate a daily visit list of 10 customers ranked by:
1. Overdue follow-up touchpoints (highest priority)
2. Fleet replacement cycle predictions (equipment approaching replacement)
3. Seasonal demand signals (construction season ramp, tree work season)
4. Competitive displacement opportunities (dissatisfaction signals from voice captures)
5. Geographic clustering (minimize drive time between visits)
6. New inventory matching expressed interest
7. Time-limited manufacturer incentive windows
8. Customer lifecycle signals (90-day check-in due, service contract renewal)

### 4.3 Phase 4 Acceptance Criteria

- [ ] DGE produces 3 optimized deal scenarios per active opportunity
- [ ] Margin waterfall visualization per deal
- [ ] Manufacturer incentive alerts within 24 hours of availability
- [ ] Ownership dashboard: margin analytics, pipeline intelligence, revenue forecasting, KPI scoreboard
- [ ] Predictive prospecting generates daily 10-visit lists with route optimization
- [ ] Fleet replacement cycle predictions at 30/60/90 day horizons
- [ ] Revenue forecasting within 15% of actuals over 90-day window

---

## Phase 5 — Customer Portal & Autonomous Operations

**Priority**: MEDIUM
**Dependencies**: All prior phases fully operational

### 5.1 Customer Self-Service Portal
- Equipment fleet view, service history, warranty status, maintenance schedules
- Quote review and e-signature for repeat purchases
- Rental self-service: availability, booking, deposit, return scheduling
- Parts ordering for consumables with AI-suggested PM kits
- Service requests with photo upload
- Payment portal: invoices, online payment, statements
- Separate auth flow from internal users

### 5.2 Autonomous Marketing Engine
- Inventory event triggers (new arrivals → matching customer profiles)
- Seasonal campaign automation
- Customer-specific AI content based on DNA profiles
- Social media auto-posting (Facebook Marketplace)
- Competitor displacement campaigns

### 5.3 Equipment-as-a-Service (EaaS)
- Subscription-based rentals
- Predictive maintenance scheduling
- Usage-based pricing
- Automatic fleet rotation

---

## Architecture Constraints (Apply to All Phases)

### Zero-Blocking Integration Architecture
Every external integration (IntelliDealer, Machinery Trader, financing APIs, telematics) must have:
1. An admin configuration panel in the Integration Hub
2. A fallback adapter that provides manual entry or mock data
3. Clear live/demo/manual status indicators in the UI

### Database Conventions
- All new tables: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`
- `deleted_at timestamptz` for soft-delete where applicable
- RLS on every user-facing table using `get_my_role()` and `get_my_workspace()`
- Indexes with explicit purpose; no unbounded scans on list views
- Migration naming: `NNN_snake_case_name.sql` (3-digit prefix, next after 064)

### Edge Function Conventions
- Validate auth before business logic
- Return typed JSON; never leak internals
- Enforce role/workspace checks
- Keep idempotency for all mutation paths

### Frontend Conventions
- Keep existing app shell, navigation, shadcn/ui primitives
- Dark mode only with QEP Orange accents
- Mobile-first responsive design
- Feature-local API adapters
- Explicit loading, error, and empty states on every view

### Build Gates (Required Before Closing Any Slice)
1. `bun run build` from repo root
2. `bun run build` in `apps/web`
3. Edge function type check: `deno check supabase/functions/*/index.ts`
4. RLS verification on all touched tables
5. Role/workspace security check on all modified flows
