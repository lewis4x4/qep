-- ============================================================================
-- Migration 123: P0-B inventory override audit + P1-A consume → billing staging
-- - Pick with p_override_reason: admin/manager/owner only; uses non-strict
--   adjust_parts_inventory_delta + audit row on service_parts_inventory_overrides.
-- - Consume: inserts service_internal_billing_line_staging (draft) for invoice bridge.
-- - Prevents duplicate consume on an already-consumed line.
-- ============================================================================

-- ── Audit: privileged pick when system stock would block strict path ─────────
create table if not exists public.service_parts_inventory_overrides (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  requirement_id uuid not null references public.service_parts_requirements(id) on delete cascade,
  job_id uuid not null references public.service_jobs(id) on delete cascade,
  part_number text not null,
  quantity_requested integer not null check (quantity_requested > 0),
  qty_on_hand_after integer,
  insufficient boolean not null default false,
  reason text not null,
  actor_id uuid not null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.service_parts_inventory_overrides is
  'Audit trail when a manager/admin forces pick using non-strict inventory (physical pick despite ledger).';

create index if not exists idx_spio_job on public.service_parts_inventory_overrides(job_id);
create index if not exists idx_spio_req on public.service_parts_inventory_overrides(requirement_id);

alter table public.service_parts_inventory_overrides enable row level security;

create policy "spio_select" on public.service_parts_inventory_overrides for select
  using (workspace_id = public.get_my_workspace());

create policy "spio_insert" on public.service_parts_inventory_overrides for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "spio_service_all" on public.service_parts_inventory_overrides for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- ── Staging lines for parts consumed on jobs (invoice-ready queue) ──────────
create table if not exists public.service_internal_billing_line_staging (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  service_job_id uuid not null references public.service_jobs(id) on delete cascade,
  requirement_id uuid references public.service_parts_requirements(id) on delete set null,
  line_type text not null default 'parts_consume'
    check (line_type in ('parts_consume', 'adjustment', 'fee')),
  part_number text,
  description text,
  quantity numeric(12, 4) not null default 1 check (quantity >= 0),
  unit_cost numeric(12, 2) not null default 0,
  line_total numeric(12, 2) generated always as (round(quantity * unit_cost, 2)) stored,
  status text not null default 'draft' check (status in ('draft', 'posted', 'void')),
  customer_invoice_id uuid references public.customer_invoices(id) on delete set null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.service_internal_billing_line_staging is
  'Shop-floor consumed parts queued for internal invoicing (P1-A bridge to customer_invoices / portal).';

create index if not exists idx_sibls_job_status
  on public.service_internal_billing_line_staging(service_job_id, status)
  where status = 'draft';

create index if not exists idx_sibls_workspace_draft
  on public.service_internal_billing_line_staging(workspace_id, status)
  where status = 'draft';

alter table public.service_internal_billing_line_staging enable row level security;

create policy "sibls_select" on public.service_internal_billing_line_staging for select
  using (workspace_id = public.get_my_workspace());

create policy "sibls_insert" on public.service_internal_billing_line_staging for insert
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "sibls_update" on public.service_internal_billing_line_staging for update
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('rep', 'admin', 'manager', 'owner')
  );

create policy "sibls_delete" on public.service_internal_billing_line_staging for delete
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "sibls_service_all" on public.service_internal_billing_line_staging for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create trigger set_service_internal_billing_line_staging_updated_at
  before update on public.service_internal_billing_line_staging for each row
  execute function public.set_updated_at();

create unique index if not exists idx_sibls_unique_req_draft
  on public.service_internal_billing_line_staging (requirement_id)
  where status = 'draft' and requirement_id is not null;

-- ── Replace fulfillment RPC: optional override reason + consume billing row ──
drop function if exists public.service_parts_apply_fulfillment_action(uuid, text, uuid);

create or replace function public.service_parts_apply_fulfillment_action(
  p_requirement_id uuid,
  p_action text,
  p_actor_id uuid,
  p_override_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.service_parts_requirements%rowtype;
  v_job record;
  v_next text;
  v_action public.service_parts_action_type;
  v_qty int;
  v_pn text;
  v_norm text;
  v_override boolean := false;
  v_inv_result jsonb;
  v_insufficient boolean;
  v_qty_after int;
  v_meta jsonb;
begin
  if auth.uid() is null or auth.uid() is distinct from p_actor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_norm := lower(trim(both from coalesce(p_action, '')));

  select * into strict v_req
  from public.service_parts_requirements
  where id = p_requirement_id
  for update;

  if v_req.workspace_id is distinct from public.get_my_workspace() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select id, branch_id, workspace_id into strict v_job
  from public.service_jobs
  where id = v_req.job_id
  for update;

  case v_norm
    when 'pick' then
      v_next := 'picking';
      v_action := 'pick';
    when 'receive' then
      v_next := 'received';
      v_action := 'receive';
    when 'consume' then
      v_next := 'consumed';
      v_action := 'consume';
    when 'return' then
      v_next := 'returned';
      v_action := 'return';
    else
      raise exception 'invalid_action' using errcode = 'P0001';
  end case;

  if v_norm = 'pick' and v_req.status = 'pending' then
    raise exception 'INVALID_TRANSITION: pick requires a plan — run parts planner first' using errcode = 'P0001';
  end if;

  if v_norm = 'receive' and not (v_req.status in ('ordering', 'transferring', 'received')) then
    raise exception 'INVALID_TRANSITION: receive requires ordering or transferring (planned order in flight)' using errcode = 'P0001';
  end if;

  if v_norm = 'consume' and v_req.status = 'consumed' then
    raise exception 'INVALID_TRANSITION: line already consumed' using errcode = 'P0001';
  end if;

  if v_norm in ('consume', 'return') and not (v_req.status in ('staged', 'received', 'consumed', 'returned')) then
    raise exception 'INVALID_TRANSITION: line must be staged or received before consume/return' using errcode = 'P0001';
  end if;

  v_qty := greatest(1, coalesce(v_req.quantity, 1));
  v_pn := trim(both from v_req.part_number);

  v_override := coalesce(nullif(trim(both from p_override_reason), ''), '') <> '';

  if v_norm = 'pick' then
    if v_job.branch_id is null then
      raise exception 'INVALID_TRANSITION: branch required for pick' using errcode = 'P0001';
    end if;
    if v_override then
      if public.get_my_role() not in ('admin', 'manager', 'owner') then
        raise exception 'override_requires_manager' using errcode = '42501';
      end if;
      select public.adjust_parts_inventory_delta(
        v_req.workspace_id,
        v_job.branch_id,
        v_pn,
        -v_qty
      ) into v_inv_result;
      v_insufficient := coalesce((v_inv_result->>'insufficient')::boolean, false);
      v_qty_after := coalesce((v_inv_result->>'qty_on_hand')::int, 0);
      insert into public.service_parts_inventory_overrides (
        workspace_id,
        requirement_id,
        job_id,
        part_number,
        quantity_requested,
        qty_on_hand_after,
        insufficient,
        reason,
        actor_id
      ) values (
        v_req.workspace_id,
        p_requirement_id,
        v_req.job_id,
        v_pn,
        v_qty,
        v_qty_after,
        v_insufficient,
        trim(both from p_override_reason),
        p_actor_id
      );
    else
      perform (select public.adjust_parts_inventory_delta_strict(
        v_req.workspace_id,
        v_job.branch_id,
        v_pn,
        -v_qty
      ));
    end if;
  elsif v_norm in ('receive', 'return') then
    if v_job.branch_id is null then
      raise exception 'INVALID_TRANSITION: branch required for inventory movement' using errcode = 'P0001';
    end if;
    if v_override then
      raise exception 'override_only_for_pick' using errcode = 'P0001';
    end if;
    perform (select public.adjust_parts_inventory_delta_strict(
      v_req.workspace_id,
      v_job.branch_id,
      v_pn,
      v_qty
    ));
  end if;

  v_meta := jsonb_build_object('via', 'service_parts_apply_fulfillment_action');
  if v_override then
    v_meta := v_meta || jsonb_build_object('override_reason', trim(both from p_override_reason));
  end if;

  update public.service_parts_actions
  set completed_at = now()
  where requirement_id = p_requirement_id
    and job_id = v_req.job_id
    and completed_at is null
    and superseded_at is null;

  insert into public.service_parts_actions (
    workspace_id,
    requirement_id,
    job_id,
    action_type,
    actor_id,
    completed_at,
    metadata
  ) values (
    v_req.workspace_id,
    p_requirement_id,
    v_req.job_id,
    v_action,
    p_actor_id,
    now(),
    v_meta
  );

  update public.service_parts_requirements
  set
    status = v_next,
    updated_at = now()
  where id = p_requirement_id
  returning * into v_req;

  if v_norm = 'consume' then
    insert into public.service_internal_billing_line_staging (
      workspace_id,
      service_job_id,
      requirement_id,
      line_type,
      part_number,
      description,
      quantity,
      unit_cost,
      status,
      consumed_at
    ) values (
      v_req.workspace_id,
      v_req.job_id,
      p_requirement_id,
      'parts_consume',
      v_pn,
      coalesce(v_req.description, v_pn),
      v_qty::numeric,
      coalesce(v_req.unit_cost, 0),
      'draft',
      now()
    );
  end if;

  insert into public.service_job_events (
    workspace_id,
    job_id,
    event_type,
    actor_id,
    metadata
  ) values (
    v_req.workspace_id,
    v_req.job_id,
    'parts_action',
    p_actor_id,
    jsonb_build_object(
      'action', v_norm,
      'requirement_id', p_requirement_id,
      'new_status', v_next,
      'via', 'service_parts_apply_fulfillment_action',
      'inventory_override', v_override
    )
  );

  return jsonb_build_object(
    'requirement', to_jsonb(v_req),
    'inventory_override', v_override
  );
end;
$$;

comment on function public.service_parts_apply_fulfillment_action(uuid, text, uuid, text) is
  'Transactional fulfillment: inventory (strict or audited override) + action + requirement + job event; consume enqueues billing staging.';

grant execute on function public.service_parts_apply_fulfillment_action(uuid, text, uuid, text) to authenticated;
grant execute on function public.service_parts_apply_fulfillment_action(uuid, text, uuid, text) to service_role;
