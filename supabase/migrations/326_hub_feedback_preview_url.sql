-- ============================================================================
-- Migration 326: Hub — Build Hub v3.1 Netlify preview URL loop
--
-- The gap v3.1 closes: between "draft PR opened" and "shipped" is a dead
-- zone for the submitter. Angela filed feedback, Brian clicked "Draft Fix,"
-- a PR is open — but Angela has no way to *see* the proposed change until
-- it ships. That's the exact window where we lose trust: "did anyone
-- actually build what I asked for?"
--
-- Netlify deploys a preview for every PR against main. The URL lives on
-- the PR's commit status ("netlify/<site>" context, target_url = preview).
-- This migration lets us stamp that URL on the feedback row and emit a
-- `preview_ready` event so the submitter gets:
--   1. A "See live preview →" button on their feedback card.
--   2. An email: "Your fix is live at <url>. Try it — if it's wrong, reply
--      and we'll spin another take before merge."
--
-- Polling (not webhooks) because Netlify webhooks require per-site config
-- and we want zero setup overhead for the internal team. The
-- hub-feedback-preview-poll edge fn scans awaiting_merge / drafting rows
-- every 2 minutes, hits GitHub's combined-status API on the PR's head SHA,
-- and stamps the URL the first time a netlify/* context goes success.
--
-- Additive only. If no Netlify preview exists (e.g. PR branch doesn't
-- trigger a build, or Netlify isn't configured) the columns stay NULL
-- and the flow degrades to pre-v3.1 behavior — no broken UX.
-- ============================================================================

-- ── 1. hub_feedback preview columns ─────────────────────────────────────────

alter table public.hub_feedback
  add column if not exists claude_preview_url text,
  add column if not exists claude_preview_ready_at timestamptz,
  add column if not exists claude_preview_checked_at timestamptz;

comment on column public.hub_feedback.claude_preview_url is
  'Build Hub v3.1: Netlify PR-preview deploy URL scraped from the GitHub '
  'combined-status API. NULL until hub-feedback-preview-poll finds a '
  'netlify/* success status on the PR head SHA.';

comment on column public.hub_feedback.claude_preview_ready_at is
  'Build Hub v3.1: wall-clock moment the preview first went live. Drives '
  'the preview_ready timeline event + Resend email.';

comment on column public.hub_feedback.claude_preview_checked_at is
  'Build Hub v3.1: last poll attempt, success or no-op. Prevents the '
  'cron from hammering GitHub when a PR has no preview wired up — the '
  'poll fn backs off after ~12 checks with no URL.';

-- Partial index: only scan rows the cron cares about. Awaiting_merge and
-- drafting are the two statuses where a PR exists but hasn't merged yet.
create index if not exists idx_hub_feedback_preview_poll_target
  on public.hub_feedback (claude_preview_checked_at nulls first)
  where claude_pr_url is not null
    and claude_preview_ready_at is null
    and status in ('drafting', 'awaiting_merge')
    and deleted_at is null;

-- ── 2. Allow 'preview_ready' event type ────────────────────────────────────
--
-- Extend the hub_feedback_events check constraint (extended by 325 already
-- to add 'duplicate_linked') so the preview-poll fn can emit a first-class
-- timeline event.

alter table public.hub_feedback_events
  drop constraint if exists hub_feedback_events_event_type_check;

alter table public.hub_feedback_events
  add constraint hub_feedback_events_event_type_check
  check (event_type in (
    'submitted', 'triaged', 'drafting_started', 'pr_opened',
    'awaiting_merge', 'merged', 'shipped', 'wont_fix', 'reopened',
    'admin_note', 'duplicate_linked', 'preview_ready'
  ));
