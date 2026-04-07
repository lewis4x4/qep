-- ============================================================================
-- Migration 175: QRM Idea Backlog (Phase F — spec §10.4)
--
-- Owner/rep idea capture: voice memo → backlog item. Owners think in
-- conversation; capture should match. Voice path is a follow-on (extends
-- voice-to-qrm fn to detect "idea:" / "process improvement:" / "we should:"
-- lead phrases); this migration provides the storage layer.
-- ============================================================================

create table if not exists public.qrm_idea_backlog (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  title text not null,
  body text,
  source text not null default 'text' check (source in ('voice', 'text', 'meeting', 'email')),
  status text not null default 'new' check (status in (
    'new', 'triaged', 'in_progress', 'shipped', 'declined'
  )),
  priority text default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  tags jsonb not null default '[]'::jsonb,
  captured_by uuid references public.profiles(id) on delete set null,
  captured_at timestamptz not null default now(),
  triaged_by uuid references public.profiles(id) on delete set null,
  triaged_at timestamptz,
  shipped_at timestamptz,
  -- For voice-sourced ideas, link back to the originating voice capture
  source_voice_capture_id uuid,
  ai_confidence numeric(3,2) check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.qrm_idea_backlog is
  'Internal idea / process-improvement backlog. Voice path: voice-to-qrm detects "idea:" lead phrases and routes here.';

alter table public.qrm_idea_backlog enable row level security;

create policy "qib_workspace" on public.qrm_idea_backlog for all
  using (workspace_id = public.get_my_workspace())
  with check (workspace_id = public.get_my_workspace());
create policy "qib_service" on public.qrm_idea_backlog for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index idx_qib_workspace_status on public.qrm_idea_backlog(workspace_id, status, captured_at desc);
create index idx_qib_captured_by on public.qrm_idea_backlog(captured_by) where captured_by is not null;
create index idx_qib_priority on public.qrm_idea_backlog(priority, status) where status in ('new', 'triaged');

create trigger set_qib_updated_at
  before update on public.qrm_idea_backlog
  for each row execute function public.set_updated_at();
