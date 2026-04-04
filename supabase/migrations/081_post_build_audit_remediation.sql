-- ============================================================================
-- Migration 081: Post-Build Audit Remediation
--
-- Fixes identified by comprehensive code audit:
-- 1. Missing workspace_id indexes on 6 RLS-filtered tables
-- 2. Missing FK column indexes across multiple tables
-- 3. Missing updated_at trigger on payment_validations
-- 4. NOT NULL constraints on deposits.equipment_value + required_amount
-- ============================================================================

-- ═══ 1. CRITICAL: Missing workspace_id Indexes (RLS Performance) ═══════════
-- These tables use workspace_id in RLS USING clauses but lack an index,
-- causing full-table scans on every query.

create index if not exists idx_deposits_workspace on public.deposits(workspace_id);
create index if not exists idx_voice_qrm_results_workspace on public.voice_qrm_results(workspace_id);
create index if not exists idx_escalation_tickets_workspace on public.escalation_tickets(workspace_id);
create index if not exists idx_equipment_intake_workspace on public.equipment_intake(workspace_id);
create index if not exists idx_rental_returns_workspace on public.rental_returns(workspace_id);
create index if not exists idx_payment_validations_workspace on public.payment_validations(workspace_id);
create index if not exists idx_predictive_visit_lists_workspace on public.predictive_visit_lists(workspace_id);

-- Also add workspace indexes for tables that only had partial coverage:
create index if not exists idx_needs_assessments_workspace on public.needs_assessments(workspace_id);
create index if not exists idx_demos_workspace on public.demos(workspace_id);
create index if not exists idx_trade_valuations_workspace on public.trade_valuations(workspace_id);
create index if not exists idx_traffic_tickets_workspace on public.traffic_tickets(workspace_id);
create index if not exists idx_prospecting_visits_workspace on public.prospecting_visits(workspace_id);
create index if not exists idx_prospecting_kpis_workspace on public.prospecting_kpis(workspace_id);

-- ═══ 2. HIGH: Missing FK Column Indexes ════════════════════════════════════
-- FK columns used in joins and lookups that lack indexes.

-- deposits
create index if not exists idx_deposits_verified_by on public.deposits(verified_by) where verified_by is not null;
create index if not exists idx_deposits_created_by on public.deposits(created_by) where created_by is not null;

-- needs_assessments
create index if not exists idx_needs_assessments_created_by on public.needs_assessments(created_by) where created_by is not null;

-- demos
create index if not exists idx_demos_requested_by on public.demos(requested_by) where requested_by is not null;
create index if not exists idx_demos_approved_by on public.demos(approved_by) where approved_by is not null;
create index if not exists idx_demos_equipment on public.demos(equipment_id) where equipment_id is not null;

-- demo_inspections
create index if not exists idx_demo_inspections_inspector on public.demo_inspections(inspector_id) where inspector_id is not null;

-- trade_valuations
create index if not exists idx_trade_valuations_created_by on public.trade_valuations(created_by) where created_by is not null;

-- escalation_tickets
create index if not exists idx_escalation_tickets_escalated_by on public.escalation_tickets(escalated_by) where escalated_by is not null;

-- traffic_tickets
create index if not exists idx_traffic_tickets_coordinator on public.traffic_tickets(coordinator_id) where coordinator_id is not null;
create index if not exists idx_traffic_tickets_requested_by on public.traffic_tickets(requested_by) where requested_by is not null;

-- rental_returns
create index if not exists idx_rental_returns_equipment on public.rental_returns(equipment_id) where equipment_id is not null;

-- ═══ 3. HIGH: Missing updated_at Trigger ═══════════════════════════════════

-- payment_validations has no updated_at column, so no trigger needed.
-- (Audit finding was incorrect — table uses created_at only, which is correct
-- since payment validations are immutable log entries.)

-- ═══ 4. HIGH: NOT NULL Constraints on Critical Deposit Columns ═════════════

-- deposits.equipment_value and required_amount must not be null
-- (they're used in the deposit tier calculation and HARD GATE logic)
-- These already have NOT NULL from the CREATE TABLE, verified:
-- equipment_value numeric NOT NULL  (line 25 of migration 070)
-- required_amount numeric NOT NULL  (line 26 of migration 070)
-- No action needed — audit finding was incorrect.
