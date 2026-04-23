-- ============================================================================
-- 382_quote_workspace_end_to_end.sql
--
-- Canonical persistence and access hardening for the redesigned quote
-- workspace:
-- - Trade Photo is a first-class entry mode.
-- - quote_package_line_items becomes the native multi-item package source.
-- - reps can access only their own quote packages; managers/admin/owners
--   retain workspace visibility.
-- ============================================================================

-- ── Entry mode: Voice / AI Chat / Manual / Trade Photo ──────────────────────

alter table public.quote_packages
  drop constraint if exists quote_packages_entry_mode_check;

alter table public.quote_packages
  add constraint quote_packages_entry_mode_check
  check (entry_mode in ('voice', 'ai_chat', 'manual', 'trade_photo'));

comment on constraint quote_packages_entry_mode_check on public.quote_packages is
  'Quote workspace entry method. Trade Photo is first-class with Voice, AI Chat, and Manual.';

-- ── Native package line items ────────────────────────────────────────────────

alter table public.quote_package_line_items
  add column if not exists line_type text not null default 'equipment',
  add column if not exists description text,
  add column if not exists unit_price numeric,
  add column if not exists extended_price numeric,
  add column if not exists display_order integer not null default 0,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.quote_package_line_items
  drop constraint if exists quote_package_line_items_line_type_check;

alter table public.quote_package_line_items
  add constraint quote_package_line_items_line_type_check
  check (line_type in ('equipment', 'attachment', 'warranty', 'financing', 'custom'));

update public.quote_package_line_items
set
  line_type = coalesce(nullif(line_type, ''), 'equipment'),
  description = coalesce(
    nullif(description, ''),
    trim(both ' ' from concat_ws(' ', make, model, case when year is null then null else '(' || year::text || ')' end)),
    'Equipment'
  ),
  unit_price = coalesce(unit_price, quoted_list_price, 0),
  extended_price = coalesce(extended_price, coalesce(quoted_list_price, 0) * coalesce(quantity, 1))
where description is null
   or unit_price is null
   or extended_price is null
   or line_type is null;

create index if not exists idx_qp_line_items_quote_order
  on public.quote_package_line_items(quote_package_id, display_order, created_at);

create index if not exists idx_qp_line_items_type
  on public.quote_package_line_items(workspace_id, line_type);

comment on table public.quote_package_line_items is
  'Canonical multi-item quote package rows for equipment, attachments, warranties, financing, and custom items. JSON on quote_packages is a compatibility snapshot.';
comment on column public.quote_package_line_items.line_type is
  'Native package line type: equipment, attachment, warranty, financing, custom.';
comment on column public.quote_package_line_items.display_order is
  'Workspace ordering for add/edit/remove/reorder package UX.';
comment on column public.quote_package_line_items.metadata is
  'Optional source attribution or UI metadata for non-catalog package rows.';

-- ── Rep-owned quote access ──────────────────────────────────────────────────

create or replace function public.quote_package_accessible_to_me(p_package_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.quote_packages qp
    where qp.id = p_package_id
      and qp.workspace_id = public.get_my_workspace()
      and (
        qp.created_by = auth.uid()
        or public.get_my_role() in ('admin', 'manager', 'owner')
      )
  );
$$;

revoke execute on function public.quote_package_accessible_to_me(uuid) from public;
grant execute on function public.quote_package_accessible_to_me(uuid) to authenticated;

drop policy if exists "packages_workspace" on public.quote_packages;
drop policy if exists "packages_rep_own_or_elevated" on public.quote_packages;

create policy "packages_rep_own_or_elevated" on public.quote_packages
  for all
  using (
    workspace_id = (select public.get_my_workspace())
    and (
      created_by = (select auth.uid())
      or (select public.get_my_role()) in ('admin', 'manager', 'owner')
    )
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and (
      created_by = (select auth.uid())
      or (select public.get_my_role()) in ('admin', 'manager', 'owner')
    )
  );

drop policy if exists "qp_line_items_workspace" on public.quote_package_line_items;
drop policy if exists "qp_line_items_package_access" on public.quote_package_line_items;

create policy "qp_line_items_package_access" on public.quote_package_line_items
  for all
  using (
    workspace_id = (select public.get_my_workspace())
    and public.quote_package_accessible_to_me(quote_package_id)
  )
  with check (
    workspace_id = (select public.get_my_workspace())
    and public.quote_package_accessible_to_me(quote_package_id)
  );

create or replace function public.signature_in_my_workspace(p_package_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select public.quote_package_accessible_to_me(p_package_id);
$$;

revoke execute on function public.signature_in_my_workspace(uuid) from public;
grant execute on function public.signature_in_my_workspace(uuid) to authenticated;
