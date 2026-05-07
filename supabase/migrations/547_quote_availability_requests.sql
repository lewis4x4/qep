-- ============================================================================
-- 547_quote_availability_requests.sql
--
-- Turns Quote Builder availability from a local UI marker into a durable
-- sourcing request workflow. Requests may be created before the quote package
-- is saved, then linked to quote_package_line_items after the save sync.
-- ============================================================================

create table if not exists public.quote_availability_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  quote_package_id uuid references public.quote_packages(id) on delete cascade,
  quote_line_item_id uuid references public.quote_package_line_items(id) on delete set null,
  catalog_model_id uuid references public.qb_equipment_models(id) on delete set null,
  client_line_key text,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  assigned_to uuid references public.profiles(id) on delete set null,
  status text not null default 'pending'
    check (status in (
      'pending',
      'checking_internal_inventory',
      'checking_vendor',
      'available',
      'available_with_conditions',
      'alternative_recommended',
      'not_available',
      'cancelled'
    )),
  urgency text not null default 'normal'
    check (urgency in ('low', 'normal', 'rush', 'customer_waiting')),
  customer_need text,
  requested_machine_label text not null,
  requested_budget numeric,
  requested_timeline text,
  availability_eta text,
  decision_note text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_quote_availability_requests_updated_at
  before update on public.quote_availability_requests
  for each row execute function public.set_updated_at();

create index if not exists idx_quote_availability_requests_quote
  on public.quote_availability_requests (quote_package_id, created_at desc)
  where quote_package_id is not null;

create index if not exists idx_quote_availability_requests_status
  on public.quote_availability_requests (workspace_id, status, created_at desc);

create index if not exists idx_quote_availability_requests_catalog
  on public.quote_availability_requests (workspace_id, catalog_model_id, status)
  where catalog_model_id is not null;

create unique index if not exists uq_quote_availability_active_quote_line
  on public.quote_availability_requests (workspace_id, quote_package_id, client_line_key)
  where quote_package_id is not null
    and client_line_key is not null
    and status in ('pending', 'checking_internal_inventory', 'checking_vendor');

create table if not exists public.quote_availability_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  request_id uuid not null references public.quote_availability_requests(id) on delete cascade,
  candidate_type text not null
    check (candidate_type in (
      'exact_catalog_model',
      'owned_inventory',
      'branch_transfer',
      'vendor_order',
      'rental_conversion',
      'equivalent_catalog_model'
    )),
  catalog_model_id uuid references public.qb_equipment_models(id) on delete set null,
  equipment_id uuid references public.qrm_equipment(id) on delete set null,
  score numeric not null default 0,
  availability_status text not null default 'source_required'
    check (availability_status in ('available', 'in_transit', 'source_required', 'not_available', 'unknown')),
  eta_days integer,
  estimated_cost numeric,
  estimated_margin numeric,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_quote_availability_candidates_request
  on public.quote_availability_candidates (request_id, score desc, created_at);

create index if not exists idx_quote_availability_candidates_catalog
  on public.quote_availability_candidates (workspace_id, catalog_model_id)
  where catalog_model_id is not null;

alter table public.quote_availability_requests enable row level security;
alter table public.quote_availability_candidates enable row level security;

create policy "qar_service_all" on public.quote_availability_requests
  for all to service_role using (true) with check (true);

create policy "qar_select" on public.quote_availability_requests
  for select using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('rep', 'admin', 'manager', 'owner')
  );

create policy "qar_insert" on public.quote_availability_requests
  for insert with check (
    workspace_id = (select public.get_my_workspace())
    and requested_by = (select auth.uid())
    and (select public.get_my_role()) in ('rep', 'admin', 'manager', 'owner')
  );

create policy "qar_rep_update_own_pending" on public.quote_availability_requests
  for update using (
    workspace_id = (select public.get_my_workspace())
    and requested_by = (select auth.uid())
    and status in ('pending', 'checking_internal_inventory', 'checking_vendor')
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and requested_by = (select auth.uid())
  );

create policy "qar_manage" on public.quote_availability_requests
  for all using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'manager', 'owner')
  )
  with check (workspace_id = (select public.get_my_workspace()));

create policy "qacand_service_all" on public.quote_availability_candidates
  for all to service_role using (true) with check (true);

create policy "qacand_select" on public.quote_availability_candidates
  for select using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('rep', 'admin', 'manager', 'owner')
  );

create policy "qacand_manage" on public.quote_availability_candidates
  for all using (
    workspace_id = (select public.get_my_workspace())
    and (select public.get_my_role()) in ('admin', 'manager', 'owner')
  )
  with check (workspace_id = (select public.get_my_workspace()));

comment on table public.quote_availability_requests is
  'Backend-backed sourcing workflow for Quote Builder equipment availability requests.';

comment on table public.quote_availability_candidates is
  'Catalog, inventory, transfer, vendor, and equivalent alternatives proposed for a quote availability request.';
