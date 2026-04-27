-- 474_qrm_equipment_wave2_columns.sql
-- Wave 2 column extensions for qrm_equipment from Phase-2 Sales Intelligence.

do $$
begin
  if exists (select 1 from pg_type where typname = 'crm_equipment_availability') then
    alter type public.crm_equipment_availability add value if not exists 'invoiced';
    alter type public.crm_equipment_availability add value if not exists 'on_order';
    alter type public.crm_equipment_availability add value if not exists 'presold';
    alter type public.crm_equipment_availability add value if not exists 'consignment';
    alter type public.crm_equipment_availability add value if not exists 'transferred';
  end if;
  if not exists (select 1 from pg_type where typname = 'equipment_in_out') then
    create type public.equipment_in_out as enum ('in','out','sold');
  end if;
  if not exists (select 1 from pg_type where typname = 'inventory_count_method') then
    create type public.inventory_count_method as enum ('visual','scan','rfid','telematics');
  end if;
  if not exists (select 1 from pg_type where typname = 'inventory_type') then
    create type public.inventory_type as enum ('new','used','trade_in','consignment','demo','rental_fleet');
  end if;
end $$;

alter table public.qrm_equipment
  add column if not exists stock_number text,
  add column if not exists base_code_id uuid references public.equipment_base_codes(id) on delete set null,
  add column if not exists engine_serial_number text,
  add column if not exists transmission_serial_number text,
  add column if not exists control_number text,
  add column if not exists in_out_state public.equipment_in_out,
  add column if not exists in_out_sub_type text,
  add column if not exists class_code text,
  add column if not exists type_code text,
  add column if not exists group_code text,
  add column if not exists subclass_code text,
  add column if not exists home_branch_id uuid references public.branches(id) on delete set null,
  add column if not exists supplier_invoice_number text,
  add column if not exists supplier_invoice_date date,
  add column if not exists supplier_invoice_amount_cents bigint,
  add column if not exists current_cost_cents bigint,
  add column if not exists net_book_value_cents bigint,
  add column if not exists reference_amount_cents bigint,
  add column if not exists note_amount_cents bigint,
  add column if not exists note_code text,
  add column if not exists note_due_date date,
  add column if not exists finance_amount_cents bigint,
  add column if not exists finance_due_date date,
  add column if not exists settlement_number text,
  add column if not exists settlement_date date,
  add column if not exists maintenance_expense_cents bigint,
  add column if not exists rental_cost_pct numeric(5, 2),
  add column if not exists rental_insurable_amount_cents bigint,
  add column if not exists rental_amount_cents bigint,
  add column if not exists sale_gl_account text,
  add column if not exists inventory_gl_account text,
  add column if not exists avatax_product_code text,
  add column if not exists last_count_method public.inventory_count_method,
  add column if not exists last_count_at date,
  add column if not exists ordered_reserved_at date,
  add column if not exists rental_fleet_date date,
  add column if not exists delivery_date date,
  add column if not exists traded_date date,
  add column if not exists assigned_salesperson_id uuid references public.profiles(id) on delete set null,
  add column if not exists customer_fleet_number text,
  add column if not exists inventory_type public.inventory_type,
  add column if not exists price_matrix_id uuid references public.price_matrices(id) on delete set null;

comment on column public.qrm_equipment.stock_number is 'IntelliDealer/EMASTR alphanumeric stock # preserved through migration.';
comment on column public.qrm_equipment.base_code_id is 'Wave 1 Base & Options catalog linkage for OEM order portal compatibility.';
comment on column public.qrm_equipment.current_cost_cents is 'Current cost in cents for equipment margin and floorplan reporting.';
comment on column public.qrm_equipment.sale_gl_account is 'Equipment sale GL account from IntelliDealer profile.';
comment on column public.qrm_equipment.inventory_gl_account is 'Equipment inventory GL account from IntelliDealer profile.';
comment on column public.qrm_equipment.avatax_product_code is 'AvaTax product code for equipment tax decisions.';

create unique index if not exists idx_qrm_equipment_stock_number
  on public.qrm_equipment (workspace_id, stock_number)
  where stock_number is not null;
comment on index public.idx_qrm_equipment_stock_number is 'Purpose: exact stock-number lookup from Equipment Listing and Sales Support Portal.';

create index if not exists idx_qrm_equipment_engine_serial
  on public.qrm_equipment (workspace_id, engine_serial_number)
  where engine_serial_number is not null;
comment on index public.idx_qrm_equipment_engine_serial is 'Purpose: engine serial search on Equipment Profile.';

create index if not exists idx_qrm_equipment_home_branch
  on public.qrm_equipment (home_branch_id)
  where home_branch_id is not null;
comment on index public.idx_qrm_equipment_home_branch is 'Purpose: Equipment Listing location/home branch filter.';

create index if not exists idx_qrm_equipment_avatax_product
  on public.qrm_equipment (workspace_id, avatax_product_code)
  where avatax_product_code is not null;
comment on index public.idx_qrm_equipment_avatax_product is 'Purpose: tax-product reconciliation for AvaTax equipment invoices.';

create index if not exists idx_qrm_equipment_price_matrix
  on public.qrm_equipment (workspace_id, price_matrix_id)
  where price_matrix_id is not null;
comment on index public.idx_qrm_equipment_price_matrix is 'Purpose: equipment price matrix automation and listing filters.';
