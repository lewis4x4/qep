-- ============================================================================
-- Migration 272: Slice 3.2 — Voice-First Counter Operations
--
-- Schema foundation for a Claude-powered voice assistant at the parts counter.
-- Rep holds mic, says "price on 129150" or "add 10 Yanmar oil filters to
-- Thursday's order" → assistant executes and speaks back the result.
--
-- Ships:
--   voice_interactions  — audit trail of every voice turn (transcript, intent,
--                         tools invoked, response, latency, cost)
--
-- The edge function parts-voice-ops uses Claude tool use with 4 tools:
--   1. lookup_part_semantic  — wraps match_parts_hybrid (reuses Slice 3.1)
--   2. check_part_stock      — exact part_number lookup
--   3. add_to_replenish_queue — draft PO (reuses Slice 2.7 queue)
--   4. recent_orders_for_part — who bought this last, when
--
-- Intent routing + slot filling is handled by Claude; this schema just
-- captures what happened for audit + analytics.
-- ============================================================================

create type public.voice_intent as enum (
  'lookup',           -- "what's X?" / "price on X?"
  'stock_check',      -- "do I have enough X?"
  'add_to_order',     -- "add X to Thursday's order"
  'history',          -- "who ordered X last?"
  'other'
);

create table if not exists public.voice_interactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  user_id uuid references public.profiles(id) on delete set null,

  -- What they said
  transcript text not null,
  transcript_confidence numeric(4, 3),

  -- Classification
  intent public.voice_intent,
  intent_confidence numeric(4, 3),

  -- What Claude did
  tool_calls jsonb not null default '[]'::jsonb,
  response_text text,
  response_spoken boolean not null default false,

  -- Context
  client_context jsonb,
  -- e.g. { customer_id, last_part_looked_up, branch, page }

  -- Cost / perf
  model text,
  tokens_in integer,
  tokens_out integer,
  cost_usd_cents numeric(10, 4),
  elapsed_ms integer,

  -- Outcome
  success boolean not null default true,
  error_message text,

  created_at timestamptz not null default now()
);

comment on table public.voice_interactions is
  'Every voice turn at the parts counter. Audit trail + analytics source for '
  'understanding counter ops workflows and tuning the assistant.';

create index idx_voice_interactions_user
  on public.voice_interactions (workspace_id, user_id, created_at desc);

create index idx_voice_interactions_intent
  on public.voice_interactions (workspace_id, intent, created_at desc)
  where intent is not null;

alter table public.voice_interactions enable row level security;

create policy "voice_interactions_select_self"
  on public.voice_interactions for select
  using (
    workspace_id = public.get_my_workspace()
    and (user_id = auth.uid() or public.get_my_role() in ('admin', 'manager', 'owner'))
  );

create policy "voice_interactions_insert_self"
  on public.voice_interactions for insert
  with check (
    workspace_id = public.get_my_workspace()
    and (user_id = auth.uid() or public.get_my_role() in ('rep', 'admin', 'manager', 'owner'))
  );

create policy "voice_interactions_service_all"
  on public.voice_interactions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── RPC: recent_orders_for_part — scopes history lookups for the voice tool ─

create or replace function public.recent_orders_for_part(
  p_part_number   text,
  p_limit         integer default 5,
  p_customer_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  ws text;
  result jsonb;
begin
  ws := coalesce(public.get_my_workspace(), 'default');

  with matches as (
    select
      po.id as order_id,
      po.created_at,
      po.order_source,
      pol.quantity,
      pol.unit_price,
      coalesce(cc.name, 'Counter/direct') as customer_name,
      po.crm_company_id
    from public.parts_order_lines pol
    join public.parts_orders po on po.id = pol.parts_order_id
    left join public.crm_companies cc on cc.id = po.crm_company_id
    where po.workspace_id = ws
      and upper(pol.part_number) = upper(p_part_number)
      and (
        p_customer_name is null
        or cc.name ilike '%' || p_customer_name || '%'
      )
    order by po.created_at desc
    limit p_limit
  )
  select coalesce(jsonb_agg(row_to_json(m) order by created_at desc), '[]'::jsonb)
  into result
  from matches m;

  return jsonb_build_object(
    'ok', true,
    'part_number', p_part_number,
    'customer_filter', p_customer_name,
    'orders', result
  );
end;
$$;

grant execute on function public.recent_orders_for_part(text, integer, text) to authenticated;

-- ============================================================================
-- Migration 272 complete.
-- ============================================================================
