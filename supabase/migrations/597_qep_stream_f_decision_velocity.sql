-- ============================================================================
-- Migration 597: extend qep_roadmap_stream enum with 'F' and seed Stream F rows
-- Stream F — Decision Velocity (from QEP_DECISION_INBOX_MOONSHOT_V2.md)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Extend the stream enum with 'F'
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'public.qep_roadmap_stream'::regtype
      AND enumlabel = 'F'
  ) THEN
    ALTER TYPE public.qep_roadmap_stream ADD VALUE 'F';
  END IF;
END$$;

COMMENT ON TYPE public.qep_roadmap_stream IS
  'A=Iron Quote · B=Sales-Advisor Field Platform · C=IntelliDealer Cutover · D=Parity Validation+Decision Resolution · E=Platform Foundation · F=Decision Velocity (Decision Inbox)';

COMMIT;

-- The enum value must be committed before the seed transaction can reference it.

BEGIN;

-- ----------------------------------------------------------------------------
-- 2. Seed 13 Stream F rows
-- ----------------------------------------------------------------------------
WITH seed(task_id, stream, wave, title, description, ship_state, owner, blocking_decision, depends_on, evidence_link, sort_order) AS (
  VALUES
  -- F1 — Foundation
  ('F1.1','F','F1','qep_decisions schema + auto-promote trigger','Migration 595 creates qep_decisions, qep_decision_blocks, qep_decision_precedents + the trigger that promotes pending_decision tasks to not_started on resolution.','shipped','Architect',NULL,NULL::text[],'supabase/migrations/595_qep_decisions.sql',6101),
  ('F1.2','F','F1','Seed the 10 audited decisions','Migration 596 inserts Q6, Q7, Q9, Q10, Q11, Q12, Q14, Q15, Q16, CYBER-INS with lane, recommendation, citations.','shipped','Brian',NULL,ARRAY['F1.1'],'supabase/migrations/596_qep_decisions_seed.sql',6102),
  ('F1.3','F','F1','Lane classifier edge function','Heuristics: touches money/contracts/schema → AUTHORIZE; reversible feature flag → AUTO; mid-reversibility policy → RATIFY. Runs on new pending_decision rows.','not_started','Engineer + AI',NULL,ARRAY['F1.1'],NULL,6103),
  ('F1.4','F','F1','Auto-triage pipeline edge function','Rewriter + classifier + router + citation finder + recommender. Generates a draft decision row for Brian to ratify.','not_started','Engineer + AI',NULL,ARRAY['F1.3'],NULL,6104),
  ('F1.5','F','F1','Brian triage queue at /decisions/triage','One-tap approval of the AI auto-triage. Brian becomes editor not author.','not_started','Engineer',NULL,ARRAY['F1.4'],NULL,6105),

  -- F2 — Owner channels (meet owners where they live)
  ('F2.1','F','F2','M365 email card with magic-link buttons','Send beautifully formatted card to the owner. Approve / Block / Need-info buttons are signed magic-link URLs that auto-authenticate and apply the answer.','not_started','Engineer + DevOps',NULL,ARRAY['F1.5'],NULL,6201),
  ('F2.2','F','F2','SMS card via Twilio','Single-line SMS with recommendation; reply YES / NO / more. Depends on BLK-7 A2P registration.','blocked','Engineer','BLK-7',ARRAY['F1.5'],NULL,6202),
  ('F2.3','F','F2','Linear comment bot','QEP-bot user posts recommendation as a Linear comment on the gated issue, @-mentions the owner.','not_started','Engineer',NULL,ARRAY['F1.5'],NULL,6203),
  ('F2.4','F','F2','Voice memo answer pipeline','Owner records voice memo to OneDrive watched folder. Whisper transcribes. AI extracts decision. Owner confirms via SMS or email.','not_started','Engineer + AI',NULL,ARRAY['F1.5','B2.2'],NULL,6204),
  ('F2.5','F','F2','/decisions web page (Quiet Operator + mobile swipe)','Fallback UI for owners who want to browse all open decisions. Swipe-driven, one decision per screen on mobile.','not_started','Engineer + Design',NULL,ARRAY['F1.5'],NULL,6205),

  -- F3 — Lane mechanics
  ('F3.1','F','F3','AUTO-lane shadow-ship infrastructure','Flag-scoped feature toggles. Recommendation goes live immediately for one rep; silence = ratification.','not_started','Engineer',NULL,ARRAY['F1.4'],NULL,6301),
  ('F3.2','F','F3','RATIFY-lane silence-based shipping (7d threshold)','Cron checks RATIFY-lane decisions past silence threshold. Auto-promotes to shadow_ship and notifies owner.','not_started','Engineer',NULL,ARRAY['F3.1'],NULL,6302),
  ('F3.3','F','F3','AUTHORIZE-lane two-party signing flow','Reuses Iron Quote e-signature (A3.5 / ADR-016). Required for JAR-103 (Tina+Ryan), future TILA decisions.','not_started','Engineer',NULL,ARRAY['F1.4','A3.5'],NULL,6303),

  -- F4 — Intelligence
  ('F4.1','F','F4','Precedent similarity matching','When new pending_decision arrives, search qep_decision_precedents for matching patterns. If similarity > 0.85, auto-triage suggests precedent answer.','not_started','Engineer + AI',NULL,ARRAY['F1.1','F1.4'],NULL,6401),
  ('F4.2','F','F4','Decision dependency graph + auto-recompute','When parent decision is answered, regenerate AI prep packet for dependent decisions with new context.','not_started','Engineer + AI',NULL,ARRAY['F1.1'],NULL,6402),
  ('F4.3','F','F4','Per-owner delegation toggles','Each owner sets per-class delegation (Rylee: Brian may answer copy/UX; Ryan: Brian may answer non-visual; etc.). Captured in audit.','not_started','Engineer',NULL,ARRAY['F2.5'],NULL,6403),
  ('F4.4','F','F4','Supersession detection','Scope-change watcher marks decisions as superseded when their gated tasks are descoped or rescoped.','not_started','Engineer',NULL,ARRAY['F1.1'],NULL,6404),

  -- F5 — Audit
  ('F5.1','F','F5','Tiered audit trail','AUTO: row only. RATIFY: row + rendered HTML in R2. AUTHORIZE: signed PDF with 7-year retention.','not_started','Engineer + DevOps',NULL,ARRAY['F3.3'],NULL,6501),
  ('F5.2','F','F5','Brian live-presence + DM-nudge surface','Brian sees "Rylee opened Q6 30s ago" + nudge button. Aging buckets + bottleneck dashboard.','not_started','Engineer',NULL,ARRAY['F1.5'],NULL,6502)
)
INSERT INTO public.qep_roadmap_tasks
  (task_id, stream, wave, title, description, ship_state, owner, blocking_decision, depends_on, evidence_link, sort_order)
SELECT
  task_id,
  stream::public.qep_roadmap_stream,
  wave,
  title,
  description,
  ship_state::public.qep_roadmap_ship_state,
  owner,
  blocking_decision,
  depends_on,
  evidence_link,
  sort_order
FROM seed
ON CONFLICT (task_id) DO UPDATE
SET title              = EXCLUDED.title,
    description        = EXCLUDED.description,
    stream             = EXCLUDED.stream,
    wave               = EXCLUDED.wave,
    blocking_decision  = EXCLUDED.blocking_decision,
    depends_on         = EXCLUDED.depends_on,
    evidence_link      = EXCLUDED.evidence_link,
    sort_order         = EXCLUDED.sort_order,
    ship_state         = CASE
                           WHEN public.qep_roadmap_tasks.ship_state IN ('shipped','in_progress','blocked','pending_decision','deferred')
                             AND EXCLUDED.ship_state = 'not_started'
                           THEN public.qep_roadmap_tasks.ship_state
                           ELSE EXCLUDED.ship_state
                         END,
    owner              = COALESCE(public.qep_roadmap_tasks.owner, EXCLUDED.owner);

COMMIT;
