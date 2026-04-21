-- ============================================================================
-- Migration 312: Hub — feedback + comments
--
-- The centerpiece of the Stakeholder Build Hub: a closed feedback loop.
-- Stakeholder submits friction (text / voice transcript / screenshot) →
-- hub-feedback-intake edge fn classifies via Claude and fills ai_summary,
-- ai_suggested_action, priority → hub-feedback-draft-fix edge fn (admin/owner
-- only) spawns a Claude Agent SDK session that drafts a PR-ready branch,
-- writes claude_branch_name + claude_pr_url here, flips status to
-- awaiting_merge → hub-merge-pr closes the loop and hub-changelog-from-commit
-- emits the "your fix shipped" event.
--
-- Design decisions (locked):
--   * Triage + draft, human merges. No autonomous merging. claude_pr_url is
--     the merge handoff point — admin clicks Merge in the hub UI.
--   * Voice path: voice_audio_url + voice_transcript populated by iron-transcribe
--     (no phone / Twilio in v1 — browser mic only).
--   * Comments are polymorphic (parent_type + parent_id) across feedback,
--     build items, and decisions. is_internal = true hides from stakeholders
--     so admin/owner can keep private triage notes inline.
--
-- RLS:
--   * Stakeholders: read all feedback and all non-internal comments in workspace;
--     insert own feedback + non-internal comments.
--   * Internal admin/owner: full CRUD including internal comments.
--   * Service role: unrestricted.
-- ============================================================================

-- ── 1. hub_feedback ─────────────────────────────────────────────────────────

create table if not exists public.hub_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  build_item_id uuid references public.hub_build_items(id) on delete set null,
  submitted_by uuid references public.profiles(id) on delete set null,
  feedback_type text not null default 'suggestion' check (feedback_type in (
    'bug', 'suggestion', 'question', 'approval', 'concern'
  )),
  body text not null,
  voice_transcript text,
  voice_audio_url text,
  screenshot_url text,
  priority text check (priority is null or priority in ('low', 'medium', 'high')),
  status text not null default 'open' check (status in (
    'open', 'triaged', 'drafting', 'awaiting_merge', 'shipped', 'wont_fix'
  )),
  ai_summary text,
  ai_suggested_action text,
  claude_branch_name text,
  claude_pr_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  deleted_at timestamptz
);

comment on table public.hub_feedback is
  'Stakeholder Build Hub: feedback items submitted by external observers. '
  'Drives the Claude triage + draft-fix + merge closed loop.';

create index if not exists idx_hub_feedback_workspace_status
  on public.hub_feedback (workspace_id, status)
  where deleted_at is null;

create index if not exists idx_hub_feedback_build_item
  on public.hub_feedback (build_item_id)
  where deleted_at is null;

create index if not exists idx_hub_feedback_submitter
  on public.hub_feedback (submitted_by, created_at desc)
  where deleted_at is null;

create index if not exists idx_hub_feedback_priority_open
  on public.hub_feedback (workspace_id, priority, created_at desc)
  where deleted_at is null and status in ('open', 'triaged');

drop trigger if exists set_hub_feedback_updated_at on public.hub_feedback;
create trigger set_hub_feedback_updated_at
  before update on public.hub_feedback
  for each row execute function public.set_updated_at();

alter table public.hub_feedback enable row level security;

create policy hub_feedback_service_all on public.hub_feedback
  for all to service_role using (true) with check (true);

-- Read: everyone in workspace sees all feedback
create policy hub_feedback_workspace_read on public.hub_feedback
  for select
  using (
    workspace_id = public.get_my_workspace()
    and deleted_at is null
  );

-- Insert: stakeholders submit their own feedback; internal admin/owner can
-- insert on behalf of anyone for seeding.
create policy hub_feedback_stakeholder_insert on public.hub_feedback
  for insert
  with check (
    workspace_id = public.get_my_workspace()
    and (
      (public.get_my_audience() = 'stakeholder' and submitted_by = auth.uid())
      or (public.get_my_audience() = 'internal'
          and public.get_my_role() in ('admin', 'owner'))
    )
  );

-- Update: internal admin/owner only (triage, PR linkage, status flips).
-- Stakeholders cannot re-open or mutate; they comment instead.
create policy hub_feedback_admin_update on public.hub_feedback
  for update
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_audience() = 'internal'
    and public.get_my_role() in ('admin', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_audience() = 'internal'
    and public.get_my_role() in ('admin', 'owner')
  );

grant select on public.hub_feedback to authenticated;
grant insert, update on public.hub_feedback to authenticated;

-- ── 2. hub_comments ─────────────────────────────────────────────────────────

create table if not exists public.hub_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.get_my_workspace(),
  parent_type text not null check (parent_type in (
    'build_item', 'feedback', 'decision'
  )),
  parent_id uuid not null,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null,
  is_internal boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.hub_comments is
  'Stakeholder Build Hub: polymorphic comment threads on feedback, build items, '
  'and decisions. is_internal=true hides from stakeholders so admin/owner can '
  'keep private triage notes inline.';

comment on column public.hub_comments.is_internal is
  'When true, comment is admin/owner-only and hidden from stakeholders. '
  'Enforced by hub_comments_workspace_read policy.';

create index if not exists idx_hub_comments_parent
  on public.hub_comments (workspace_id, parent_type, parent_id, created_at)
  where deleted_at is null;

drop trigger if exists set_hub_comments_updated_at on public.hub_comments;
create trigger set_hub_comments_updated_at
  before update on public.hub_comments
  for each row execute function public.set_updated_at();

alter table public.hub_comments enable row level security;

create policy hub_comments_service_all on public.hub_comments
  for all to service_role using (true) with check (true);

-- Read: internal sees all; stakeholder sees only non-internal.
create policy hub_comments_workspace_read on public.hub_comments
  for select
  using (
    workspace_id = public.get_my_workspace()
    and deleted_at is null
    and (
      public.get_my_audience() = 'internal'
      or (public.get_my_audience() = 'stakeholder' and is_internal = false)
    )
  );

-- Insert: stakeholders can insert non-internal comments only; internal
-- admin/owner/manager can insert either flavor.
create policy hub_comments_insert on public.hub_comments
  for insert
  with check (
    workspace_id = public.get_my_workspace()
    and author_id = auth.uid()
    and (
      (public.get_my_audience() = 'stakeholder' and is_internal = false)
      or (public.get_my_audience() = 'internal'
          and public.get_my_role() in ('admin', 'manager', 'owner'))
    )
  );

-- Update: author only, internal admin/owner can moderate.
create policy hub_comments_author_update on public.hub_comments
  for update
  using (
    workspace_id = public.get_my_workspace()
    and (
      author_id = auth.uid()
      or (public.get_my_audience() = 'internal'
          and public.get_my_role() in ('admin', 'owner'))
    )
  )
  with check (
    workspace_id = public.get_my_workspace()
    and author_id = auth.uid()
  );

grant select on public.hub_comments to authenticated;
grant insert, update on public.hub_comments to authenticated;
