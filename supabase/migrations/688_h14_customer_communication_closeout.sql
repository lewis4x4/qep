-- ============================================================================
-- Migration 688: H14.1 customer communication closeout
--
-- H14 automatic customer notifications already route through the service
-- lifecycle helpers, the durable notification queue, and the dispatch worker.
-- Record the roadmap state with concrete implementation evidence.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%service-customer-notification-queue.ts%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H14') ||
      ' | supabase/migrations/640_service_h14_customer_communication.sql' ||
      ' | supabase/functions/_shared/service-lifecycle-notify.ts' ||
      ' | supabase/functions/_shared/service-customer-notification-queue.ts' ||
      ' | supabase/functions/_shared/service-customer-notification-queue.test.ts' ||
      ' | supabase/functions/service-job-router/index.ts' ||
      ' | supabase/functions/service-customer-notify-dispatch/index.ts'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] H14.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] H14.1 shipped: service lifecycle transitions now enqueue durable customer notifications for quote_sent/awaiting approval, in_progress/work started, blocked_waiting with waiting_on_parts_sublet, ready_for_pickup, invoice_ready, and promised_at changes. The queue records portal/email/SMS rows with H14 dedupe keys, never blocks the work order when provider credentials or customer recipients are missing, and service-customer-notify-dispatch retries queued email/SMS rows when Twilio/Resend credentials are configured.'
  END,
  updated_at = now()
WHERE task_id = 'H14.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'H14.1',
  'update',
  jsonb_build_object(
    'reason', 'h14_customer_communication_closeout',
    'migration', '688_h14_customer_communication_closeout.sql',
    'mission_alignment', 'pass: service writers get fewer status-check calls because customer-visible work started, approval, parts hold, pickup, invoice, and promised-date changes are recorded automatically with safe email/SMS dispatch fallback',
    'implementation_evidence', jsonb_build_array(
      'supabase/migrations/640_service_h14_customer_communication.sql dedupe and pending-dispatch indexes',
      'supabase/functions/_shared/service-lifecycle-notify.ts notifyAfterStageChange stage-to-notification mapping',
      'supabase/functions/_shared/service-lifecycle-notify.ts notifyPromisedDateChanged',
      'supabase/functions/_shared/service-customer-notification-queue.ts portal/email/SMS queue with advisor fallback',
      'supabase/functions/_shared/service-customer-notification-queue.test.ts H14 queue and lifecycle tests',
      'supabase/functions/service-job-router/index.ts transition/update hooks',
      'supabase/functions/service-customer-notify-dispatch/index.ts retryable Twilio/Resend dispatch worker'
    )
  ),
  'codex'
);

COMMIT;
