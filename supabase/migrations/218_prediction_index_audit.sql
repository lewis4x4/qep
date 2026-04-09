-- Migration 218: Post-build audit — missing composite index on qrm_predictions.
--
-- The trace UI (/qrm/command/trace/:predictionId) and the nightly grader
-- both filter by (subject_id, predicted_at) but the existing composite index
-- leads with subject_type. This index optimizes rep-scoped and deal-scoped
-- lookups where subject_type is constant or absent.

CREATE INDEX IF NOT EXISTS idx_qrm_predictions_subject_id_time
  ON public.qrm_predictions (subject_id, predicted_at DESC);
