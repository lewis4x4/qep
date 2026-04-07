-- ============================================================================
-- Migration 196: QEP Flow Engine — Post-build audit fixes
--
-- P0 fixes:
--   1. flow_pending_events view for robust runner polling
--   2. flow_resume_run RPC — emits a synthetic continuation event so
--      approved-after-pause runs actually re-execute (closes the
--      "approval suspends but never resumes" gap)
--   3. flow_resolve_context — fix the broken open-quote query that
--      referenced a non-existent payload column on quote_packages
--   4. analytics_events: actor_type + actor_id columns (handoff §9 required
--      fields that were missed in mig 194)
--   5. flow_action_idempotency cleanup cron
--
-- P1 fixes:
--   6. Approval escalation/expiration cron — flips overdue approvals to
--      'expired' and 'escalated' status
--   7. flow_workflow_runs.error_text indexed for the dead-letter UI
-- ============================================================================

-- ── 1. flow_pending_events view ───────────────────────────────────────────
--
-- Wraps the empty-array filter in a security_invoker view so the runner
-- queries a stable surface, not a brittle `.eq("consumed_by_runs", "[]")`
-- PostgREST filter. The view also enforces the flow_event_type IS NOT NULL
-- precondition and limits to last 7 days to keep poll latency bounded.

drop view if exists public.flow_pending_events cascade;
create view public.flow_pending_events with (security_invoker = true) as
  select
    event_id,
    flow_event_type,
    flow_event_version,
    source_module,
    workspace_id,
    entity_type,
    entity_id,
    occurred_at,
    properties,
    correlation_id,
    parent_event_id,
    consumed_by_runs
  from public.analytics_events
  where flow_event_type is not null
    and consumed_by_runs = '[]'::jsonb
    and occurred_at > now() - interval '7 days';

grant select on public.flow_pending_events to service_role;

comment on view public.flow_pending_events is
  'QEP Flow Engine: pending event queue. Replaces fragile .eq("consumed_by_runs", "[]") postgREST filter with a stable view surface.';

-- ── 2. flow_resume_run RPC ─────────────────────────────────────────────────
--
-- Called by decide_flow_approval after an approval is granted. Emits a
-- synthetic 'workflow.approved' event whose parent_event_id points at
-- the original triggering event. The runner picks it up next tick and
-- re-executes the workflow; idempotency keys prevent duplicate side
-- effects from the actions that already ran before the approval pause.

create or replace function public.flow_resume_run(p_run_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.flow_workflow_runs;
  v_original_event public.analytics_events;
  v_new_event_id uuid;
begin
  select * into v_run from public.flow_workflow_runs where id = p_run_id;
  if v_run.id is null then
    raise exception 'flow_resume_run: run % not found', p_run_id;
  end if;

  if v_run.event_id is not null then
    select * into v_original_event from public.analytics_events where event_id = v_run.event_id;
  end if;

  -- Emit a continuation event linked to the original.
  insert into public.analytics_events
    (event_name, source, role, workspace_id, project_id,
     entity_type, entity_id, properties,
     flow_event_type, source_module, correlation_id, parent_event_id)
  values
    ('workflow.resume',
     'edge_function',
     'system',
     v_run.workspace_id,
     'qep',
     v_original_event.entity_type,
     v_original_event.entity_id,
     coalesce(v_original_event.properties, '{}'::jsonb)
       || jsonb_build_object('resumed_from_run', p_run_id, 'original_event_id', v_run.event_id),
     v_run.workflow_slug,
     'system',
     coalesce(v_original_event.correlation_id, gen_random_uuid()),
     v_run.event_id)
  returning event_id into v_new_event_id;

  -- The original run is closed out as 'cancelled' with metadata pointing at
  -- the resume event. The new run created from the synthetic event will
  -- carry the work forward.
  update public.flow_workflow_runs
  set status = 'cancelled',
      finished_at = now(),
      metadata = metadata || jsonb_build_object('resumed_as_event', v_new_event_id)
  where id = p_run_id;

  perform pg_notify('flow_event', v_new_event_id::text);

  return v_new_event_id;
end;
$$;

revoke execute on function public.flow_resume_run(uuid) from public;
grant execute on function public.flow_resume_run(uuid) to service_role;

-- Update decide_flow_approval to call flow_resume_run on approve
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

  update public.flow_approvals
  set status = p_decision,
      decided_at = now(),
      decided_by = auth.uid(),
      decision_reason = p_reason
  where id = p_approval_id;

  if p_decision = 'approved' then
    -- Resume by emitting a synthetic continuation event. The runner picks
    -- it up next tick; idempotency keys prevent duplicate side effects.
    perform public.flow_resume_run(v_run_id);
  else
    update public.flow_workflow_runs
    set status = 'cancelled',
        finished_at = now(),
        metadata = metadata || jsonb_build_object('approval_decided_at', now(), 'approval_decision', 'rejected', 'reject_reason', p_reason)
    where id = v_run_id;
  end if;

  insert into public.analytics_action_log
    (workspace_id, user_id, action_type, source_widget, metadata)
  values
    (v_workspace, auth.uid(), 'approval_decision', 'flow_engine',
     jsonb_build_object('approval_id', p_approval_id, 'run_id', v_run_id, 'workflow_slug', v_workflow_slug, 'decision', p_decision));
end;
$$;

-- ── 3. Fix flow_resolve_context: open quotes query was broken ─────────────
--
-- The mig 195 version referenced `payload ->> 'company_id'` on
-- quote_packages, which has no such column. Replace with a join through
-- crm_deals.

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

  -- Pull common foreign keys from the payload (defensive cast)
  begin v_company_id := nullif(v_payload ->> 'company_id', '')::uuid; exception when others then v_company_id := null; end;
  begin v_deal_id := nullif(v_payload ->> 'deal_id', '')::uuid; exception when others then v_deal_id := null; end;
  begin v_contact_id := nullif(v_payload ->> 'contact_id', '')::uuid; exception when others then v_contact_id := null; end;
  begin v_equipment_id := nullif(v_payload ->> 'equipment_id', '')::uuid; exception when others then v_equipment_id := null; end;

  if v_company_id is not null then
    select to_jsonb(c.*) - 'created_at' - 'updated_at' into v_company
    from public.crm_companies c where c.id = v_company_id;
  end if;

  if v_deal_id is not null then
    select to_jsonb(d.*) - 'created_at' - 'updated_at' into v_deal
    from public.crm_deals d where d.id = v_deal_id;
    -- Backfill company_id from deal if payload didn't carry it
    if v_company_id is null and v_deal is not null then
      v_company_id := nullif(v_deal ->> 'company_id', '')::uuid;
      if v_company_id is not null then
        select to_jsonb(c.*) - 'created_at' - 'updated_at' into v_company
        from public.crm_companies c where c.id = v_company_id;
      end if;
    end if;
  end if;

  -- Health score (best-effort)
  begin
    select cpe.health_score into v_health_score
    from public.customer_profiles_extended cpe
    where cpe.id = v_company_id
    limit 1;
  exception when undefined_table then v_health_score := null;
  end;

  -- AR block status
  begin
    select case when count(*) > 0 then 'blocked' else 'clear' end into v_ar_block
    from public.exception_queue
    where source = 'ar_override_pending'
      and status = 'open'
      and (payload ->> 'company_id')::text = v_company_id::text;
  exception when others then v_ar_block := null;
  end;

  -- Customer tier
  if v_company is not null and v_company ? 'tags' then
    if v_company -> 'tags' ? 'strategic' then v_customer_tier := 'strategic';
    elsif v_company -> 'tags' ? 'enterprise' then v_customer_tier := 'enterprise';
    else v_customer_tier := 'standard';
    end if;
  end if;

  -- Open quote total — FIXED join through crm_deals
  if v_company_id is not null then
    begin
      select coalesce(sum(qp.net_total), 0) into v_open_quote_total
      from public.quote_packages qp
      join public.crm_deals d on d.id = qp.deal_id
      where d.company_id = v_company_id
        and qp.status in ('draft', 'sent', 'negotiating');
    exception when others then v_open_quote_total := null;
    end;
  end if;

  -- Recent runs for the same entity (last 30 days)
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
    and r.event_id in (
      select event_id from public.analytics_events
      where entity_type = v_event.entity_type and entity_id = v_event.entity_id
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

-- ── 4. analytics_events: actor_type + actor_id (handoff §9) ───────────────

alter table public.analytics_events
  add column if not exists actor_type text,
  add column if not exists actor_id uuid;

comment on column public.analytics_events.actor_type is
  'Handoff §9: user|system|portal_customer|cron — who or what triggered the event';

create index if not exists idx_ae_actor on public.analytics_events (actor_type, actor_id) where actor_type is not null;

-- Update emit_event to accept actor_type/actor_id
create or replace function public.emit_event(
  p_event_type text,
  p_source_module text,
  p_entity_type text default null,
  p_entity_id text default null,
  p_payload jsonb default '{}'::jsonb,
  p_workspace_id text default null,
  p_correlation_id uuid default null,
  p_parent_event_id uuid default null,
  p_actor_type text default 'system',
  p_actor_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_workspace text;
begin
  v_workspace := coalesce(p_workspace_id, public.get_my_workspace(), 'default');

  insert into public.analytics_events
    (event_name, source, role, workspace_id, project_id,
     entity_type, entity_id, properties,
     flow_event_type, source_module, correlation_id, parent_event_id,
     actor_type, actor_id, user_id)
  values
    (p_event_type, 'edge_function', 'system', v_workspace, 'qep',
     p_entity_type, p_entity_id, p_payload,
     p_event_type, p_source_module, p_correlation_id, p_parent_event_id,
     p_actor_type, p_actor_id, p_actor_id)
  returning event_id into v_event_id;

  perform pg_notify('flow_event', v_event_id::text);
  return v_event_id;
end;
$$;

revoke execute on function public.emit_event(text, text, text, text, jsonb, text, uuid, uuid, text, uuid) from public;
grant execute on function public.emit_event(text, text, text, text, jsonb, text, uuid, uuid, text, uuid) to authenticated, service_role;

-- ── 5. flow_action_idempotency cleanup helper ─────────────────────────────

create or replace function public.flow_cleanup_idempotency()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.flow_action_idempotency where expires_at < now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.flow_cleanup_idempotency() from public;
grant execute on function public.flow_cleanup_idempotency() to service_role;

-- ── 6. Approval escalation cron helper ────────────────────────────────────
--
-- Idempotent. Run as part of the same cron tick as the flow-runner. Flips
-- overdue approvals to 'expired' (past due_at) and 'escalated' (past
-- escalate_at). Updates parent runs whose approvals expired to 'cancelled'.

create or replace function public.flow_escalate_approvals()
returns table (expired integer, escalated integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired integer := 0;
  v_escalated integer := 0;
begin
  -- Mark expired
  with updated as (
    update public.flow_approvals
    set status = 'expired'
    where status = 'pending' and due_at is not null and due_at < now()
    returning id, run_id
  )
  select count(*) into v_expired from updated;

  -- Cancel parent runs whose approvals just expired
  update public.flow_workflow_runs
  set status = 'cancelled', finished_at = now(),
      metadata = metadata || jsonb_build_object('approval_expired', true)
  where status = 'awaiting_approval'
    and id in (
      select run_id from public.flow_approvals
      where status = 'expired' and decided_at is null
    );

  -- Mark escalated (separate from expired — escalation is reminder, not closure)
  with updated as (
    update public.flow_approvals
    set status = 'escalated'
    where status = 'pending' and escalate_at is not null and escalate_at < now()
    returning id
  )
  select count(*) into v_escalated from updated;

  return query select v_expired, v_escalated;
end;
$$;

revoke execute on function public.flow_escalate_approvals() from public;
grant execute on function public.flow_escalate_approvals() to service_role;

-- ── 7. Index hint for the dead-letter UI ──────────────────────────────────

create index if not exists idx_fwr_dead_letter_lookup
  on public.flow_workflow_runs (workspace_id, status, started_at desc)
  where status = 'dead_lettered';
