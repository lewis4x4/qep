-- Harden SOP version history with the same workspace/service boundaries
-- used by the rest of the SOP engine tables.

alter table public.sop_template_versions enable row level security;

create policy "sop_template_versions_workspace" on public.sop_template_versions for all
  using (workspace_id = public.get_my_workspace())
  with check (workspace_id = public.get_my_workspace());

create policy "sop_template_versions_service" on public.sop_template_versions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
