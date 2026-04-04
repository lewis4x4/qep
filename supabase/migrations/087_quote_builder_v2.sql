-- ============================================================================
-- Migration 087: Quote Builder V2 Supporting Tables
--
-- Zero-blocking inventory catalog + quote packaging + e-signature
-- ============================================================================

-- ── 1. Manual catalog for zero-blocking architecture ────────────────────────
-- When IntelliDealer is unavailable, quotes use manual/CSV-imported inventory.

create table public.catalog_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',

  -- Source
  source text not null default 'manual' check (source in ('intellidealer', 'manual', 'csv_import')),
  external_id text, -- IntelliDealer stock number if synced

  -- Equipment
  make text not null,
  model text not null,
  year integer,
  category text,
  stock_number text,
  serial_number text,

  -- Pricing
  list_price numeric,
  dealer_cost numeric,
  msrp numeric,

  -- Availability
  is_available boolean not null default true,
  branch text,
  condition text check (condition in ('new', 'used', 'certified_pre_owned')),

  -- Attachments
  attachments jsonb default '[]',
  -- [{name, price, description, compatible_models}]

  -- Media
  photos jsonb default '[]',
  brochure_url text,
  video_url text,

  -- Metadata
  imported_at timestamptz,
  last_synced_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.catalog_entries is 'Unified equipment catalog. Zero-blocking: works with manual entry when IntelliDealer unavailable.';

-- ── 2. Quote packages (quote + photos + brochure + credit app + video) ──────

create table public.quote_packages (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  deal_id uuid references public.crm_deals(id) on delete cascade,
  contact_id uuid references public.crm_contacts(id) on delete set null,

  -- Quote content
  equipment jsonb not null default '[]', -- [{catalog_entry_id, make, model, price, ...}]
  attachments_included jsonb default '[]', -- [{name, price}]
  trade_in_valuation_id uuid references public.trade_valuations(id) on delete set null,
  trade_allowance numeric,

  -- Financing
  financing_scenarios jsonb default '[]',
  -- [{type: 'cash'|'finance'|'lease', term_months, rate, monthly_payment, total_cost}]

  -- Totals
  equipment_total numeric default 0,
  attachment_total numeric default 0,
  subtotal numeric default 0,
  trade_credit numeric default 0,
  net_total numeric default 0,
  margin_amount numeric,
  margin_pct numeric,

  -- Package assets
  pdf_url text,
  pdf_generated_at timestamptz,
  photos_included jsonb default '[]',
  brochure_url text,
  credit_app_url text,
  video_url text,

  -- Status
  status text not null default 'draft' check (status in (
    'draft', 'ready', 'sent', 'viewed', 'accepted', 'rejected', 'expired'
  )),
  sent_at timestamptz,
  sent_via text, -- 'email', 'sms', 'in_person'
  expires_at timestamptz,

  -- AI recommendation
  ai_recommendation jsonb, -- {machine, attachments, reasoning}
  entry_mode text check (entry_mode in ('voice', 'ai_chat', 'manual')),

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.quote_packages is 'Complete quote packages per SOP: quote + photos + brochure + credit app + video link.';

-- ── 3. Quote signatures (e-signature at step 13) ───────────────────────────

create table public.quote_signatures (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  quote_package_id uuid not null references public.quote_packages(id) on delete cascade,
  deal_id uuid references public.crm_deals(id) on delete set null,

  -- Signer
  signer_name text not null,
  signer_email text,
  signer_ip text,
  signer_user_agent text,

  -- Signature
  signature_image_url text, -- Canvas capture stored in Supabase Storage
  signed_at timestamptz not null default now(),

  -- Verification
  document_hash text, -- SHA-256 of quote PDF at time of signing
  is_valid boolean not null default true,

  created_at timestamptz not null default now()
);

comment on table public.quote_signatures is 'E-signature records for sales order at pipeline step 13.';

-- ── 4. RLS ──────────────────────────────────────────────────────────────────

alter table public.catalog_entries enable row level security;
alter table public.quote_packages enable row level security;
alter table public.quote_signatures enable row level security;

create policy "catalog_select_workspace" on public.catalog_entries for select
  using (workspace_id = public.get_my_workspace());
create policy "catalog_modify_elevated" on public.catalog_entries for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin', 'manager', 'owner'))
  with check (workspace_id = public.get_my_workspace());
create policy "catalog_service" on public.catalog_entries for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "packages_workspace" on public.quote_packages for all
  using (workspace_id = public.get_my_workspace()) with check (workspace_id = public.get_my_workspace());
create policy "packages_service" on public.quote_packages for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- Signatures via package workspace
create or replace function public.signature_in_my_workspace(p_package_id uuid)
returns boolean
language sql security definer stable set search_path = ''
as $$
  select exists (
    select 1 from public.quote_packages qp
    where qp.id = p_package_id
    and qp.workspace_id = public.get_my_workspace()
  );
$$;
revoke execute on function public.signature_in_my_workspace(uuid) from public;
grant execute on function public.signature_in_my_workspace(uuid) to authenticated;

create policy "signatures_workspace" on public.quote_signatures for all
  using (public.signature_in_my_workspace(quote_package_id))
  with check (public.signature_in_my_workspace(quote_package_id));
create policy "signatures_service" on public.quote_signatures for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- ── 5. Indexes ──────────────────────────────────────────────────────────────

create index idx_catalog_workspace on public.catalog_entries(workspace_id);
create index idx_catalog_available on public.catalog_entries(is_available, category) where is_available = true;
create index idx_catalog_make_model on public.catalog_entries(make, model);
create index idx_catalog_source on public.catalog_entries(source);

create index idx_packages_workspace on public.quote_packages(workspace_id);
create index idx_packages_deal on public.quote_packages(deal_id) where deal_id is not null;
create index idx_packages_status on public.quote_packages(status) where status in ('draft', 'sent');

create index idx_signatures_package on public.quote_signatures(quote_package_id);

-- ── 6. Triggers ─────────────────────────────────────────────────────────────

create trigger set_catalog_updated_at before update on public.catalog_entries for each row execute function public.set_updated_at();
create trigger set_packages_updated_at before update on public.quote_packages for each row execute function public.set_updated_at();
