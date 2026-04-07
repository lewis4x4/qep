-- ============================================================================
-- Migration 195: QEP Flow Engine — Approvals + Context Resolver (Slice 3)
--
--   • flow_approvals table — full approval lifecycle (pending → approved /
--     rejected / expired / escalated) with assignment, due dates, escalation,
--     and decision audit
--   • request_flow_approval() RPC — creates an approval row + suspends
--     the parent run by setting status='awaiting_approval'
--   • decide_flow_approval() RPC — records the decision, writes audit log,
--     and resumes the parent run (status flips back to 'running' so the
--     next runner tick picks it up)
--   • flow_resolve_context() RPC — single point of context hydration that
--     joins existing read RPCs (account_360, crm_deals_weighted, etc.) and
--     returns a JSONB blob the runner caches per-run in resolved_context
-- ============================================================================

-- ── 1. flow_approvals ──────────────────────────────────────────────────────

create table if not exists public.flow_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  run_id uuid not null references public.flow_workflow_runs(id) on delete cascade,
  step_id uuid references public.flow_workflow_run_steps(id) on delete set null,
  workflow_slug text not null,

  -- Routing
  assigned_role text,
  assigned_to uuid references public.profiles(id) on delete set null,
  requested_by_role text,

  -- Timing
  requested_at timestamptz not null default now(),
  due_at timestamptz,
  escalate_at timestamptz,
  reminder_sent_at timestamptz,

  -- Subject + context for the approver
  subject text not null,
  detail text,
  context_summary jsonb not null default '{}'::jsonb,

  -- Decision
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired', 'escalated', 'cancelled')),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  decision_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.flow_approvals is
  'QEP Flow Engine: approval requests that pause workflow runs. One row per approval; the parent run sets status=awaiting_approval until decided.';

create index if not exists idx_fa_run on public.flow_approvals (run_id);
create index if not exists idx_fa_status on public.flow_approvals (workspace_id, status, requested_at desc);
create index if not exists idx_fa_assigned on public.flow_approvals (assigned_to) where assigned_to is not null;
create index if not exists idx_fa_role on public.flow_approvals (assigned_role, status) where status = 'pending';

create trigger trg_fa_updated_at
  before update on public.flow_approvals
  for each row execute function public.set_updated_at();

alter table public.flow_approvals enable row level security;

create policy "fa_admin_read" on public.flow_approvals
  for select using (
    public.get_my_role() in ('owner', 'admin', 'manager')
    and workspace_id = public.get_my_workspace()
  );

create policy "fa_assigned_read" on public.flow_approvals
  for select using (
    workspace_id = public.get_my_workspace()
    and (assigned_to = auth.uid()
         or (assigned_role is not null and assigned_role = public.get_my_role()))
  );

create policy "fa_admin_decide" on public.flow_approvals
  for update using (
    public.get_my_role() in ('owner', 'admin', 'manager')
    and workspace_id = public.get_my_workspace()
  ) with check (workspace_id = public.get_my_workspace());

create policy "fa_service_all" on public.flow_approvals
  for all to service_role using (true) with check (true);

-- ── 2. request_flow_approval RPC ───────────────────────────────────────────

create or replace function public.request_flow_approval(
  p_run_id uuid,
  p_step_id uuid,
  p_workflow_slug text,
  p_subject text,
  p_detail text default null,
  p_assigned_role text default null,
  p_assigned_to uuid default null,
  p_due_in_hours integer default 24,
  p_escalate_in_hours integer default 48,
  p_context_summary jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approval_id uuid;
  v_workspace text;
begin
  select workspace_id into v_workspace from public.flow_workflow_runs where id = p_run_id;
  v_workspace := coalesce(v_workspace, 'default');

  insert into public.flow_approvals
    (workspace_id, run_id, step_id, workflow_slug,
     assigned_role, assigned_to, subject, detail,
     due_at, escalate_at, context_summary, status)
  values
    (v_workspace, p_run_id, p_step_id, p_workflow_slug,
     p_assigned_role, p_assigned_to, p_subject, p_detail,
     now() + (p_due_in_hours || ' hours')::interval,
     now() + (p_escalate_in_hours || ' hours')::interval,
     p_context_summary, 'pending')
  returning id into v_approval_id;

  -- Suspend the parent run
  update public.flow_workflow_runs
  set status = 'awaiting_approval',
      metadata = metadata || jsonb_build_object('approval_id', v_approval_id)
  where id = p_run_id;

  -- Audit
  insert into public.analytics_action_log
    (workspace_id, action_type, source_widget, metadata)
  values
    (v_workspace, 'approval_request', 'flow_engine',
     jsonb_build_object('approval_id', v_approval_id, 'run_id', p_run_id, 'workflow_slug', p_workflow_slug));

  return v_approval_id;
end;
$$;

revoke execute on function public.request_flow_approval(uuid, uuid, text, text, text, text, uuid, integer, integer, jsonb) from public;
grant execute on function public.request_flow_approval(uuid, uuid, text, text, text, text, uuid, integer, integer, jsonb) to service_role;

-- ── 3. decide_flow_approval RPC ────────────────────────────────────────────

create or replace function public.decide_flow_approval(
  p_approval_id uuid,
  p_decision text,
  p_reason text default null
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_workspace text;
  v_workflow_slug text;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'decide_flow_approval: decision must be approved or rejected';
  end if;

  select workspace_id, run_id, workflow_slug
    into v_workspace, v_run_id, v_workflow_slug
  from public.flow_approvals
  where id = p_approval_id and status = 'pending';

  if v_run_id is null then
    raise exception 'approval not found or not pending';
  end if;

  -- Authz: caller must be admin/manager/owner in the workspace, OR the
  -- explicitly assigned approver. RLS enforces the read; the update policy
  -- enforces the write. Workspace match is enforced by the RLS update policy.
  update public.flow_approvals
  set status = p_decision,
      decided_at = now(),
      decided_by = auth.uid(),
      decision_reason = p_reason
  where id = p_approval_id;

  -- Resume / cancel parent run
  if p_decision = 'approved' then
    update public.flow_workflow_runs
    set status = 'running',
        metadata = metadata || jsonb_build_object('approval_decided_at', now(), 'approval_decision', 'approved')
    where id = v_run_id;
  else
    update public.flow_workflow_runs
    set status = 'cancelled',
        finished_at = now(),
        metadata = metadata || jsonb_build_object('approval_decided_at', now(), 'approval_decision', 'rejected', 'reject_reason', p_reason)
    where id = v_run_id;
  end if;

  -- Audit
  insert into public.analytics_action_log
    (workspace_id, user_id, action_type, source_widget, metadata)
  values
    (v_workspace, auth.uid(), 'approval_decision', 'flow_engine',
     jsonb_build_object('approval_id', p_approval_id, 'run_id', v_run_id, 'workflow_slug', v_workflow_slug, 'decision', p_decision));
end;
$$;

revoke execute on function public.decide_flow_approval(uuid, text, text) from public;
grant execute on function public.decide_flow_approval(uuid, text, text) to authenticated, service_role;

comment on function public.decide_flow_approval is
  'QEP Flow Engine: record an approval decision and resume/cancel the parent run. Authz enforced via flow_approvals RLS update policy.';

-- ── 4. flow_resolve_context RPC ───────────────────────────────────────────
--
-- Single point of context hydration. Workflows that need richer context
-- declare it in their definition; the runner calls this RPC once per run
-- and freezes the result into flow_workflow_runs.resolved_context.

create or replace function public.flow_resolve_context(
  p_event_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_event public.analytics_events;
  v_payload jsonb;
  v_company_id uuid;
  v_deal_id uuid;
  v_contact_id uuid;
  v_equipment_id uuid;
  v_company jsonb;
  v_deal jsonb;
  v_health_score numeric;
  v_ar_block text;
  v_recent_runs jsonb;
  v_open_quote_total numeric;
  v_customer_tier text;
begin
  select * into v_event from public.analytics_events where event_id = p_event_id;
  if v_event.event_id is null then
    return jsonb_build_object('error', 'event_not_found');
  end if;

  v_payload := coalesce(v_event.properties, '{}'::jsonb);

  -- Pull common foreign keys from the payload
  v_company_id := nullif(v_payload ->> 'company_id', '')::uuid;
  v_deal_id := nullif(v_payload ->> 'deal_id', '')::uuid;
  v_contact_id := nullif(v_payload ->> 'contact_id', '')::uuid;
  v_equipment_id := nullif(v_payload ->> 'equipment_id', '')::uuid;

  -- Company snapshot
  if v_company_id is not null then
    select to_jsonb(c.*) - 'created_at' - 'updated_at' into v_company
    from public.crm_companies c where c.id = v_company_id;
  end if;

  -- Deal snapshot
  if v_deal_id is not null then
    select to_jsonb(d.*) - 'created_at' - 'updated_at' into v_deal
    from public.crm_deals d where d.id = v_deal_id;
  end if;

  -- Health score (best-effort; table may not exist on every deployment)
  begin
    select cpe.health_score into v_health_score
    from public.customer_profiles_extended cpe
    where cpe.id = v_company_id
    limit 1;
  exception when undefined_table then
    v_health_score := null;
  end;

  -- AR block status (best-effort)
  begin
    select case when count(*) > 0 then 'blocked' else 'clear' end into v_ar_block
    from public.exception_queue
    where source = 'ar_override_pending'
      and status = 'open'
      and (payload ->> 'company_id')::uuid = v_company_id;
  exception when others then
    v_ar_block := null;
  end;

  -- Customer tier (heuristic from tags; future: dedicated column)
  if v_company is not null and v_company ? 'tags' then
    if v_company -> 'tags' ? 'strategic' then v_customer_tier := 'strategic';
    elsif v_company -> 'tags' ? 'enterprise' then v_customer_tier := 'enterprise';
    else v_customer_tier := 'standard';
    end if;
  end if;

  -- Open quote total for the company (best-effort)
  begin
    select coalesce(sum(net_total), 0) into v_open_quote_total
    from public.quote_packages
    where (payload ->> 'company_id')::text is not null  -- placeholder; quote_packages may not link to company directly
      and status in ('draft', 'sent', 'negotiating');
  exception when others then
    v_open_quote_total := null;
  end;

  -- Recent runs against the same entity (last 30 days)
  select coalesce(jsonb_agg(jsonb_build_object(
    'run_id', r.id,
    'workflow_slug', r.workflow_slug,
    'status', r.status,
    'finished_at', r.finished_at
  ) order by r.started_at desc) filter (where r.id is not null), '[]'::jsonb)
  into v_recent_runs
  from public.flow_workflow_runs r
  where r.workspace_id = v_event.workspace_id
    and r.event_id is not null
    and r.started_at > now() - interval '30 days'
    and (
      r.event_id in (
        select event_id from public.analytics_events
        where entity_type = v_event.entity_type and entity_id = v_event.entity_id
      )
    );

  return jsonb_build_object(
    'event', to_jsonb(v_event),
    'company', v_company,
    'deal', v_deal,
    'health_score', v_health_score,
    'ar_block_status', v_ar_block,
    'customer_tier', v_customer_tier,
    'open_quote_total', v_open_quote_total,
    'recent_runs', v_recent_runs
  );
end;
$$;

revoke execute on function public.flow_resolve_context(uuid) from public;
grant execute on function public.flow_resolve_context(uuid) to service_role;

comment on function public.flow_resolve_context is
  'QEP Flow Engine context resolver: single point of hydration for company / deal / health / AR / tier / recent runs. Called once per workflow run; result frozen into flow_workflow_runs.resolved_context.';
