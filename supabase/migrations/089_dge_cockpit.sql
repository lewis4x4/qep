-- ============================================================================
-- Migration 089: DGE Cockpit + Advanced Pipeline
--
-- 1. Add sort_position to crm_deals for within-column reorder
-- ============================================================================

alter table public.crm_deals
  add column if not exists sort_position integer default 0;

comment on column public.crm_deals.sort_position is 'Within-column sort position for Kanban reordering';

create index if not exists idx_crm_deals_sort_position on public.crm_deals(stage_id, sort_position);
