-- ============================================================================
-- Migration 685: H11.1 service metrics dashboard closeout
--
-- The H11 metrics backend and web dashboard already shipped. Record the
-- roadmap state with concrete evidence across SQL views, API normalizers,
-- tests, and UI.
-- ============================================================================

BEGIN;

UPDATE public.qep_roadmap_tasks
SET
  ship_state = 'shipped',
  blocking_decision = NULL,
  evidence_link = CASE
    WHEN COALESCE(evidence_link, '') LIKE '%supabase/migrations/638_service_h11_metrics_dashboard.sql%'
      THEN evidence_link
    ELSE COALESCE(NULLIF(evidence_link, ''), 'QEP_SERVICE_ROADMAP_ALIGNMENT_2026-05-29.md Appendix A H11') ||
      ' | supabase/migrations/638_service_h11_metrics_dashboard.sql' ||
      ' | apps/web/src/features/service/lib/service-metrics-api.ts' ||
      ' | apps/web/src/features/service/lib/service-metrics-api.test.ts' ||
      ' | apps/web/src/features/service/pages/ServiceMetricsDashboardPage.tsx' ||
      ' | apps/web/src/App.tsx'
  END,
  notes = CASE
    WHEN COALESCE(notes, '') LIKE '%[2026-07-03] H11.1 shipped%'
      THEN notes
    ELSE COALESCE(notes, '') ||
      E'\n[2026-07-03] H11.1 shipped: v_service_metrics_margin_by_request_type headlines owner margin by WO type from H1 quote-line margin fields; v_service_metrics_owner_watch reports cycle time, comeback rate, technician efficiency, labor recovery, warranty recovery, shop/field mix, open WOs/holds, and hours-to-first-touch; cycle-time and open-WO breakdown views are consumed by the ServiceMetricsDashboardPage route with focused API normalizer tests.'
  END,
  updated_at = now()
WHERE task_id = 'H11.1';

INSERT INTO public.qep_roadmap_sync_events
  (direction, task_id, action, changed_fields, actor)
VALUES (
  'reconcile',
  'H11.1',
  'update',
  jsonb_build_object(
    'reason', 'h11_service_metrics_dashboard_closeout',
    'migration', '692_h11_service_metrics_dashboard_closeout.sql',
    'mission_alignment', 'pass: service leadership gets margin-by-WO-type first, plus cycle time, comeback rate, efficiency, warranty recovery, shop/field mix, open-WO holds, labor recovery, and first-touch evidence without manual spreadsheet reconciliation',
    'implementation_evidence', jsonb_build_array(
      'public.v_service_metrics_margin_by_request_type',
      'public.v_service_metrics_owner_watch',
      'public.v_service_metrics_cycle_time_by_segment',
      'public.v_service_metrics_open_wo_by_status',
      'public.v_service_metrics_open_wo_by_hold_reason',
      'apps/web/src/features/service/lib/service-metrics-api.ts',
      'apps/web/src/features/service/lib/service-metrics-api.test.ts',
      'apps/web/src/features/service/pages/ServiceMetricsDashboardPage.tsx',
      'apps/web/src/App.tsx route /service/metrics'
    )
  ),
  'codex'
);

COMMIT;
