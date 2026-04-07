-- ============================================================================
-- Migration 198: Wave 7 Iron Companion v1.3 — pattern-mined flow suggestions
--
-- The mission-lock "transformational" deliverable: Iron earns its keep over
-- time by mining its own usage history and proposing new flows.
--
-- The iron-pattern-mining cron edge function reads iron_conversations +
-- iron_messages, finds repeated user intents that the orchestrator could
-- NOT dispatch (CLARIFY / READ_ANSWER outcomes), canonicalizes them into
-- pattern signatures, and writes one row here per unique signature with
-- ≥5 occurrences in 14 days.
--
-- Managers see these suggestions in the FlowAdminPage Iron tab and click
-- "Promote" — which calls the existing flow-synthesize edge function with
-- the most representative example as the brief, generates a draft
-- FlowWorkflowDefinition, links it back here via promoted_flow_id, and
-- the manager enables it from the same page.
--
-- This closes the operator-utility loop: every friction point becomes a
-- candidate flow without an engineer in the path.
-- ============================================================================

create table if not exists public.iron_flow_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),

  -- Identity
  pattern_signature text not null,
  short_label text,                                       -- human-friendly summary
  intent_examples jsonb not null default '[]'::jsonb,     -- array of {message, conversation_id, occurred_at}

  -- Stats
  occurrence_count integer not null default 0,
  unique_users integer not null default 0,
  first_seen_at timestamptz,
  last_seen_at timestamptz,

  -- Lifecycle
  status text not null default 'open'
    check (status in ('open', 'promoted', 'dismissed', 'snoozed')),
  suggested_flow_slug text,
  promoted_flow_id uuid references public.flow_workflow_definitions(id) on delete set null,
  promoted_at timestamptz,
  promoted_by uuid references auth.users(id) on delete set null,
  dismissed_at timestamptz,
  dismissed_by uuid references auth.users(id) on delete set null,
  dismissed_reason text,
  snoozed_until timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, pattern_signature)
);

comment on table public.iron_flow_suggestions is
  'Wave 7 Iron Companion v1.3: pattern-mined flow suggestions. Populated nightly by iron-pattern-mining edge function from iron_messages where the orchestrator returned CLARIFY or READ_ANSWER ≥5 times for the same canonicalized intent. Promoted via flow-synthesize.';

comment on column public.iron_flow_suggestions.pattern_signature is
  'Canonicalized intent fingerprint (lowercased, stop-word stripped, first 5 content words). Stable across phrasing variants of the same operator request.';

create index if not exists idx_iron_suggestions_open
  on public.iron_flow_suggestions (workspace_id, occurrence_count desc, last_seen_at desc)
  where status = 'open';

create index if not exists idx_iron_suggestions_promoted_flow
  on public.iron_flow_suggestions (promoted_flow_id)
  where promoted_flow_id is not null;

create trigger trg_iron_suggestions_updated_at
  before update on public.iron_flow_suggestions
  for each row execute function public.set_updated_at();

alter table public.iron_flow_suggestions enable row level security;

create policy iron_suggestions_manager_read on public.iron_flow_suggestions for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('owner', 'admin', 'manager')
  );

create policy iron_suggestions_manager_write on public.iron_flow_suggestions for update
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('owner', 'admin', 'manager')
  )
  with check (workspace_id = public.get_my_workspace());

create policy iron_suggestions_service_all on public.iron_flow_suggestions for all
  to service_role using (true) with check (true);

-- ── iron_upsert_flow_suggestion RPC ───────────────────────────────────────
--
-- Atomic upsert from the pattern-mining cron. Increments counters on
-- existing rows, inserts new ones. Service role only.

create or replace function public.iron_upsert_flow_suggestion(
  p_workspace_id text,
  p_pattern_signature text,
  p_short_label text,
  p_new_examples jsonb,
  p_occurrence_delta integer,
  p_unique_users integer,
  p_first_seen_at timestamptz,
  p_last_seen_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row_id uuid;
begin
  insert into public.iron_flow_suggestions
    (workspace_id, pattern_signature, short_label,
     intent_examples, occurrence_count, unique_users,
     first_seen_at, last_seen_at)
  values
    (coalesce(p_workspace_id, 'default'), p_pattern_signature, p_short_label,
     coalesce(p_new_examples, '[]'::jsonb),
     greatest(p_occurrence_delta, 0),
     greatest(p_unique_users, 0),
     p_first_seen_at, p_last_seen_at)
  on conflict (workspace_id, pattern_signature) do update
    set short_label = coalesce(excluded.short_label, public.iron_flow_suggestions.short_label),
        intent_examples = (
          -- Cap at 10 examples to keep the row small
          (
            select jsonb_agg(elem)
            from (
              select elem
              from jsonb_array_elements(public.iron_flow_suggestions.intent_examples || excluded.intent_examples) elem
              limit 10
            ) sub
          )
        ),
        occurrence_count = public.iron_flow_suggestions.occurrence_count + p_occurrence_delta,
        unique_users = greatest(public.iron_flow_suggestions.unique_users, p_unique_users),
        first_seen_at = least(public.iron_flow_suggestions.first_seen_at, excluded.first_seen_at),
        last_seen_at = greatest(public.iron_flow_suggestions.last_seen_at, excluded.last_seen_at),
        -- If a previously-dismissed pattern keeps surfacing, surface it again
        status = case
          when public.iron_flow_suggestions.status = 'snoozed'
            and public.iron_flow_suggestions.snoozed_until < now()
          then 'open'
          else public.iron_flow_suggestions.status
        end
  returning id into v_row_id;
  return v_row_id;
end;
$$;

revoke execute on function public.iron_upsert_flow_suggestion(text, text, text, jsonb, integer, integer, timestamptz, timestamptz) from public;
grant execute on function public.iron_upsert_flow_suggestion(text, text, text, jsonb, integer, integer, timestamptz, timestamptz) to service_role;
