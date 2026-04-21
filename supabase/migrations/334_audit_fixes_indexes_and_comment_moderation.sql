-- ============================================================================
-- Migration 331: Post-build audit fixes
--
-- P1 findings from 2026-04-20 audit sweep across migrations 300-330:
--
--   1. hub_comments_author_update WITH CHECK clause blocks admin moderation.
--      The USING clause correctly allows admin/owner to act on any author's
--      comment, but WITH CHECK requires author_id = auth.uid() unconditionally,
--      so moderation edits by admins fail the insert-side check. The intent
--      (authors can edit their own; admins can moderate anyone's) was only
--      half-enforced. Widening WITH CHECK to mirror USING.
--
--   2. Missing indexes on profile-FK columns used by RLS policies and referenced
--      in ON DELETE SET NULL cascades:
--        - qb_deal_coach_actions.shown_by   (RLS policy filter; apply/dismiss writes)
--        - qb_margin_thresholds.updated_by  (FK + profile delete cascade)
--        - qb_quote_outcomes.captured_by    (FK + rep-level analytics)
--        - qb_brand_sheet_sources.brand_id  (join target from qb_sheet_watch_events)
--
-- Idempotent via IF NOT EXISTS / CREATE OR REPLACE POLICY. Safe to re-apply.
-- ============================================================================

-- ── 1. hub_comments: allow admin moderation in WITH CHECK ──────────────────
drop policy if exists hub_comments_author_update on public.hub_comments;
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
    and (
      author_id = auth.uid()
      or (public.get_my_audience() = 'internal'
          and public.get_my_role() in ('admin', 'owner'))
    )
  );

comment on policy hub_comments_author_update on public.hub_comments is
  'Authors can edit their own comments. Internal admin/owner can moderate '
  'any comment in their workspace (USING + WITH CHECK parity is required; '
  'prior migration 312 had author-only WITH CHECK which blocked moderation).';

-- ── 2. Missing FK / RLS-filter indexes ─────────────────────────────────────
create index if not exists idx_qb_deal_coach_actions_shown_by
  on public.qb_deal_coach_actions (shown_by)
  where shown_by is not null;

create index if not exists idx_qb_margin_thresholds_updated_by
  on public.qb_margin_thresholds (updated_by)
  where updated_by is not null;

create index if not exists idx_qb_quote_outcomes_captured_by
  on public.qb_quote_outcomes (captured_by)
  where captured_by is not null;

create index if not exists idx_qb_brand_sheet_sources_brand_id
  on public.qb_brand_sheet_sources (brand_id);
