-- ============================================================================
-- Migration 298: QB Fuzzy Search RPC + AI Request Log
--
-- Part of Slice 05 — Conversational Deal Engine.
--
-- 1. qb_search_equipment_fuzzy(query, brand_id?, limit?)
--    RPC for natural-language model lookup using pg_trgm word_similarity.
--    Called from qb-parse-request and qb-ai-scenarios edge functions.
--    Uses the GIN trgm index created in migration 284.
--
-- 2. qb_ai_request_log
--    Append-only telemetry table for every AI parse call.
--    Captures raw prompt → resolved model/brand, confidence scores, latency.
--    Product-learning layer: lets Brian/Angela see what reps are asking and
--    whether the AI is resolving the right machines.
--
-- Conventions: search_path = '' on functions, RLS on all user-facing tables,
-- service role bypass, numeric money as bigint cents.
-- ============================================================================

-- ── 1. Fuzzy search RPC ──────────────────────────────────────────────────────

-- Returns equipment models matching p_query via pg_trgm word_similarity on
-- name_display and model_code. Falls back to ILIKE for short queries where
-- trigram similarity is less effective (< 3 chars).
--
-- Threshold: 0.15 word_similarity — lenient enough to match "RT135" → "RT-135"
-- and "compact track" → "Compact Track Loader". Upper limit on returned rows
-- capped at 20 to prevent accidental table dumps.
--
-- The GIN index idx_qb_equipment_models_name_trgm (migration 284) is available
-- but may not be selected by the planner for small catalogs. As the catalog grows
-- the planner will switch to the index automatically.

create or replace function public.qb_search_equipment_fuzzy(
  p_query    text,
  p_brand_id uuid    default null,
  p_limit    int     default 10
)
returns table (
  id               uuid,
  brand_id         uuid,
  brand_code       text,
  brand_name       text,
  model_code       text,
  family           text,
  name_display     text,
  list_price_cents bigint,
  model_year       int,
  similarity       float4
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    m.id,
    m.brand_id,
    b.code        as brand_code,
    b.name        as brand_name,
    m.model_code,
    m.family,
    m.name_display,
    m.list_price_cents,
    m.model_year,
    greatest(
      extensions.word_similarity(p_query, m.name_display),
      extensions.word_similarity(p_query, m.model_code)
    )::float4       as similarity
  from  public.qb_equipment_models m
  join  public.qb_brands           b on b.id = m.brand_id
  where m.active     = true
    and m.deleted_at is null
    and (p_brand_id  is null or m.brand_id = p_brand_id)
    and (
      -- Trigram similarity match (the primary path for natural language)
      extensions.word_similarity(p_query, m.name_display) > 0.15
      or extensions.word_similarity(p_query, m.model_code) > 0.15
      -- ILIKE fallback for exact partial matches and very short queries
      or lower(m.name_display) like '%' || lower(p_query) || '%'
      or lower(m.model_code)   like '%' || lower(p_query) || '%'
    )
  order by similarity desc
  limit least(p_limit, 20);
$$;

comment on function public.qb_search_equipment_fuzzy(text, uuid, int) is
  'Fuzzy-matches a free-text query against qb_equipment_models.name_display and '
  'model_code using pg_trgm word_similarity. '
  'Called by qb-parse-request and qb-ai-scenarios edge functions (Slice 05). '
  'p_brand_id narrows search to one brand. p_limit caps results (max 20).';

-- Allow authenticated users and the service role to call this RPC.
grant execute on function public.qb_search_equipment_fuzzy(text, uuid, int)
  to authenticated, service_role;

-- ── 2. qb_ai_request_log ────────────────────────────────────────────────────

create table public.qb_ai_request_log (
  id                   uuid        primary key default gen_random_uuid(),
  workspace_id         text        not null default 'default',
  -- The user who triggered the AI parse (NULL-able so the row survives user deletion)
  user_id              uuid        references auth.users(id) on delete set null,
  -- Verbatim text the rep typed / spoke (transcript for voice)
  raw_prompt           text        not null,
  -- What Claude resolved (may be NULL if parse failed or no match found)
  resolved_brand_id    uuid        references public.qb_brands(id),
  resolved_model_id    uuid        references public.qb_equipment_models(id),
  -- JSON array of top fuzzy matches returned by qb_search_equipment_fuzzy
  -- Each element: { id, brand_code, model_code, name_display, similarity }
  model_candidates     jsonb,
  -- Per-field parse confidence 0.0–1.0: { brand, model, state, customer_type }
  confidence           jsonb,
  -- State extracted from prompt (e.g. 'FL')
  delivery_state       text,
  -- 'standard' | 'gmu' | null (if not determinable)
  customer_type        text,
  -- Wall-clock latency of the full parse + scenario pipeline (ms)
  latency_ms           int,
  -- Non-null if the parse failed (Claude error, no JSON, etc.)
  error                text,
  -- Prompt source: 'text' | 'voice' (transcript from voice-to-qrm)
  prompt_source        text        not null default 'text'
                         check (prompt_source in ('text', 'voice')),
  created_at           timestamptz not null default now()
);

-- Lookup by user (dashboard for admins)
create index idx_qb_ai_request_log_user
  on public.qb_ai_request_log(user_id, created_at desc);

-- Lookup by workspace (multi-tenant admin view)
create index idx_qb_ai_request_log_workspace
  on public.qb_ai_request_log(workspace_id, created_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.qb_ai_request_log enable row level security;

-- Service role bypasses RLS (edge functions write via service key)
create policy "qb_ai_request_log service bypass"
  on public.qb_ai_request_log
  using (auth.role() = 'service_role');

-- Reps and users can read their own log entries (transparency)
create policy "qb_ai_request_log read own"
  on public.qb_ai_request_log
  for select
  using (user_id = auth.uid());

-- Admins / managers / owners can read all entries in their workspace
create policy "qb_ai_request_log elevated read"
  on public.qb_ai_request_log
  for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

-- No user-level INSERT policy — writes come only from edge functions via
-- the service role client. This prevents reps from injecting fake log entries.

comment on table public.qb_ai_request_log is
  'Telemetry log for every qb-ai-scenarios / qb-parse-request call. '
  'Captures raw prompt, resolved brand/model, confidence scores, and latency '
  'so the team can audit AI accuracy and spot prompts the engine fails to resolve. '
  'Append-only: no UPDATE or DELETE policies.';
