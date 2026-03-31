-- CRM communication templates workspace management
-- Adds first-party template storage for Sprint 4 communication hub closeout.

create table public.crm_activity_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  activity_type public.crm_activity_type not null,
  label text not null,
  description text,
  body text not null,
  task_due_minutes integer check (task_due_minutes is null or task_due_minutes >= 0),
  task_status text check (task_status is null or task_status in ('open', 'completed')),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index idx_crm_activity_templates_workspace_type_sort
  on public.crm_activity_templates(workspace_id, activity_type, sort_order, created_at desc)
  where deleted_at is null and is_active = true;
-- Justification: composer and template manager load active templates by workspace and activity type.

create index idx_crm_activity_templates_workspace_active
  on public.crm_activity_templates(workspace_id, is_active, deleted_at);
-- Justification: admin template manager filters active and archived rows inside the caller workspace.

alter table public.crm_activity_templates enable row level security;

create policy "crm_activity_templates_service_all"
  on public.crm_activity_templates
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "crm_activity_templates_select_workspace"
  on public.crm_activity_templates
  for select
  using (
    public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
    and workspace_id = public.get_my_workspace()
    and deleted_at is null
  );

create policy "crm_activity_templates_elevated_insert_workspace"
  on public.crm_activity_templates
  for insert
  with check (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and workspace_id = public.get_my_workspace()
    and created_by = auth.uid()
  );

create policy "crm_activity_templates_elevated_update_workspace"
  on public.crm_activity_templates
  for update
  using (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and workspace_id = public.get_my_workspace()
    and deleted_at is null
  )
  with check (
    public.get_my_role() in ('admin', 'manager', 'owner')
    and workspace_id = public.get_my_workspace()
  );

create trigger set_crm_activity_templates_updated_at
  before update on public.crm_activity_templates
  for each row execute function public.set_updated_at();

-- Rollback (do not execute automatically)
-- drop trigger if exists set_crm_activity_templates_updated_at on public.crm_activity_templates;
-- drop policy if exists "crm_activity_templates_elevated_update_workspace" on public.crm_activity_templates;
-- drop policy if exists "crm_activity_templates_elevated_insert_workspace" on public.crm_activity_templates;
-- drop policy if exists "crm_activity_templates_select_workspace" on public.crm_activity_templates;
-- drop policy if exists "crm_activity_templates_service_all" on public.crm_activity_templates;
-- drop index if exists idx_crm_activity_templates_workspace_active;
-- drop index if exists idx_crm_activity_templates_workspace_type_sort;
-- drop table if exists public.crm_activity_templates;
