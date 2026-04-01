-- Tighten RLS policies that were too broadly scoped for authenticated users.
-- crm_embeddings and competitive_mentions should not be directly readable
-- by any authenticated user; reads go through edge functions with service role.

-- crm_embeddings: restrict SELECT to elevated roles or service role
drop policy if exists "crm_embeddings_select_authenticated" on public.crm_embeddings;
create policy "crm_embeddings_select_elevated" on public.crm_embeddings
  for select using (
    auth.role() = 'service_role'
    or public.get_my_role() in ('admin', 'manager', 'owner')
  );

-- competitive_mentions: restrict SELECT to elevated roles or service role
drop policy if exists "competitive_mentions_select" on public.competitive_mentions;
create policy "competitive_mentions_select_elevated" on public.competitive_mentions
  for select using (
    auth.role() = 'service_role'
    or public.get_my_role() in ('admin', 'manager', 'owner')
  );

-- Add missing indexes for performance
create index if not exists idx_profiles_role on public.profiles (role);

create index if not exists idx_crm_activities_created_by_occurred
  on public.crm_activities (created_by, occurred_at desc)
  where deleted_at is null;

-- Add missing updated_at trigger for knowledge_gaps
create trigger set_updated_at_knowledge_gaps
  before update on public.knowledge_gaps
  for each row execute function public.set_updated_at();
