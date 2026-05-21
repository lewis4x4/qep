-- ============================================================================
-- Migration 610: OEM Price Feeds Phase 1
--
-- Persistent substrate for manual OEM price-sheet publish events, server-side
-- diff rows, quote impact persistence, stock-lock suppression, margin-floor
-- gates, and rep-created review-only reprice drafts.
-- ============================================================================

create table public.qb_price_change_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  brand_id uuid not null references public.qb_brands(id) on delete cascade,
  price_sheet_id uuid not null references public.qb_price_sheets(id) on delete cascade,
  prior_price_sheet_id uuid references public.qb_price_sheets(id) on delete set null,
  source_type text not null default 'manual_upload' check (source_type in ('manual_upload','mailbox','portal','predictive')),
  source_metadata jsonb not null default '{}'::jsonb,
  effective_date date,
  materiality_rule jsonb not null default '{"line_pct_gt": 2, "quote_delta_cents_gt": 100000}'::jsonb,
  approval_policy jsonb not null default '{"numericApprovalThresholds":"margin_floor_only","requireManagerReviewForChangeTypes":["list_price","freight","rebate","incentive"],"autoSendCustomer":false}'::jsonb,
  status text not null default 'building' check (status in ('building','active','superseded','closed','failed')),
  created_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (price_sheet_id)
);

comment on table public.qb_price_change_events is
  'One event per published OEM price sheet. Owns server-side diff rows and persisted quote impact state for Phase 1 OEM price feeds.';
comment on column public.qb_price_change_events.materiality_rule is
  'Phase 1 owner rule: rep-visible when abs(line delta %) > 2 OR abs(total quote delta) > $1,000.';
comment on column public.qb_price_change_events.approval_policy is
  'Owner-approved Phase 1 policy. Manager review is policy-driven for list/freight/rebate/incentive changes; customer auto-send is false.';

create index idx_qb_price_change_events_workspace_status
  on public.qb_price_change_events(workspace_id, status, created_at desc);
create index idx_qb_price_change_events_brand_active
  on public.qb_price_change_events(brand_id, published_at desc)
  where status = 'active';

create trigger set_qb_price_change_events_updated_at
  before update on public.qb_price_change_events
  for each row execute function public.set_updated_at();

create table public.qb_price_change_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.qb_price_change_events(id) on delete cascade,
  workspace_id text not null default 'default',
  item_type text not null check (item_type in ('list_price','freight','rebate','incentive')),
  model_code text,
  normalized_code text,
  name_display text,
  old_price_cents bigint,
  new_price_cents bigint,
  delta_cents bigint not null default 0,
  delta_pct numeric,
  change_kind text not null check (change_kind in ('new','removed','increased','decreased','unchanged')),
  prior_item_id uuid,
  new_item_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.qb_price_change_items is
  'Authoritative server-side diff rows for an OEM price-change event. Model list-price rows are used to calculate open quote impacts.';

create index idx_qb_price_change_items_event
  on public.qb_price_change_items(event_id);
create index idx_qb_price_change_items_workspace_code
  on public.qb_price_change_items(workspace_id, normalized_code)
  where normalized_code is not null;

create table public.qb_quote_reprice_impacts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.qb_price_change_events(id) on delete cascade,
  workspace_id text not null default 'default',
  quote_package_id uuid not null references public.quote_packages(id) on delete cascade,
  deal_id uuid,
  assigned_rep_id uuid references public.profiles(id) on delete set null,
  quote_status_snapshot text,
  quote_updated_at_snapshot timestamptz,
  total_delta_cents bigint not null default 0,
  max_line_delta_pct numeric,
  old_margin_pct numeric,
  projected_margin_pct numeric,
  margin_floor_pct numeric,
  below_margin_floor boolean not null default false,
  materiality_trigger text not null default 'quiet' check (materiality_trigger in ('line_pct','quote_delta','both','quiet')),
  requires_manager_review boolean not null default false,
  approval_required_reasons text[] not null default '{}'::text[],
  old_commission_cents bigint,
  projected_commission_cents bigint,
  commission_delta_cents bigint,
  state text not null default 'quiet' check (state in ('quiet','visible','dismissed','draft_created','approval_pending','approved','applied','superseded')),
  dismissed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, quote_package_id)
);

comment on table public.qb_quote_reprice_impacts is
  'One persisted OEM reprice impact per quote per event. Material visible rows drive rep Today signals and quote_packages.requires_requote compatibility.';
comment on column public.qb_quote_reprice_impacts.total_delta_cents is
  'Projected customer quote delta in cents. Yard-stock/stock-locked lines are excluded from automatic proposed delta.';
comment on column public.qb_quote_reprice_impacts.approval_required_reasons is
  'Machine-readable gate reasons such as manager_review_policy, missing_margin_floor, missing_cost_basis, below_margin_floor, stock_lock.';

create index idx_qb_quote_reprice_impacts_rep_state
  on public.qb_quote_reprice_impacts(assigned_rep_id, state, created_at desc)
  where state in ('visible','draft_created','approval_pending','approved');
create index idx_qb_quote_reprice_impacts_workspace_state
  on public.qb_quote_reprice_impacts(workspace_id, state, created_at desc);
create index idx_qb_quote_reprice_impacts_quote
  on public.qb_quote_reprice_impacts(quote_package_id, created_at desc);

create trigger set_qb_quote_reprice_impacts_updated_at
  before update on public.qb_quote_reprice_impacts
  for each row execute function public.set_updated_at();

create table public.qb_quote_reprice_impact_lines (
  id uuid primary key default gen_random_uuid(),
  impact_id uuid not null references public.qb_quote_reprice_impacts(id) on delete cascade,
  quote_package_line_item_id uuid references public.quote_package_line_items(id) on delete set null,
  equipment_line_id text,
  model_code text not null,
  make text,
  quantity integer not null default 1,
  old_list_price_cents bigint,
  new_list_price_cents bigint,
  delta_cents bigint not null default 0,
  delta_pct numeric,
  source_location text,
  is_yard_stock boolean not null default false,
  suppressed_by_stock_lock boolean not null default false,
  suppression_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.qb_quote_reprice_impact_lines is
  'Per-line detail for OEM quote impacts. Yard-stock rows remain visible but are suppressed from automatic proposed repricing.';

create index idx_qb_quote_reprice_impact_lines_impact
  on public.qb_quote_reprice_impact_lines(impact_id);
create index idx_qb_quote_reprice_impact_lines_stock_lock
  on public.qb_quote_reprice_impact_lines(impact_id)
  where suppressed_by_stock_lock = true;

create table public.qb_quote_reprice_drafts (
  id uuid primary key default gen_random_uuid(),
  impact_id uuid not null references public.qb_quote_reprice_impacts(id) on delete cascade,
  quote_package_id uuid not null references public.quote_packages(id) on delete cascade,
  workspace_id text not null default 'default',
  created_by uuid references public.profiles(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','approval_pending','approved','applied','rejected','stale','cancelled')),
  proposed_patch jsonb not null default '{}'::jsonb,
  before_snapshot jsonb not null default '{}'::jsonb,
  projected_totals jsonb not null default '{}'::jsonb,
  approval_case_id uuid,
  email_draft_id uuid references public.email_drafts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_at timestamptz
);

comment on table public.qb_quote_reprice_drafts is
  'Rep-created review-only OEM reprice draft. Phase 1 never auto-sends customer email and only applies through explicit, gated follow-up work.';

create index idx_qb_quote_reprice_drafts_impact
  on public.qb_quote_reprice_drafts(impact_id, created_at desc);
create index idx_qb_quote_reprice_drafts_quote
  on public.qb_quote_reprice_drafts(quote_package_id, created_at desc);
create index idx_qb_quote_reprice_drafts_creator_status
  on public.qb_quote_reprice_drafts(created_by, status, created_at desc);

create trigger set_qb_quote_reprice_drafts_updated_at
  before update on public.qb_quote_reprice_drafts
  for each row execute function public.set_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table public.qb_price_change_events enable row level security;
alter table public.qb_price_change_items enable row level security;
alter table public.qb_quote_reprice_impacts enable row level security;
alter table public.qb_quote_reprice_impact_lines enable row level security;
alter table public.qb_quote_reprice_drafts enable row level security;

create policy "qb_price_change_events_service" on public.qb_price_change_events
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_price_change_items_service" on public.qb_price_change_items
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_quote_reprice_impacts_service" on public.qb_quote_reprice_impacts
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_quote_reprice_impact_lines_service" on public.qb_quote_reprice_impact_lines
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "qb_quote_reprice_drafts_service" on public.qb_quote_reprice_drafts
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "qb_price_change_events_elevated" on public.qb_price_change_events
  for all using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin','manager','owner'))
  with check (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin','manager','owner'));

create policy "qb_price_change_items_elevated_select" on public.qb_price_change_items
  for select using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin','manager','owner'));

create policy "qb_quote_reprice_impacts_select" on public.qb_quote_reprice_impacts
  for select using (
    workspace_id = public.get_my_workspace()
    and (public.get_my_role() in ('admin','manager','owner') or assigned_rep_id = auth.uid())
  );

create policy "qb_quote_reprice_impacts_update" on public.qb_quote_reprice_impacts
  for update using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin','manager','owner'))
  with check (workspace_id = public.get_my_workspace() and public.get_my_role() in ('admin','manager','owner'));

create policy "qb_quote_reprice_impact_lines_select" on public.qb_quote_reprice_impact_lines
  for select using (
    exists (
      select 1 from public.qb_quote_reprice_impacts i
      where i.id = qb_quote_reprice_impact_lines.impact_id
        and i.workspace_id = public.get_my_workspace()
        and (public.get_my_role() in ('admin','manager','owner') or i.assigned_rep_id = auth.uid())
    )
  );

create policy "qb_quote_reprice_drafts_select" on public.qb_quote_reprice_drafts
  for select using (
    workspace_id = public.get_my_workspace()
    and (public.get_my_role() in ('admin','manager','owner') or created_by = auth.uid())
  );

create policy "qb_quote_reprice_drafts_insert_own" on public.qb_quote_reprice_drafts
  for insert with check (workspace_id = public.get_my_workspace() and created_by = auth.uid());

create policy "qb_quote_reprice_drafts_update" on public.qb_quote_reprice_drafts
  for update using (
    workspace_id = public.get_my_workspace()
    and (public.get_my_role() in ('admin','manager','owner') or created_by = auth.uid())
  ) with check (
    workspace_id = public.get_my_workspace()
    and (public.get_my_role() in ('admin','manager','owner') or created_by = auth.uid())
  );
