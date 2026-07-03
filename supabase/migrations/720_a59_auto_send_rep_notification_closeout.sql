-- ============================================================================
-- Migration 713: A5.9 auto-send rep notification copy closeout
--
-- QB-13 is implemented by the quote approval notification copy module, bell UI,
-- and decision flow ordering. Approved decisions now distinguish
-- approved-and-auto-sent, approved-but-auto-send-needs-attention, and
-- approved-return-to-rep outcomes without over-claiming customer delivery.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%720_a59_auto_send_rep_notification_closeout.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP-OMI-CONSOLIDATED-BUILD-PLAN.md QB-13') ||
      ' | supabase/functions/quote-builder-v2/quote-approval-notifications.ts' ||
      ' | supabase/functions/quote-builder-v2/quote-approval-notifications.test.ts' ||
      ' | supabase/functions/quote-builder-v2/index.ts' ||
      ' | apps/web/src/components/QbNotificationBell.tsx' ||
      ' | apps/web/src/components/QbNotificationBell.test.tsx' ||
      ' | docs/roadmap/epic-42-post-approval-routing.md' ||
      ' | supabase/migrations/720_a59_auto_send_rep_notification_closeout.sql'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] A5.9 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] A5.9 shipped: quote-approval-notifications derives rep-facing auto-send status as sent, failed, return_to_rep, or not_applicable from the manager decision and tryAutoSendApprovedQuote result. Approved+auto-sent copy says the quote was automatically sent to the customer and persists delivery event/public URL/PDF version metadata. Approved+send-failed copy says auto-send needs attention, stores a sanitized failure_code instead of raw provider errors, and tells the rep to open the quote to send or resolve blockers. Approved+return-to-rep copy stays "Quote approved" and "Ready to send to the customer" without implying automatic delivery. quote-builder-v2 computes autoSendResult before notifyRepOfApprovalDecision and passes it into the notification metadata. QbNotificationBell renders separate Auto-sent, Send needs attention, and Ready to send labels from metadata.auto_send.status.'
  END,
  updated_at = now()
WHERE task_id = 'A5.9';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'A5.9',
  'update',
  jsonb_build_object(
    'reason', 'a59_auto_send_rep_notification_closeout',
    'migration', '720_a59_auto_send_rep_notification_closeout.sql',
    'mission_alignment', 'pass: reps get accurate post-approval notification copy that prevents customer-delivery confusion while preserving fast equipment quote follow-up when auto-send succeeds',
    'implementation_evidence', jsonb_build_array(
      'supabase/functions/quote-builder-v2/quote-approval-notifications.ts deriveRepApprovalAutoSendStatus',
      'supabase/functions/quote-builder-v2/quote-approval-notifications.ts buildRepApprovalDecisionCopy',
      'supabase/functions/quote-builder-v2/quote-approval-notifications.ts buildRepApprovalDecisionMetadata safe auto_send metadata',
      'supabase/functions/quote-builder-v2/quote-approval-notifications.test.ts approved auto-sent copy and metadata coverage',
      'supabase/functions/quote-builder-v2/quote-approval-notifications.test.ts approved auto-send incomplete attention copy coverage',
      'supabase/functions/quote-builder-v2/quote-approval-notifications.test.ts approved return-to-rep copy and metadata coverage',
      'supabase/functions/quote-builder-v2/quote-approval-notifications.test.ts decision flow ordering proves notification receives autoSendResult after auto-send resolution',
      'apps/web/src/components/QbNotificationBell.tsx metadata.auto_send.status label mapping',
      'apps/web/src/components/QbNotificationBell.test.tsx bell labels for Auto-sent, Send needs attention, and Ready to send'
    ),
    'safety_bounds', jsonb_build_array(
      'notification copy does not claim customer delivery unless autoSendResult.sent is true',
      'failed auto-send metadata stores sanitized failure_code instead of raw provider errors',
      'return_to_rep stays explicit and keeps the rep in control of final customer send',
      'non-approved decisions omit auto_send metadata'
    ),
    'manual_boundaries', jsonb_build_array(
      'live provider delivery success still depends on configured send-package prerequisites and email/SMS provider availability',
      'staging end-to-end auto-send remains manual UAT because it requires approved package, generated PDF, and live delivery provider setup',
      'product choice of return_to_rep versus auto_send_customer default remains governed by Q6 decision evidence'
    )
  ),
  'codex'
);

COMMIT;
