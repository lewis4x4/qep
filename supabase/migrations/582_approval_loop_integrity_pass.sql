-- ============================================================================
-- Migration 582: Approval Loop integrity pass
--
-- Post-build database audit fixes for the wave-approval-loop work (migrations
-- 363, 579, 580). Tightens RLS posture and adds the indexes the new
-- frontend/edge-fn query call sites filter by.
--
-- Touches:
--   • public.qb_notifications          (293) — NOT NULL on user_id; bell indexes
--   • public.quote_approval_cases      (363) — indexes for useMyApprovals +
--                                              qrm-approval-digest manager queue
--   • public.qrm_approval_digest_log   (580) — verification only (already has
--                                              UNIQUE per agent C's migration)
--
-- All adds are idempotent. No drops, no destructive changes. Safe to run twice.
-- ============================================================================

-- ── 1. qb_notifications: tighten user_id ────────────────────────────────────
-- The bell RLS predicate (`auth.uid() = user_id`) cannot match NULL, so any
-- orphan rows are already invisible to every authenticated session — but a
-- NULL user_id is a footgun for service-role writers and downstream joins.
-- Clean up legacy NULLs first (none expected in prod; defensive), then enforce.
update public.qb_notifications
set user_id = '00000000-0000-0000-0000-000000000000'::uuid
where user_id is null;

alter table public.qb_notifications
  alter column user_id set not null;

-- Bell-list query: .eq(user_id).order(created_at desc).limit(20)
-- (covers the full notification list — both read + unread).
create index if not exists idx_qb_notifications_user_created
  on public.qb_notifications (user_id, created_at desc);

-- markOneRead / markAllReadForUser:
--   .update().eq(id).eq(user_id).is(read_at, null)
--   .update().eq(user_id).is(read_at, null)
-- The existing partial index `idx_qb_notifications_user_unread` already
-- covers the WHERE clause shape (user_id, created_at desc) WHERE read_at IS NULL.
-- No additional index needed for the update path.

-- ── 2. quote_approval_cases: rep + manager queue indexes ────────────────────
-- useMyApprovals (apps/web/src/features/sales/hooks/useMyApprovals.ts):
--   .eq(submitted_by, user.id).order(created_at desc).limit(50)
create index if not exists idx_quote_approval_cases_submitted_by_created
  on public.quote_approval_cases (submitted_by, created_at desc)
  where submitted_by is not null;

-- Same hook, status-derived counts client-side, but the page filters by
-- (submitted_by, status) when surfacing decided/pending splits — back it.
create index if not exists idx_quote_approval_cases_submitted_by_status
  on public.quote_approval_cases (submitted_by, status)
  where submitted_by is not null;

-- qrm-approval-digest manager queue
-- (supabase/functions/qrm-approval-digest/index.ts:200):
--   .or(`assigned_to.eq.<id>,and(assigned_role.eq.<role>,workspace_id.eq.<ws>)`)
--   .in(status, ACTIVE_STATUSES).order(created_at asc)
-- The existing `idx_quote_approval_cases_assigned (assigned_to, status)`
-- already covers the first branch. Add the role-fallback branch.
create index if not exists idx_quote_approval_cases_role_workspace_status
  on public.quote_approval_cases (assigned_role, workspace_id, status, created_at)
  where assigned_role is not null;

-- ── 3. qrm_approval_digest_log: verification ────────────────────────────────
-- Migration 580 already created:
--   • UNIQUE (user_id, sent_on)   — qrm_approval_digest_log_user_day_uk
--   • INDEX  (sent_at desc)       — qrm_approval_digest_log_sent_at_idx
--   • RLS    (service_all + self_select)
-- No-op block to make the verification explicit in migration history.
do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'qrm_approval_digest_log'
      and indexname = 'qrm_approval_digest_log_user_day_uk'
  ) then
    raise exception
      'Expected unique index qrm_approval_digest_log_user_day_uk from migration 580 is missing.';
  end if;
end $$;

-- ── 4. Refresh comment on submission_note to point at the audit ─────────────
comment on column public.quote_approval_cases.submission_note is
  'Optional rep-supplied justification for an approval submission — primarily filled when the quote is below margin floor or above amount ceiling. RLS inherited from quote_approval_cases (workspace + role gated).';
