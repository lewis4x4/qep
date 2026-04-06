-- ============================================================================
-- Migration 157: Portal Real Features — Live Service Status + Document Library
--
-- Gap closure for Moonshot 6:
-- - Live service job state joined to customer_fleet (Bobby's ask:
--   "your Yanmar is in the shop, parts arrived, Wednesday completion")
-- - Parts reorder history by machine + one-click reorder support
-- - Document library: manuals, service records, warranty docs by serial
-- ============================================================================

-- ── 1. Equipment documents library ──────────────────────────────────────────

create table public.equipment_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',

  -- Linkage (at least one required)
  fleet_id uuid references public.customer_fleet(id) on delete cascade,
  crm_equipment_id uuid references public.crm_equipment(id) on delete cascade,
  portal_customer_id uuid references public.portal_customers(id) on delete cascade,

  -- Document classification
  document_type text not null check (document_type in (
    'operator_manual', 'service_manual', 'parts_manual',
    'warranty_certificate', 'service_record', 'inspection_report',
    'invoice', 'receipt', 'photo', 'other'
  )),
  title text not null,
  description text,
  file_url text not null,
  file_size_bytes bigint,
  mime_type text,

  -- Visibility
  customer_visible boolean not null default true,

  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.equipment_documents is 'Per-equipment document library accessible from the customer portal. Bobby: "operator manuals, service records, warranty docs by serial number."';

alter table public.equipment_documents enable row level security;

-- Internal staff see everything
create policy "equipment_docs_internal" on public.equipment_documents for all
  using (workspace_id = public.get_my_workspace() and public.get_my_role() in ('rep', 'admin', 'manager', 'owner'))
  with check (workspace_id = public.get_my_workspace());

-- Portal customers see docs linked to their fleet, visibility=true
create policy "equipment_docs_portal_self" on public.equipment_documents for select
  using (
    customer_visible = true
    and (
      portal_customer_id = public.get_portal_customer_id()
      or fleet_id in (
        select id from public.customer_fleet
        where portal_customer_id = public.get_portal_customer_id()
      )
    )
  );

create policy "equipment_docs_service" on public.equipment_documents for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index idx_equipment_docs_fleet on public.equipment_documents(fleet_id) where fleet_id is not null;
create index idx_equipment_docs_customer on public.equipment_documents(portal_customer_id) where portal_customer_id is not null;
create index idx_equipment_docs_type on public.equipment_documents(document_type);
create index idx_equipment_docs_workspace on public.equipment_documents(workspace_id);

-- ── 2. Live fleet status view (joins service jobs if the table exists) ─────

create or replace function public.get_portal_fleet_with_status(p_portal_customer_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_result jsonb;
  v_has_service_jobs boolean;
begin
  -- Check if service_jobs table exists (may be named differently in this schema)
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'service_jobs'
  ) into v_has_service_jobs;

  if v_has_service_jobs then
    execute format($fmt$
      select coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::jsonb)
      from (
        select
          cf.*,
          (
            select jsonb_build_object(
              'service_job_id', sj.id,
              'current_stage', sj.current_stage,
              'estimated_completion', sj.estimated_completion,
              'status', sj.status,
              'last_updated_at', sj.updated_at
            )
            from public.service_jobs sj
            where sj.crm_equipment_id = cf.equipment_id
              and sj.status not in ('completed', 'cancelled', 'paid_closed')
            order by sj.updated_at desc
            limit 1
          ) as active_service_job
        from public.customer_fleet cf
        where cf.portal_customer_id = %L
          and cf.is_active = true
        order by cf.created_at desc
      ) row_data
    $fmt$, p_portal_customer_id) into v_result;
  else
    -- Fallback: just return fleet without service job data
    select coalesce(jsonb_agg(to_jsonb(cf.*)), '[]'::jsonb)
    into v_result
    from public.customer_fleet cf
    where cf.portal_customer_id = p_portal_customer_id
      and cf.is_active = true;
  end if;

  return v_result;
end;
$$;

revoke execute on function public.get_portal_fleet_with_status(uuid) from public;
grant execute on function public.get_portal_fleet_with_status(uuid) to authenticated, service_role;

comment on function public.get_portal_fleet_with_status(uuid) is 'Returns portal customer fleet with live active service job state joined per equipment. Bobby: "your Yanmar is in the shop, parts arrived, Wednesday completion."';

-- ── 3. Parts reorder history by machine (RPC for portal) ───────────────────

create or replace function public.get_parts_reorder_history(p_portal_customer_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_result jsonb;
  v_has_parts_orders boolean;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'parts_orders'
  ) into v_has_parts_orders;

  if not v_has_parts_orders then
    return '[]'::jsonb;
  end if;

  execute format($fmt$
    select coalesce(jsonb_agg(row_data order by row_data->>'last_ordered_at' desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'fleet_id', cf.id,
        'make', cf.make,
        'model', cf.model,
        'year', cf.year,
        'serial_number', cf.serial_number,
        'last_ordered_at', max(po.created_at),
        'total_orders', count(po.id),
        'recent_line_items', (
          select jsonb_agg(li order by li.created_at desc)
          from (
            select po2.line_items as li, po2.created_at
            from public.parts_orders po2
            where po2.fleet_id = cf.id
            order by po2.created_at desc
            limit 3
          ) recent_orders
        )
      ) as row_data
      from public.customer_fleet cf
      left join public.parts_orders po on po.fleet_id = cf.id
      where cf.portal_customer_id = %L
        and cf.is_active = true
      group by cf.id, cf.make, cf.model, cf.year, cf.serial_number
    ) agg
  $fmt$, p_portal_customer_id) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.get_parts_reorder_history(uuid) from public;
grant execute on function public.get_parts_reorder_history(uuid) to authenticated, service_role;

comment on function public.get_parts_reorder_history(uuid) is 'Returns parts purchase history grouped by machine. Powers one-click reorder on portal.';

-- ── 4. Trigger ──────────────────────────────────────────────────────────────

create trigger set_equipment_documents_updated_at
  before update on public.equipment_documents for each row
  execute function public.set_updated_at();
