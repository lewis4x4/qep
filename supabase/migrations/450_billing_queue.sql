-- 450_billing_queue.sql
--
-- Wave 1 clean foundation: Phase-8 Financial Operations from
-- docs/intellidealer-gap-audit/phase-8-financial-operations.yaml#billing_queue.reference_number.
--
-- Rollback notes:
--   drop trigger if exists set_billing_queue_updated_at on public.billing_queue;
--   drop policy if exists "billing_queue_rep_select" on public.billing_queue;
--   drop policy if exists "billing_queue_rep_scope" on public.billing_queue;
--   drop policy if exists "billing_queue_rep_own_select" on public.billing_queue;
--   drop policy if exists "billing_queue_workspace_select" on public.billing_queue;
--   drop policy if exists "billing_queue_workspace_insert" on public.billing_queue;
--   drop policy if exists "billing_queue_workspace_update" on public.billing_queue;
--   drop policy if exists "billing_queue_delete_elevated" on public.billing_queue;
--   drop policy if exists "billing_queue_all_elevated" on public.billing_queue;
--   drop policy if exists "billing_queue_service_all" on public.billing_queue;
--   drop table if exists public.billing_queue;
create table public.billing_queue (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  reference_number text not null,
  billing_type text not null check (billing_type in ('parts','service','rental','equipment','general','rental_counter')),
  location_id uuid references public.branches(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  billing_date date,
  ar_period_id uuid references public.gl_periods(id) on delete set null,
  printer text,
  invoice_printer text,
  billing_output text,
  print_format text,
  submitted_by uuid references public.profiles(id) on delete set null default auth.uid(),
  submitted_at timestamptz not null default now(),
  processing_start timestamptz,
  processing_end timestamptz,
  error_message text,
  error_stack_trace text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, reference_number)
);

comment on table public.billing_queue is 'Real-time billing queue for parts, service, rental, equipment, general, and rental-counter billing runs.';

create index idx_billing_queue_status
  on public.billing_queue (workspace_id, status, submitted_at desc)
  where deleted_at is null;
comment on index public.idx_billing_queue_status is 'Purpose: billing queue by lifecycle status and submitted date.';

alter table public.billing_queue enable row level security;

create policy "billing_queue_service_all"
  on public.billing_queue for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "billing_queue_all_elevated"
  on public.billing_queue for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create trigger set_billing_queue_updated_at
  before update on public.billing_queue
  for each row execute function public.set_updated_at();
