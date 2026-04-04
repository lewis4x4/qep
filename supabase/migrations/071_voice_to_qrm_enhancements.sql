-- ============================================================================
-- Migration 071: Voice-to-QRM Schema Enhancements
--
-- Extends the voice capture system to support full entity auto-creation:
-- fuzzy contact matching, auto-deal creation, and needs assessment linking.
--
-- Adds pg_trgm extension for fuzzy name matching on contacts and companies.
-- ============================================================================

-- ── 1. Enable pg_trgm for fuzzy matching ────────────────────────────────────

create extension if not exists pg_trgm;

-- ── 2. Trigram indexes on contacts and companies for fuzzy matching ──────────

create index if not exists idx_crm_contacts_name_trgm
  on public.crm_contacts using gin (
    (coalesce(first_name, '') || ' ' || coalesce(last_name, '')) gin_trgm_ops
  );

create index if not exists idx_crm_companies_name_trgm
  on public.crm_companies using gin (name gin_trgm_ops);

-- ── 3. Voice-to-QRM result tracking ────────────────────────────────────────

create table public.voice_qrm_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  voice_capture_id uuid not null references public.voice_captures(id) on delete cascade,

  -- Entity resolution results
  contact_id uuid references public.crm_contacts(id) on delete set null,
  contact_match_method text check (contact_match_method in ('exact', 'fuzzy', 'created')),
  contact_match_confidence numeric(5,2),

  company_id uuid references public.crm_companies(id) on delete set null,
  company_match_method text check (company_match_method in ('exact', 'fuzzy', 'created')),
  company_match_confidence numeric(5,2),

  deal_id uuid references public.crm_deals(id) on delete set null,
  deal_action text check (deal_action in ('created', 'updated', 'matched')),

  needs_assessment_id uuid references public.needs_assessments(id) on delete set null,
  cadence_id uuid references public.follow_up_cadences(id) on delete set null,

  -- QRM narrative (owner's preferred format)
  qrm_narrative text,

  -- Processing metadata
  extraction_duration_ms integer,
  entity_creation_duration_ms integer,
  total_duration_ms integer,

  -- Errors (if any step failed)
  errors jsonb default '[]',

  created_at timestamptz not null default now()
);

comment on table public.voice_qrm_results is 'Audit trail for voice-to-QRM auto-creation pipeline. Tracks what entities were matched/created from each voice capture.';

-- ── 4. RLS ──────────────────────────────────────────────────────────────────

alter table public.voice_qrm_results enable row level security;

create policy "voice_qrm_results_select_workspace"
  on public.voice_qrm_results for select
  using (workspace_id = public.get_my_workspace());

create policy "voice_qrm_results_service_all"
  on public.voice_qrm_results for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── 5. Indexes ──────────────────────────────────────────────────────────────

create index idx_voice_qrm_results_capture on public.voice_qrm_results(voice_capture_id);
create index idx_voice_qrm_results_deal on public.voice_qrm_results(deal_id) where deal_id is not null;

-- ── 6. Fuzzy contact match function ─────────────────────────────────────────

create or replace function public.fuzzy_match_contact(
  p_workspace_id text,
  p_first_name text,
  p_last_name text,
  p_company_name text default null,
  p_threshold numeric default 0.3
)
returns table (
  contact_id uuid,
  contact_name text,
  company_id uuid,
  company_name text,
  name_similarity numeric,
  match_method text
)
language sql
security definer
stable
set search_path = ''
as $$
  with contact_matches as (
    select
      c.id as contact_id,
      coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '') as contact_name,
      c.company_id,
      similarity(
        lower(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')),
        lower(coalesce(p_first_name, '') || ' ' || coalesce(p_last_name, ''))
      ) as name_sim
    from public.crm_contacts c
    where c.workspace_id = p_workspace_id
      and c.deleted_at is null
  )
  select
    cm.contact_id,
    cm.contact_name,
    cm.company_id,
    co.name as company_name,
    cm.name_sim as name_similarity,
    case
      when cm.name_sim >= 0.8 then 'exact'
      when cm.name_sim >= p_threshold then 'fuzzy'
    end as match_method
  from contact_matches cm
  left join public.crm_companies co on co.id = cm.company_id
  where cm.name_sim >= p_threshold
  order by cm.name_sim desc
  limit 5;
$$;

revoke execute on function public.fuzzy_match_contact(text, text, text, text, numeric) from public;
grant execute on function public.fuzzy_match_contact(text, text, text, text, numeric) to authenticated, service_role;

-- ── 7. Fuzzy company match function ─────────────────────────────────────────

create or replace function public.fuzzy_match_company(
  p_workspace_id text,
  p_company_name text,
  p_threshold numeric default 0.3
)
returns table (
  company_id uuid,
  company_name text,
  name_similarity numeric,
  match_method text
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    c.id as company_id,
    c.name as company_name,
    similarity(lower(c.name), lower(p_company_name)) as name_similarity,
    case
      when similarity(lower(c.name), lower(p_company_name)) >= 0.8 then 'exact'
      when similarity(lower(c.name), lower(p_company_name)) >= p_threshold then 'fuzzy'
    end as match_method
  from public.crm_companies c
  where c.workspace_id = p_workspace_id
    and c.deleted_at is null
    and similarity(lower(c.name), lower(p_company_name)) >= p_threshold
  order by similarity(lower(c.name), lower(p_company_name)) desc
  limit 5;
$$;

revoke execute on function public.fuzzy_match_company(text, text, numeric) from public;
grant execute on function public.fuzzy_match_company(text, text, numeric) to authenticated, service_role;
