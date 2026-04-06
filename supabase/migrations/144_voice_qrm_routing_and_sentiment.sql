-- ============================================================================
-- Migration 144: Voice QRM Routing, Sentiment & Follow-Up Suggestions
--
-- Moonshot 3 completion: makes voice the primary input method for the QRM.
-- - Content type classification for smart department routing
-- - Sentiment scoring from voice analysis
-- - AI-generated follow-up suggestions
-- - Configurable routing rules per content type
-- ============================================================================

-- ── 1. Extend voice_qrm_results ─────────────────────────────────────────────

alter table public.voice_qrm_results
  add column if not exists sentiment_score numeric(3,2),
  add column if not exists content_type text
    check (content_type in ('sales', 'parts', 'service', 'process_improvement', 'general')),
  add column if not exists follow_up_suggestions jsonb default '[]';

comment on column public.voice_qrm_results.sentiment_score is 'Mapped from extraction: positive=0.8, neutral=0.5, negative=0.2';
comment on column public.voice_qrm_results.content_type is 'AI-classified content type for smart department routing';
comment on column public.voice_qrm_results.follow_up_suggestions is 'AI-generated follow-up action suggestions';

create index if not exists idx_voice_qrm_content_type
  on public.voice_qrm_results(content_type) where content_type is not null;

-- ── 2. Voice routing rules ──────────────────────────────────────────────────

create table public.voice_routing_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  content_type text not null
    check (content_type in ('sales', 'parts', 'service', 'process_improvement', 'general')),
  route_to_role text, -- e.g. 'iron_manager', 'iron_woman'
  route_to_user_id uuid references public.profiles(id) on delete set null,
  notify_channel text default 'in_app'
    check (notify_channel in ('in_app', 'email', 'both')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.voice_routing_rules is 'Maps voice content types to departments/roles for smart routing (Moonshot 3: Ramble-to-Structure).';

alter table public.voice_routing_rules enable row level security;

create policy "routing_rules_workspace" on public.voice_routing_rules for all
  using (workspace_id = public.get_my_workspace())
  with check (workspace_id = public.get_my_workspace());
create policy "routing_rules_service" on public.voice_routing_rules for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index idx_routing_rules_workspace on public.voice_routing_rules(workspace_id);
create index idx_routing_rules_active on public.voice_routing_rules(content_type, is_active)
  where is_active = true;

-- ── 3. Seed default routing rules ───────────────────────────────────────────

insert into public.voice_routing_rules (workspace_id, content_type, route_to_role) values
  ('default', 'sales', 'iron_manager'),
  ('default', 'parts', 'iron_woman'),
  ('default', 'service', 'iron_man'),
  ('default', 'process_improvement', 'iron_manager'),
  ('default', 'general', null);

-- ── 4. Trigger ──────────────────────────────────────────────────────────────

create trigger set_voice_routing_rules_updated_at
  before update on public.voice_routing_rules for each row
  execute function public.set_updated_at();
