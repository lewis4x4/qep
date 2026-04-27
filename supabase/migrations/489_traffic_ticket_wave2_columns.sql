-- 489_traffic_ticket_wave2_columns.sql
-- Wave 2 traffic ticket extensions from Cross-Cutting and Phase-9.
-- Non-destructive additive path: existing ticket_type/status/department are not rewritten.

-- New enum types apply only to new columns.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'traffic_direction') then
    create type public.traffic_direction as enum ('inbound','outbound','transfer');
  end if;
  if not exists (select 1 from pg_type where typname = 'traffic_receipt_type') then
    create type public.traffic_receipt_type as enum ('demo','loaner','rental','transfer','sale','purchase','service','trade_in','miscellaneous','rerent','customer_transfer','job_site_transfer');
  end if;
end $$;

alter table public.traffic_tickets
  add column if not exists company_id uuid references public.qrm_companies(id) on delete set null,
  add column if not exists receipt_number text,
  add column if not exists received_at timestamptz,
  add column if not exists direction public.traffic_direction,
  add column if not exists receipt_type public.traffic_receipt_type,
  add column if not exists subtype_code text,
  add column if not exists unit_description_snapshot text,
  add column if not exists make_snapshot text,
  add column if not exists model_snapshot text,
  add column if not exists serial_number_snapshot text,
  add column if not exists equipment_group_code text,
  add column if not exists from_branch_id uuid references public.branches(id) on delete set null,
  add column if not exists from_city text,
  add column if not exists from_state text,
  add column if not exists to_branch_id uuid references public.branches(id) on delete set null,
  add column if not exists to_customer_id uuid references public.qrm_companies(id) on delete set null,
  add column if not exists to_city text,
  add column if not exists to_state text,
  add column if not exists from_address text,
  add column if not exists return_agreement_ref text,
  add column if not exists return_due_date date,
  add column if not exists salesperson_id uuid references public.employees(id) on delete set null,
  add column if not exists printed_count integer not null default 0,
  add column if not exists last_printed_at timestamptz,
  add column if not exists move_mode text,
  add column if not exists priority_code text,
  add column if not exists units_count integer default 1,
  add column if not exists created_by_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists trucker_vendor_id uuid references public.vendor_profiles(id) on delete set null,
  add column if not exists trucker_code text,
  add column if not exists ship_job_site_id uuid,
  add column if not exists ship_job_site_name text,
  add column if not exists ship_map_book text,
  add column if not exists ship_map_page text,
  add column if not exists ship_map_grid text,
  add column if not exists ship_postal_code text,
  add column if not exists ship_country text,
  add column if not exists ship_state text,
  add column if not exists ship_county text,
  add column if not exists estimated_shipping_charge_cents integer,
  add column if not exists actual_shipping_charge_cents integer,
  add column if not exists ship_instructions text,
  add column if not exists multimedia_assets jsonb default '[]'::jsonb;

comment on column public.traffic_tickets.company_id is 'Customer/company associated with the traffic ticket for Account 360 recent-traffic tile.';
comment on column public.traffic_tickets.receipt_number is 'IntelliDealer traffic receipt number.';
comment on column public.traffic_tickets.direction is 'Inbound/outbound/transfer direction without rewriting existing ticket_type.';
comment on column public.traffic_tickets.receipt_type is 'IntelliDealer traffic type taxonomy without rewriting existing ticket_type.';
comment on column public.traffic_tickets.salesperson_id is 'Employee salesperson associated with the movement/receipt.';
comment on column public.traffic_tickets.trucker_vendor_id is 'Vendor/trucker assigned to the movement.';
comment on column public.traffic_tickets.multimedia_assets is 'Traffic multimedia/attachments metadata; delivery photos/signature remain intact.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'traffic_tickets_department_values_chk') then
    alter table public.traffic_tickets
      add constraint traffic_tickets_department_values_chk
      check (department is null or department in ('equipment','service','rental','parts')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'traffic_tickets_move_mode_chk') then
    alter table public.traffic_tickets
      add constraint traffic_tickets_move_mode_chk
      check (move_mode is null or move_mode in ('pickup','delivery')) not valid;
  end if;
end $$;

create unique index if not exists idx_traffic_tickets_receipt_number
  on public.traffic_tickets (workspace_id, receipt_number)
  where receipt_number is not null;
comment on index public.idx_traffic_tickets_receipt_number is 'Purpose: exact receipt-number lookup in Traffic Management.';

create index if not exists idx_traffic_tickets_company
  on public.traffic_tickets (workspace_id, company_id, shipping_date desc)
  where company_id is not null;
comment on index public.idx_traffic_tickets_company is 'Purpose: Account 360 recent traffic tile.';

create index if not exists idx_traffic_tickets_branch_route
  on public.traffic_tickets (workspace_id, from_branch_id, to_branch_id, requested_at desc);
comment on index public.idx_traffic_tickets_branch_route is 'Purpose: weekly/monthly traffic route filters by from/to branch.';
