-- ============================================================================
-- Migration 270: Slice 3.3b — Claude-Augmented Predictive Plays
--
-- Extends Slice 3.3's pure-SQL predictor with an LLM reasoning layer.
--
-- The deterministic predictor (predict_parts_needs) handles cases where
-- maintenance_schedule + current_hours math is clear. The LLM handles cases
-- where reasoning is required: seasonal patterns, customer industry profiles,
-- cross-machine wear propagation, "the next logical part after the last one
-- they ordered."
--
-- Stack composition:
--   parts-predictive-ai edge fn →
--     1. Gathers machine context + recent order history
--     2. Claude Sonnet 4.6 returns part hints (description-level, no SKUs)
--     3. Each hint is resolved to a real part via match_parts_hybrid
--        (Slice 3.1 semantic search — beautiful reuse)
--     4. Plays written to predicted_parts_plays with signal_type='ai_inferred'
--
-- Preserves all lifecycle + idempotency semantics of Slice 3.3.
-- ============================================================================

-- ── Extend predicted_parts_plays with LLM reasoning field ──────────────────

alter table public.predicted_parts_plays
  add column if not exists llm_reasoning text,
  add column if not exists llm_model text,
  add column if not exists llm_cost_usd_cents numeric(10, 4);

comment on column public.predicted_parts_plays.llm_reasoning is
  'Full reasoning emitted by the LLM when signal_type=ai_inferred. '
  'Stored for rep-facing explanation + audit trail.';

-- ── Audit table: every LLM inference run ───────────────────────────────────

create table if not exists public.parts_llm_inference_runs (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          text not null default 'default',
  portal_customer_id    uuid references public.portal_customers(id) on delete set null,
  fleet_id              uuid references public.customer_fleet(id) on delete set null,
  machine_profile_id    uuid references public.machine_profiles(id) on delete set null,

  -- Input
  system_prompt_version text not null,
  user_context_hash     text,
  user_context          jsonb,

  -- Model
  model                 text not null,
  max_tokens            integer,
  temperature           numeric(3, 2),

  -- Output
  plays_proposed        integer not null default 0,
  plays_grounded        integer not null default 0,
    -- How many part_hints were successfully matched to parts_catalog via
    -- match_parts_hybrid (groundedness rate is a quality signal)
  plays_written         integer not null default 0,
  raw_response          jsonb,
  grounding_rejections  jsonb,

  -- Cost
  tokens_in             integer,
  tokens_out            integer,
  cost_usd_cents        numeric(10, 4),

  -- Lifecycle
  status                text not null default 'success' check (status in (
    'success', 'llm_error', 'validation_error', 'grounding_failed', 'timeout'
  )),
  error_message         text,
  elapsed_ms            integer,

  created_at            timestamptz not null default now()
);

comment on table public.parts_llm_inference_runs is
  'Per-machine LLM inference audit. Each row = one Claude call. Enables '
  'cost tracking, prompt-version rollback, and quality regression catches.';

create index idx_llm_inference_runs_customer
  on public.parts_llm_inference_runs (workspace_id, portal_customer_id, created_at desc);

create index idx_llm_inference_runs_status
  on public.parts_llm_inference_runs (workspace_id, status, created_at desc)
  where status <> 'success';

alter table public.parts_llm_inference_runs enable row level security;

create policy "llm_inference_runs_select"
  on public.parts_llm_inference_runs for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "llm_inference_runs_service_all"
  on public.parts_llm_inference_runs for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── RPC: customer_fleet_context — gathers inputs for the LLM ───────────────
-- One call per machine. Returns JSON the edge fn can paste into the prompt.

create or replace function public.customer_fleet_llm_context(p_fleet_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
  v_fleet record;
  v_customer_name text;
  v_recent_orders jsonb;
  v_machine_notes text;
  result jsonb;
begin
  ws := coalesce(public.get_my_workspace(), 'default');
  if public.get_my_role() not in ('admin', 'manager', 'owner')
     and current_user <> 'service_role' then
    raise exception 'insufficient role';
  end if;

  -- Fleet row + customer identity
  select
    cf.*,
    coalesce(
      cc.name,
      trim(concat(pc.first_name, ' ', pc.last_name)),
      'Customer'
    ) as customer_name
  into v_fleet
  from public.customer_fleet cf
  left join public.portal_customers pc on pc.id = cf.portal_customer_id
  left join public.crm_companies cc on cc.id = pc.crm_company_id
  where cf.id = p_fleet_id and cf.workspace_id = ws;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'fleet not found');
  end if;

  -- Recent orders for this customer (across all their machines)
  -- Limit to last 6 months, top 20 line items
  select coalesce(jsonb_agg(row_to_json(o) order by o.ordered_at desc), '[]'::jsonb)
  into v_recent_orders
  from (
    select
      pol.part_number,
      pol.description,
      pol.quantity,
      po.created_at::date as ordered_at
    from public.parts_order_lines pol
    join public.parts_orders po on po.id = pol.parts_order_id
    where po.workspace_id = ws
      and po.crm_company_id = (
        select crm_company_id from public.portal_customers
        where id = v_fleet.portal_customer_id
      )
      and po.created_at >= now() - interval '6 months'
    order by po.created_at desc
    limit 20
  ) o;

  -- Machine profile context (maintenance_schedule + common_wear already in the predictor path)
  -- We pass notes + category as extra signal for the LLM
  select coalesce(mp.notes, '')
  into v_machine_notes
  from public.machine_profiles mp
  where mp.workspace_id = ws
    and mp.deleted_at is null
    and (upper(mp.model) = upper(v_fleet.model) or upper(mp.model_family) = upper(v_fleet.model))
  limit 1;

  result := jsonb_build_object(
    'ok', true,
    'fleet_id', v_fleet.id,
    'customer_name', v_fleet.customer_name,
    'portal_customer_id', v_fleet.portal_customer_id,
    'machine', jsonb_build_object(
      'year', v_fleet.year,
      'make', v_fleet.make,
      'model', v_fleet.model,
      'current_hours', v_fleet.current_hours,
      'service_interval_hours', v_fleet.service_interval_hours,
      'last_service_date', v_fleet.last_service_date,
      'next_service_due', v_fleet.next_service_due,
      'machine_profile_notes', v_machine_notes
    ),
    'recent_orders_6mo', v_recent_orders
  );

  return result;
end;
$$;

grant execute on function public.customer_fleet_llm_context(uuid) to authenticated;

-- ── RPC: write_ai_inferred_play — insert + resolve grounding ───────────────
-- The edge function calls this per play after match_parts_hybrid resolves
-- the LLM's part_hint to a real part_id. Idempotent via the existing
-- UNIQUE key on predicted_parts_plays (workspace, customer, fleet, part, window).

create or replace function public.write_ai_inferred_play(
  p_workspace           text,
  p_portal_customer_id  uuid,
  p_fleet_id            uuid,
  p_machine_profile_id  uuid,
  p_part_id             uuid,
  p_part_number         text,
  p_part_description    text,
  p_projection_window   text,
  p_projected_due_date  date,
  p_probability         numeric,
  p_reason              text,
  p_llm_reasoning       text,
  p_llm_model           text,
  p_batch_id            text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_play_id uuid;
  v_list numeric;
  v_on_hand numeric;
begin
  if public.get_my_role() not in ('admin', 'manager', 'owner')
     and current_user <> 'service_role' then
    raise exception 'insufficient role';
  end if;

  select list_price, on_hand into v_list, v_on_hand
  from public.parts_catalog where id = p_part_id;

  insert into public.predicted_parts_plays (
    workspace_id, portal_customer_id, fleet_id, machine_profile_id,
    part_id, part_number, part_description,
    projection_window, projected_due_date, probability,
    reason, signal_type,
    current_on_hand, recommended_order_qty, projected_revenue,
    computation_batch_id, input_signals,
    llm_reasoning, llm_model
  ) values (
    p_workspace, p_portal_customer_id, p_fleet_id, p_machine_profile_id,
    p_part_id, p_part_number, p_part_description,
    p_projection_window, p_projected_due_date, p_probability,
    p_reason, 'ai_inferred',
    coalesce(v_on_hand, 0), greatest(1, 2 - coalesce(v_on_hand, 0))::numeric, coalesce(v_list, 0),
    p_batch_id, jsonb_build_object('source', 'claude_sonnet_4_6'),
    p_llm_reasoning, p_llm_model
  )
  on conflict (workspace_id, portal_customer_id, fleet_id, part_id, projection_window)
  do update set
    probability      = excluded.probability,
    reason           = excluded.reason,
    llm_reasoning    = excluded.llm_reasoning,
    llm_model        = excluded.llm_model,
    computation_batch_id = excluded.computation_batch_id,
    status           = case when public.predicted_parts_plays.status in ('dismissed', 'actioned', 'fulfilled')
                            then public.predicted_parts_plays.status
                            else 'open' end,
    updated_at       = now()
  returning id into v_play_id;

  return v_play_id;
end;
$$;

grant execute on function public.write_ai_inferred_play(
  text, uuid, uuid, uuid, uuid, text, text, text, date, numeric, text, text, text, text
) to authenticated;

-- ============================================================================
-- Migration 270 complete.
-- ============================================================================
