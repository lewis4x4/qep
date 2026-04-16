-- ============================================================================
-- Migration 290: QB Security Hardening
--
-- Post-289 fixes surfaced by supabase advisors:
--   1. crm_companies and crm_equipment views rebuilt in 283 lost security_invoker
--   2. Three QB functions (sequence helpers + rebate trigger) had mutable search_path
--
-- This migration is idempotent — safe to re-run.
-- ============================================================================

-- ── Views: restore security_invoker = true (RLS runs as querying user) ───────

alter view public.crm_companies set (security_invoker = true);
alter view public.crm_equipment set (security_invoker = true);

-- ── Functions: pin search_path to empty ─────────────────────────────────────

alter function public.generate_qb_quote_number() set search_path = '';
alter function public.generate_qb_deal_number() set search_path = '';
alter function public.qb_compute_rebate_due_date() set search_path = '';
