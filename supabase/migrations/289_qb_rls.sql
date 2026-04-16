-- ============================================================================
-- Migration 289: QB RLS Policies
--
-- Policies on all 12 new QB tables + 7 audit tables.
-- Pattern:
--   - Service role bypass on every table
--   - Catalog tables (brands/models/attachments/freight/programs/stacking):
--     read = any authenticated, write = admin/manager/owner
--   - Quote/deal/trade-in tables: read = team-wide (rep+), write = scoped
--   - Price sheets: admin/manager/owner only
--   - Audit tables: read = admin/manager/owner, no user writes (trigger only)
--
-- All policies use public.get_my_role() and public.get_my_workspace().
-- Role values: 'rep','admin','manager','owner' (the user_role enum).
-- ============================================================================

-- ── Enable RLS ───────────────────────────────────────────────────────────────

alter table public.qb_brands                  enable row level security;
alter table public.qb_equipment_models        enable row level security;
alter table public.qb_attachments             enable row level security;
alter table public.qb_freight_zones           enable row level security;
alter table public.qb_programs                enable row level security;
alter table public.qb_program_stacking_rules  enable row level security;
alter table public.qb_quotes                  enable row level security;
alter table public.qb_quote_line_items        enable row level security;
alter table public.qb_deals                   enable row level security;
alter table public.qb_trade_ins               enable row level security;
alter table public.qb_price_sheets            enable row level security;
alter table public.qb_price_sheet_items       enable row level security;
alter table public.qb_quotes_audit            enable row level security;
alter table public.qb_deals_audit             enable row level security;
alter table public.qb_brands_audit            enable row level security;
alter table public.qb_equipment_models_audit  enable row level security;
alter table public.qb_attachments_audit       enable row level security;
alter table public.qb_programs_audit          enable row level security;
alter table public.qb_price_sheets_audit      enable row level security;

-- ── Service role bypass (every table) ────────────────────────────────────────

create policy "qb_brands_service"                 on public.qb_brands                 for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_equipment_models_service"       on public.qb_equipment_models       for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_attachments_service"            on public.qb_attachments            for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_freight_zones_service"          on public.qb_freight_zones          for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_programs_service"               on public.qb_programs               for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_program_stacking_rules_service" on public.qb_program_stacking_rules for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_quotes_service"                 on public.qb_quotes                 for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_quote_line_items_service"       on public.qb_quote_line_items       for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_deals_service"                  on public.qb_deals                  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_trade_ins_service"              on public.qb_trade_ins              for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_price_sheets_service"           on public.qb_price_sheets           for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_price_sheet_items_service"      on public.qb_price_sheet_items      for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_quotes_audit_service"           on public.qb_quotes_audit           for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_deals_audit_service"            on public.qb_deals_audit            for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_brands_audit_service"           on public.qb_brands_audit           for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_equipment_models_audit_service" on public.qb_equipment_models_audit for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_attachments_audit_service"      on public.qb_attachments_audit      for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_programs_audit_service"         on public.qb_programs_audit         for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_price_sheets_audit_service"     on public.qb_price_sheets_audit     for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- ── Catalog tables: read by all authenticated, write by elevated ─────────────

create policy "qb_brands_select" on public.qb_brands for select
  using (workspace_id = public.get_my_workspace() and auth.uid() is not null);
create policy "qb_brands_write" on public.qb_brands for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin','manager','owner'))
  with check (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin','manager','owner'));

create policy "qb_equipment_models_select" on public.qb_equipment_models for select
  using (workspace_id = public.get_my_workspace() and auth.uid() is not null);
create policy "qb_equipment_models_write" on public.qb_equipment_models for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin','manager','owner'))
  with check (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin','manager','owner'));

create policy "qb_attachments_select" on public.qb_attachments for select
  using (workspace_id = public.get_my_workspace() and auth.uid() is not null);
create policy "qb_attachments_write" on public.qb_attachments for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin','manager','owner'))
  with check (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin','manager','owner'));

create policy "qb_freight_zones_select" on public.qb_freight_zones for select
  using (workspace_id = public.get_my_workspace() and auth.uid() is not null);
create policy "qb_freight_zones_write" on public.qb_freight_zones for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin','manager','owner'))
  with check (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin','manager','owner'));

create policy "qb_programs_select" on public.qb_programs for select
  using (workspace_id = public.get_my_workspace() and auth.uid() is not null);
create policy "qb_programs_write" on public.qb_programs for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin','manager','owner'))
  with check (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin','manager','owner'));

-- Stacking rules: global (no workspace), auth required
create policy "qb_program_stacking_rules_select" on public.qb_program_stacking_rules for select
  using (auth.uid() is not null);
create policy "qb_program_stacking_rules_write" on public.qb_program_stacking_rules for all
  using (public.get_my_role() in ('admin','manager','owner'))
  with check (public.get_my_role() in ('admin','manager','owner'));

-- ── qb_quotes: team-wide read, scoped write (Rylee confirmed) ────────────────

create policy "qb_quotes_select" on public.qb_quotes for select
  using (workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep','admin','manager','owner'));

create policy "qb_quotes_insert" on public.qb_quotes for insert
  with check (workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep','admin','manager','owner'));

create policy "qb_quotes_update" on public.qb_quotes for update
  using (workspace_id = public.get_my_workspace()
    and (public.get_my_role() in ('admin','manager','owner')
         or (public.get_my_role() = 'rep' and salesman_id = auth.uid())));

create policy "qb_quotes_delete" on public.qb_quotes for delete
  using (workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin','manager','owner'));

create policy "qb_quote_line_items_select" on public.qb_quote_line_items for select
  using (workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep','admin','manager','owner'));

create policy "qb_quote_line_items_write" on public.qb_quote_line_items for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('rep','admin','manager','owner'))
  with check (workspace_id = public.get_my_workspace() and public.get_my_role() in ('rep','admin','manager','owner'));

-- ── qb_deals: team-wide read, scoped write ───────────────────────────────────

create policy "qb_deals_select" on public.qb_deals for select
  using (workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep','admin','manager','owner'));

create policy "qb_deals_insert" on public.qb_deals for insert
  with check (workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep','admin','manager','owner'));

create policy "qb_deals_update" on public.qb_deals for update
  using (workspace_id = public.get_my_workspace()
    and (public.get_my_role() in ('admin','manager','owner')
         or (public.get_my_role() = 'rep' and salesman_id = auth.uid() and status = 'active')));

create policy "qb_deals_delete" on public.qb_deals for delete
  using (workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin','manager','owner'));

create policy "qb_trade_ins_select" on public.qb_trade_ins for select
  using (workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep','admin','manager','owner'));

create policy "qb_trade_ins_write" on public.qb_trade_ins for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('rep','admin','manager','owner'))
  with check (workspace_id = public.get_my_workspace() and public.get_my_role() in ('rep','admin','manager','owner'));

-- ── qb_price_sheets: admin/manager/owner only ────────────────────────────────

create policy "qb_price_sheets_select" on public.qb_price_sheets for select
  using (workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin','manager','owner'));

create policy "qb_price_sheets_write" on public.qb_price_sheets for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin','manager','owner'))
  with check (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin','manager','owner'));

create policy "qb_price_sheet_items_select" on public.qb_price_sheet_items for select
  using (workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin','manager','owner'));

create policy "qb_price_sheet_items_write" on public.qb_price_sheet_items for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin','manager','owner'))
  with check (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin','manager','owner'));

-- ── Audit tables: read-only for admin/manager/owner. Writes via trigger only. ──

create policy "qb_quotes_audit_select"           on public.qb_quotes_audit           for select using (public.get_my_role() in ('admin','manager','owner'));
create policy "qb_deals_audit_select"            on public.qb_deals_audit            for select using (public.get_my_role() in ('admin','manager','owner'));
create policy "qb_brands_audit_select"           on public.qb_brands_audit           for select using (public.get_my_role() in ('admin','manager','owner'));
create policy "qb_equipment_models_audit_select" on public.qb_equipment_models_audit for select using (public.get_my_role() in ('admin','manager','owner'));
create policy "qb_attachments_audit_select"      on public.qb_attachments_audit      for select using (public.get_my_role() in ('admin','manager','owner'));
create policy "qb_programs_audit_select"         on public.qb_programs_audit         for select using (public.get_my_role() in ('admin','manager','owner'));
create policy "qb_price_sheets_audit_select"     on public.qb_price_sheets_audit     for select using (public.get_my_role() in ('admin','manager','owner'));
