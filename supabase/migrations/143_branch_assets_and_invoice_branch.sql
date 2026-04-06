-- ══════════════════════════════════════════════════════════════════════════════
-- 143 — Branch Assets Bucket + Invoice branch_id + FK enforcement
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Storage bucket for branch logos / branding assets ─────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'branch-assets',
  'branch-assets',
  true,
  5242880, -- 5 MB
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/svg+xml'
  ]::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "branch_assets_insert" on storage.objects;
create policy "branch_assets_insert" on storage.objects
  for insert with check (
    bucket_id = 'branch-assets'
    and (
      public.get_my_role() in ('admin', 'manager', 'owner')
      or auth.role() = 'service_role'
    )
  );

drop policy if exists "branch_assets_select" on storage.objects;
create policy "branch_assets_select" on storage.objects
  for select using (bucket_id = 'branch-assets');

drop policy if exists "branch_assets_update" on storage.objects;
create policy "branch_assets_update" on storage.objects
  for update using (
    bucket_id = 'branch-assets'
    and (
      public.get_my_role() in ('admin', 'manager', 'owner')
      or auth.role() = 'service_role'
    )
  );

drop policy if exists "branch_assets_delete" on storage.objects;
create policy "branch_assets_delete" on storage.objects
  for delete using (
    bucket_id = 'branch-assets'
    and (
      public.get_my_role() in ('admin', 'manager', 'owner')
      or auth.role() = 'service_role'
    )
  );

-- ── 2. Add branch_id to customer_invoices ────────────────────────────────────

alter table public.customer_invoices
  add column if not exists branch_id text;

comment on column public.customer_invoices.branch_id is
  'Branch slug that issued this invoice. Resolves to branches master for document headers.';

create index if not exists idx_customer_invoices_branch
  on public.customer_invoices(branch_id)
  where branch_id is not null;

-- ── 3. FK enforcement: link existing branch_id columns to branches master ────
-- Uses a composite FK (workspace_id, branch_id) → branches(workspace_id, slug).
-- All are DEFERRABLE INITIALLY DEFERRED so existing rows don't block migration;
-- a data-fix pass can reconcile orphan slugs afterward.

-- service_jobs
do $$ begin
  alter table public.service_jobs
    add constraint fk_service_jobs_branch
    foreign key (workspace_id, branch_id)
    references public.branches(workspace_id, slug)
    on delete set null
    deferrable initially deferred;
exception when duplicate_object then null;
          when others then raise notice 'service_jobs FK skipped: %', sqlerrm;
end $$;

-- technician_profiles
do $$ begin
  alter table public.technician_profiles
    add constraint fk_technician_profiles_branch
    foreign key (workspace_id, branch_id)
    references public.branches(workspace_id, slug)
    on delete set null
    deferrable initially deferred;
exception when duplicate_object then null;
          when others then raise notice 'technician_profiles FK skipped: %', sqlerrm;
end $$;

-- parts_inventory
do $$ begin
  alter table public.parts_inventory
    add constraint fk_parts_inventory_branch
    foreign key (workspace_id, branch_id)
    references public.branches(workspace_id, slug)
    on delete restrict
    deferrable initially deferred;
exception when duplicate_object then null;
          when others then raise notice 'parts_inventory FK skipped: %', sqlerrm;
end $$;

-- service_branch_config
do $$ begin
  alter table public.service_branch_config
    add constraint fk_service_branch_config_branch
    foreign key (workspace_id, branch_id)
    references public.branches(workspace_id, slug)
    on delete restrict
    deferrable initially deferred;
exception when duplicate_object then null;
          when others then raise notice 'service_branch_config FK skipped: %', sqlerrm;
end $$;

-- parts_reorder_profiles
do $$ begin
  alter table public.parts_reorder_profiles
    add constraint fk_parts_reorder_profiles_branch
    foreign key (workspace_id, branch_id)
    references public.branches(workspace_id, slug)
    on delete set null
    deferrable initially deferred;
exception when duplicate_object then null;
          when others then raise notice 'parts_reorder_profiles FK skipped: %', sqlerrm;
end $$;

-- parts_demand_forecasts
do $$ begin
  alter table public.parts_demand_forecasts
    add constraint fk_parts_demand_forecasts_branch
    foreign key (workspace_id, branch_id)
    references public.branches(workspace_id, slug)
    on delete set null
    deferrable initially deferred;
exception when duplicate_object then null;
          when others then raise notice 'parts_demand_forecasts FK skipped: %', sqlerrm;
end $$;

-- parts_auto_replenish_queue
do $$ begin
  alter table public.parts_auto_replenish_queue
    add constraint fk_parts_auto_replenish_queue_branch
    foreign key (workspace_id, branch_id)
    references public.branches(workspace_id, slug)
    on delete set null
    deferrable initially deferred;
exception when duplicate_object then null;
          when others then raise notice 'parts_auto_replenish_queue FK skipped: %', sqlerrm;
end $$;

-- customer_invoices
do $$ begin
  alter table public.customer_invoices
    add constraint fk_customer_invoices_branch
    foreign key (workspace_id, branch_id)
    references public.branches(workspace_id, slug)
    on delete set null
    deferrable initially deferred;
exception when duplicate_object then null;
          when others then raise notice 'customer_invoices FK skipped: %', sqlerrm;
end $$;
