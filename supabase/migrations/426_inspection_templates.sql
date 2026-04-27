-- 426_inspection_templates.sql
--
-- Wave 1B: IntelliDealer ID InspectionPlus template foundation from
-- docs/intellidealer-gap-audit/phase-4-service.yaml#inspection.template_form.
--
-- Rollback notes:
--   drop trigger if exists set_inspection_templates_updated_at on public.inspection_templates;
--   drop policy if exists "inspection_templates_rep_select" on public.inspection_templates;
--   drop policy if exists "inspection_templates_all_elevated" on public.inspection_templates;
--   drop policy if exists "inspection_templates_service_all" on public.inspection_templates;
--   drop table if exists public.inspection_templates;

create table public.inspection_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  template_name text not null,
  applies_to text not null,
  version integer not null default 1,
  is_active boolean not null default true,
  questions jsonb not null,
  require_signature boolean not null default false,
  require_photos boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, template_name, version)
);

comment on table public.inspection_templates is
  'Generic ID InspectionPlus form templates with typed questions, photo/signature requirements, and versioning.';

create index idx_inspection_templates_active
  on public.inspection_templates (workspace_id, applies_to, is_active, template_name, version desc)
  where deleted_at is null;
comment on index public.idx_inspection_templates_active is
  'Purpose: inspection template picker by surface and active version.';

alter table public.inspection_templates enable row level security;

create policy "inspection_templates_service_all"
  on public.inspection_templates for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

create policy "inspection_templates_all_elevated"
  on public.inspection_templates for all
  using (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  )
  with check (
    (select public.get_my_role()) in ('admin', 'manager', 'owner')
    and workspace_id = (select public.get_my_workspace())
  );

create policy "inspection_templates_rep_select"
  on public.inspection_templates for select
  using (
    (select public.get_my_role()) = 'rep'
    and workspace_id = (select public.get_my_workspace())
    and deleted_at is null
  );

create trigger set_inspection_templates_updated_at
  before update on public.inspection_templates
  for each row execute function public.set_updated_at();
