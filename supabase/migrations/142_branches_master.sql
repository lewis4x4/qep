-- ══════════════════════════════════════════════════════════════════════════════
-- 142 — Branches Master Directory
-- ══════════════════════════════════════════════════════════════════════════════
-- Single source of truth for every physical location. Every table that
-- references branch_id today uses a free-text slug — this migration creates
-- the canonical record and a useBranches() hook can now resolve full
-- address, contacts, managers, logo, hours, tax info for customer-facing
-- documents (quotes, invoices, receipts, service reports).
-- ══════════════════════════════════════════════════════════════════════════════

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',

  -- Slug used across existing tables (parts_inventory.branch_id, service_jobs.branch_id, etc.)
  slug text not null,

  -- Display name shown on documents and UI
  display_name text not null,
  short_code text,             -- 3-4 char abbreviation for labels/badges (e.g. "GD", "LC", "MY")

  -- Status
  is_active boolean not null default true,

  -- ── Physical address ────────────────────────────────────────────────────
  address_line1 text,
  address_line2 text,
  city text,
  state_province text,
  postal_code text,
  country text not null default 'US',
  latitude numeric(10, 7),
  longitude numeric(10, 7),

  -- ── Contact info ────────────────────────────────────────────────────────
  phone_main text,
  phone_parts text,
  phone_service text,
  phone_sales text,
  fax text,
  email_main text,
  email_parts text,
  email_service text,
  email_sales text,
  website_url text,

  -- ── Manager assignments (FK to profiles) ────────────────────────────────
  general_manager_id uuid references public.profiles(id) on delete set null,
  sales_manager_id uuid references public.profiles(id) on delete set null,
  service_manager_id uuid references public.profiles(id) on delete set null,
  parts_manager_id uuid references public.profiles(id) on delete set null,

  -- ── Business hours (JSONB: array of {dow, open, close}) ─────────────────
  business_hours jsonb not null default '[]'::jsonb,

  -- ── Branding / document header ──────────────────────────────────────────
  logo_url text,               -- URL to branch logo (Supabase Storage or external CDN)
  header_tagline text,         -- tagline printed under logo on docs
  doc_footer_text text,        -- fine-print / disclaimer on invoices/quotes

  -- ── Tax / regulatory ────────────────────────────────────────────────────
  tax_id text,                 -- EIN / state tax number
  default_tax_rate numeric(6, 4) default 0,
  license_numbers jsonb not null default '[]'::jsonb,   -- [{type, number, expiry}]

  -- ── Capabilities ────────────────────────────────────────────────────────
  capabilities jsonb not null default '[]'::jsonb,  -- ["parts_counter", "service_bay", "rental_yard", ...]
  max_service_bays integer,
  rental_yard_capacity integer,
  parts_counter boolean not null default true,

  -- ── Geo / logistics ─────────────────────────────────────────────────────
  delivery_radius_miles integer,
  timezone text not null default 'America/Chicago',

  -- ── Metadata ────────────────────────────────────────────────────────────
  notes text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  unique (workspace_id, slug)
);

comment on table public.branches is
  'Master directory for every physical store/branch location. Canonical source for address, contacts, managers, branding, and document templates.';

-- ── Indexes ─────────────────────────────────────────────────────────────────

create index idx_branches_ws_active on public.branches(workspace_id)
  where is_active = true and deleted_at is null;

-- ── Triggers ────────────────────────────────────────────────────────────────

create trigger set_branches_updated_at
  before update on public.branches
  for each row execute function public.set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.branches enable row level security;

create policy "branches_select" on public.branches for select
  using (workspace_id = public.get_my_workspace());

create policy "branches_insert" on public.branches for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "branches_update" on public.branches for update
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "branches_delete" on public.branches for delete
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "branches_service_all" on public.branches for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ══════════════════════════════════════════════════════════════════════════════
-- Helper: resolve full branch record by slug (used by edge functions / docs)
-- ══════════════════════════════════════════════════════════════════════════════

create or replace function public.get_branch_by_slug(
  p_workspace_id text,
  p_slug text
)
returns public.branches
language sql
stable
security invoker
set search_path = public
as $$
  select *
  from public.branches
  where workspace_id = p_workspace_id
    and slug = p_slug
    and deleted_at is null
  limit 1;
$$;

comment on function public.get_branch_by_slug(text, text) is
  'Resolve a full branch record from the slug used across parts_inventory, service_jobs, etc.';
