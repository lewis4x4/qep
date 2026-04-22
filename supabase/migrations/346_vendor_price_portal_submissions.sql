-- ============================================================================
-- Migration 346: Vendor pricing portal submissions
--
-- Rollback notes:
--   1. Drop triggers set_vendor_portal_access_keys_updated_at and
--      set_parts_vendor_price_submissions_updated_at.
--   2. Drop indexes idx_vendor_portal_access_keys_vendor_active,
--      idx_vendor_portal_access_keys_hash,
--      idx_parts_vendor_price_submissions_vendor_status,
--      idx_parts_vendor_price_submissions_pending.
--   3. Drop policies on public.vendor_portal_access_keys and
--      public.parts_vendor_price_submissions.
--   4. Drop tables public.parts_vendor_price_submissions and
--      public.vendor_portal_access_keys.
-- ============================================================================

create table public.vendor_portal_access_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  vendor_id uuid not null references public.vendor_profiles(id) on delete cascade,
  label text,
  contact_name text,
  contact_email text,
  access_key_hash text not null unique,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.vendor_portal_access_keys is
  'One-time vendor pricing portal access keys. Raw keys are shown once and only the hash is stored.';

create index idx_vendor_portal_access_keys_vendor_active
  on public.vendor_portal_access_keys(vendor_id, expires_at)
  where revoked_at is null;

create index idx_vendor_portal_access_keys_hash
  on public.vendor_portal_access_keys(access_key_hash);

alter table public.vendor_portal_access_keys enable row level security;

create policy "vpak_select"
  on public.vendor_portal_access_keys for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "vpak_mutate"
  on public.vendor_portal_access_keys for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "vpak_service_all"
  on public.vendor_portal_access_keys for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_vendor_portal_access_keys_updated_at
  before update on public.vendor_portal_access_keys
  for each row execute function public.set_updated_at();

create table public.parts_vendor_price_submissions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  vendor_id uuid not null references public.vendor_profiles(id) on delete cascade,
  access_key_id uuid references public.vendor_portal_access_keys(id) on delete set null,
  part_number text not null,
  description text,
  proposed_list_price numeric(14, 4) not null check (proposed_list_price >= 0),
  currency text not null default 'USD',
  effective_date date not null default current_date,
  submission_notes text,
  submitted_by_name text,
  submitted_by_email text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  applied_vendor_price_id uuid references public.parts_vendor_prices(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.parts_vendor_price_submissions is
  'Vendor-submitted price proposals awaiting internal approval before they update the active vendor price file.';

create index idx_parts_vendor_price_submissions_vendor_status
  on public.parts_vendor_price_submissions(vendor_id, status, created_at desc);

create index idx_parts_vendor_price_submissions_pending
  on public.parts_vendor_price_submissions(workspace_id, status, created_at desc)
  where status = 'pending';

alter table public.parts_vendor_price_submissions enable row level security;

create policy "pvps_select"
  on public.parts_vendor_price_submissions for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "pvps_mutate"
  on public.parts_vendor_price_submissions for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "pvps_service_all"
  on public.parts_vendor_price_submissions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_parts_vendor_price_submissions_updated_at
  before update on public.parts_vendor_price_submissions
  for each row execute function public.set_updated_at();
