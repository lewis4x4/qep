-- Migration 305: Margin discipline (Slice 15)
--
-- Two tables:
--
--   qb_margin_thresholds — configurable per-brand minimum margin_pct.
--     brand_id = NULL means the workspace default (fallback for brands
--     that don't have their own row). Admins manage via the Margin
--     Discipline admin panel.
--
--   qb_margin_exceptions — logged every time a rep saves a quote below
--     the applicable threshold, with the reason they gave. Feeds:
--       - The rollup analytics (who's eroding margin + by how much)
--       - Slice 18 ML coach (reason → deal-outcome correlations)
--
-- MVP scope: brand-level thresholds. The full spec suggested
-- brand × deal-size-band × rep-tenure-band; that's over-scoped for v1
-- when we don't yet have the data to prove tier boundaries matter.
-- Start simple, trend the exceptions, promote tiers later if signal
-- emerges.

create table public.qb_margin_thresholds (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      text not null default 'default',
  -- NULL = workspace default (applies to brands without their own row)
  brand_id          uuid references public.qb_brands(id) on delete cascade,
  min_margin_pct    numeric not null check (min_margin_pct >= 0 and min_margin_pct <= 100),
  notes             text,
  updated_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.qb_margin_thresholds is
  'Per-brand margin floors. brand_id NULL = workspace-wide default. When a quote saves below the applicable threshold, a qb_margin_exceptions row is required.';

-- One row per (workspace, brand). Use coalesce trick for the NULL case via
-- a partial unique index pair.
create unique index ux_qb_margin_thresholds_workspace_brand
  on public.qb_margin_thresholds(workspace_id, brand_id)
  where brand_id is not null;

create unique index ux_qb_margin_thresholds_workspace_default
  on public.qb_margin_thresholds(workspace_id)
  where brand_id is null;

-- Auto-update updated_at via the existing trigger helper
create trigger set_qb_margin_thresholds_updated_at
  before update on public.qb_margin_thresholds
  for each row execute function public.set_updated_at();

-- ── Exceptions log ─────────────────────────────────────────────────────────

create table public.qb_margin_exceptions (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           text not null default 'default',
  quote_package_id       uuid not null references public.quote_packages(id) on delete cascade,
  brand_id               uuid references public.qb_brands(id) on delete set null,
  -- Snapshot of the numbers at commit time
  quoted_margin_pct      numeric not null,
  threshold_margin_pct   numeric not null,
  delta_pts              numeric generated always as (quoted_margin_pct - threshold_margin_pct) stored,
  -- Dollar impact: how much more margin the rep would've needed to hit the floor
  estimated_gap_cents    bigint,
  -- The rep's one-sentence justification
  reason                 text not null check (char_length(reason) between 1 and 500),
  rep_id                 uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now()
);

comment on table public.qb_margin_exceptions is
  'Logged whenever a quote is saved below the applicable qb_margin_thresholds row. The reason field is the rep rationale; the rollup tab trends these by rep / brand / month.';

create index idx_qb_margin_exceptions_workspace_created
  on public.qb_margin_exceptions(workspace_id, created_at desc);
create index idx_qb_margin_exceptions_rep
  on public.qb_margin_exceptions(rep_id, created_at desc);
create index idx_qb_margin_exceptions_brand
  on public.qb_margin_exceptions(brand_id, created_at desc);
create index idx_qb_margin_exceptions_quote
  on public.qb_margin_exceptions(quote_package_id);

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table public.qb_margin_thresholds enable row level security;
alter table public.qb_margin_exceptions enable row level security;

-- Service role unrestricted
create policy "qb_margin_thresholds_service" on public.qb_margin_thresholds
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_margin_exceptions_service" on public.qb_margin_exceptions
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- Thresholds: all workspace members can read; admin/manager/owner only can write
create policy "qb_margin_thresholds_select" on public.qb_margin_thresholds
  for select using (
    workspace_id = public.get_my_workspace()
    and auth.uid() is not null
  );
create policy "qb_margin_thresholds_write" on public.qb_margin_thresholds
  for all using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  ) with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

-- Exceptions: workspace members can read + insert-own; admin can manage all
create policy "qb_margin_exceptions_select" on public.qb_margin_exceptions
  for select using (
    workspace_id = public.get_my_workspace()
    and auth.uid() is not null
  );
create policy "qb_margin_exceptions_insert_own" on public.qb_margin_exceptions
  for insert with check (
    workspace_id = public.get_my_workspace()
    and auth.uid() is not null
    and (rep_id is null or rep_id = auth.uid())
  );
create policy "qb_margin_exceptions_admin_update" on public.qb_margin_exceptions
  for update using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  ) with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );
create policy "qb_margin_exceptions_admin_delete" on public.qb_margin_exceptions
  for delete using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'owner')
  );
