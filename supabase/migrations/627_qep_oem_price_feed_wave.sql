-- ============================================================================
-- Migration 627: OEM Price Feed wave + answered discovery decisions
-- Target: QEP Supabase project (iciddijgonywtxoelous)
-- Source: QEP-OEM-Price-Feeds-Discovery-FILLED.docx (owner-answered 2026-05-17)
--
-- Adds to the roadmap a new Stream A wave (A7 — OEM Price Feed): a background
-- system that ingests manufacturer price sheets, finds mispriced open quotes,
-- and surfaces rep-approved re-pricing with margin-floor protection.
--
-- Three parts:
--   1. Stream A wave A7 — 9 build tasks (A7.1–A7.9)
--   2. Stream D wave D3 — 2 blocking-gate rows (D3.13 NDA, D3.14 sample sheets)
--   3. qep_decisions — the 10 OEM discovery decisions recorded as answered
--      (status='answered'; the AFTER UPDATE promote-trigger does not fire on
--      INSERT, and no task is gated on an OEM-DP code, so this is side-effect
--      free — it is purely the recorded rulebook).
--
-- Idempotent: ON CONFLICT (task_id / code) DO UPDATE.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1 + 2. Roadmap rows — A7 wave + D3 OEM blocker gates
-- ----------------------------------------------------------------------------
WITH seed(task_id, stream, wave, title, description, ship_state, owner, blocking_decision, depends_on, evidence_link, sort_order) AS (
  VALUES
  ('A7.1','A','A7','OEM price-sheet schema',
   'Tables for OEM price sheets, price lines, and sheet versions with diff support. Covers ASV, Yanmar, Bandit, Develon, CMI.',
   'not_started','Architect',NULL,NULL::text[],'QEP-OEM-Price-Feeds-Discovery-FILLED.docx',701),

  ('A7.2','A','A7','OEM price-sheet upload UI',
   'Ops admin uploads a CSV or PDF price sheet. Phase 1 manual ingest. Blocked until sample sheets and the NDA clearance land.',
   'blocked','Engineer','BLK-OEM-SHEETS',ARRAY['A7.1','D3.13','D3.14'],'QEP-OEM-Price-Feeds-Discovery-FILLED.docx',702),

  ('A7.3','A','A7','OEM price-sheet parser',
   'Parse CSV and PDF price sheets. ASV and Yanmar arrive as PDF; Bandit and CMI format TBD per OEM-DP4. Blocked on sample sheets.',
   'blocked','Engineer','BLK-OEM-SHEETS',ARRAY['A7.1','D3.14'],'QEP-OEM-Price-Feeds-Discovery-FILLED.docx',703),

  ('A7.4','A','A7','Price diff engine',
   'Compare a new sheet against the last known prices — what went up, down, is new, was discontinued.',
   'not_started','Engineer',NULL,ARRAY['A7.1','A7.3'],'QEP-OEM-Price-Feeds-Discovery-FILLED.docx',704),

  ('A7.5','A','A7','Open-quote mispricing scan',
   'Scan every open quote for lines now mispriced. In-stock units stay at QEP old cost basis per OEM-DP8; on-order units re-price to current list.',
   'not_started','Engineer',NULL,ARRAY['A7.4'],'QEP-OEM-Price-Feeds-Discovery-FILLED.docx',705),

  ('A7.6','A','A7','Price Impact card + Today-screen chip',
   'Rep-facing surface: a tappable chip and an impact card. Alert threshold is >2% on a line OR >$1,000 quote impact per OEM-DP5. Shows a commission-delta line per OEM-DP10.',
   'not_started','Engineer + Design',NULL,ARRAY['A7.5'],'QEP-OEM-Price-Feeds-Discovery-FILLED.docx',706),

  ('A7.7','A','A7','Re-price action with margin-floor gate',
   'One-tap re-price when the result stays at or above margin floor per OEM-DP1; below floor forces individual review. Never auto-sends to the customer per OEM-DP2. Freight, rebate, or incentive changes force manager review per OEM-DP9.',
   'not_started','Engineer',NULL,ARRAY['A7.6'],'QEP-OEM-Price-Feeds-Discovery-FILLED.docx',707),

  ('A7.8','A','A7','Price-lock customer attribute',
   'Add a price-lock attribute to the customer model so locked customers can be excluded from auto re-pricing. OEM-DP6 future hook — no locked customers exist today.',
   'not_started','Architect',NULL,ARRAY['A7.1'],'QEP-OEM-Price-Feeds-Discovery-FILLED.docx',708),

  ('A7.9','A','A7','Re-price audit log + 7-day reversibility',
   'Every re-price action is logged and reversible for 7 days per the discovery-doc risk register.',
   'not_started','Engineer',NULL,ARRAY['A7.7'],'QEP-OEM-Price-Feeds-Discovery-FILLED.docx',709),

  ('D3.13','D','D3','OEM price-data NDA / legal clearance',
   'Confirm legal and compliance are OK storing OEM list-price data inside QEP OS. Some manufacturer agreements restrict redistribution. Gates OEM price ingestion.',
   'blocked','Rylee','BLK-OEM-NDA',NULL::text[],'QEP-OEM-Price-Feeds-Discovery-FILLED.docx §5',3313),

  ('D3.14','D','D3','OEM sample price sheets + Bandit/CMI format',
   'Collect 3 recent price sheets each from ASV, Yanmar, Bandit in original format, and confirm the file-delivery format for Bandit and CMI with their OEM reps. Gates the parser build.',
   'blocked','Rylee + Norman','BLK-OEM-SHEETS',NULL::text[],'QEP-OEM-Price-Feeds-Discovery-FILLED.docx §4 + §5',3314)
)
INSERT INTO public.qep_roadmap_tasks
  (task_id, stream, wave, title, description, ship_state, owner, blocking_decision, depends_on, evidence_link, sort_order)
SELECT
  task_id, stream::public.qep_roadmap_stream, wave, title, description,
  ship_state::public.qep_roadmap_ship_state, owner, blocking_decision, depends_on, evidence_link, sort_order
FROM seed
ON CONFLICT (task_id) DO UPDATE
SET title             = EXCLUDED.title,
    description       = EXCLUDED.description,
    stream            = EXCLUDED.stream,
    wave              = EXCLUDED.wave,
    blocking_decision = EXCLUDED.blocking_decision,
    depends_on        = EXCLUDED.depends_on,
    evidence_link     = EXCLUDED.evidence_link,
    sort_order        = EXCLUDED.sort_order,
    ship_state        = CASE
                          WHEN public.qep_roadmap_tasks.ship_state IN ('shipped','in_progress','deferred')
                          THEN public.qep_roadmap_tasks.ship_state
                          ELSE EXCLUDED.ship_state
                        END,
    owner             = COALESCE(public.qep_roadmap_tasks.owner, EXCLUDED.owner);

-- ----------------------------------------------------------------------------
-- 3. The 10 OEM discovery decisions, recorded as answered
-- ----------------------------------------------------------------------------
INSERT INTO public.qep_decisions
  (code, question_plain, lane, owner_role, options, recommended_option, recommended_rationale,
   status, answered_by, answered_at, answered_option, answered_rationale)
VALUES
  ('OEM-DP1',
   $qep$When the system detects OEM price changes, how much trust before a rep can act?$qep$,
   'ratify','rylee',
   $qep$[{"label":"A","description":"Always line-item review"},{"label":"B","description":"One-tap re-price within margin policy"},{"label":"C","description":"Fully autonomous"}]$qep$::jsonb,
   'B', $qep$Engineering recommended Option B for Phase 1.$qep$,
   'answered','Rylee McKenzie (OEM Price Feeds discovery)', '2026-05-17T00:00:00Z',
   'B', $qep$One-tap re-price when within margin floor; below floor forces individual review with approval routing.$qep$),

  ('OEM-DP2',
   $qep$When a re-priced quote is generated, does it auto-send or wait for rep review?$qep$,
   'ratify','rylee',
   $qep$[{"label":"A","description":"Always rep review before customer sees it"},{"label":"B","description":"Auto-send if margin improved, review if worsened"},{"label":"C","description":"Auto-send everything"}]$qep$::jsonb,
   'B', $qep$Engineering recommended Option B.$qep$,
   'answered','Rylee McKenzie (OEM Price Feeds discovery)', '2026-05-17T00:00:00Z',
   'A', $qep$OVERRODE engineering. A re-priced quote NEVER auto-sends. The rep reviews and clicks Send regardless of margin direction — consistent with the rep owning every customer-facing send.$qep$),

  ('OEM-DP3',
   $qep$Above what dollar or percentage delta does a re-price require manager sign-off?$qep$,
   'ratify','rylee',
   $qep$[{"label":"dollar_bands","description":"Tiered dollar-value approval thresholds"},{"label":"floor_only","description":"Margin floor is the sole gate, no dollar bands"}]$qep$::jsonb,
   'dollar_bands', $qep$Engineering offered a sample tiered dollar-band policy.$qep$,
   'answered','Rylee McKenzie (OEM Price Feeds discovery)', '2026-05-17T00:00:00Z',
   'floor_only', $qep$OVERRODE engineering. No dollar-value thresholds. The margin floor is the sole approval gate, consistent with Tier 1.$qep$),

  ('OEM-DP4',
   $qep$Which manufacturers do we build price-feed ingest for first?$qep$,
   'ratify','rylee',
   $qep$[{"label":"ranked","description":"Rank the top 3 to 5 manufacturers by quote volume"}]$qep$::jsonb,
   'ranked', $qep$Engineering asked for the top 3 to 5 by quote volume.$qep$,
   'answered','Rylee McKenzie (OEM Price Feeds discovery)', '2026-05-17T00:00:00Z',
   'ranked', $qep$Order: ASV, Yanmar, Bandit, Develon, CMI — all on a quarterly cadence. ASV and Yanmar are PDF; Bandit and CMI format to be confirmed with OEM reps; Develon is Excel.$qep$),

  ('OEM-DP5',
   $qep$How small a price change is worth alerting the rep about?$qep$,
   'ratify','rylee',
   $qep$[{"label":"A","description":"Any change above 0%"},{"label":"B","description":"Above 1% or $500 total impact"},{"label":"C","description":"Above 2% or $1,000 total impact"},{"label":"D","description":"Custom per manufacturer"}]$qep$::jsonb,
   'B', $qep$Engineering recommended Option B.$qep$,
   'answered','Rylee McKenzie (OEM Price Feeds discovery)', '2026-05-17T00:00:00Z',
   'C', $qep$OVERRODE engineering. Quieter threshold — alert only above 2% on a line or $1,000 total quote impact. Smaller changes apply silently with a log entry.$qep$),

  ('OEM-DP6',
   $qep$Do any customers have negotiated price-lock contracts that must not be re-priced?$qep$,
   'ratify','rylee',
   $qep$[{"label":"flag","description":"Flag locked customers explicitly"},{"label":"none","description":"No locked customers today"}]$qep$::jsonb,
   'flag', $qep$Engineering recommended flagging locked customers explicitly rather than silent exclusion.$qep$,
   'answered','Rylee McKenzie (OEM Price Feeds discovery)', '2026-05-17T00:00:00Z',
   'none', $qep$No customers under price-lock today. Build a price-lock customer attribute anyway as a future hook so national or government accounts can be excluded later without a schema change.$qep$),

  ('OEM-DP7',
   $qep$Do any manufacturers grant a pricing-protection window on quotes dated before a change?$qep$,
   'ratify','rylee',
   $qep$[{"label":"per_oem","description":"Capture a protection window per manufacturer"},{"label":"none","description":"Assume no protection unless stated"}]$qep$::jsonb,
   'none', $qep$Engineering recommended assuming no protection unless told otherwise.$qep$,
   'answered','Rylee McKenzie (OEM Price Feeds discovery)', '2026-05-17T00:00:00Z',
   'none', $qep$No QEP manufacturer formally honors old prices for a defined window. No quote-date exception logic. In-stock units stay locked, but that is inventory cost basis, not OEM protection — see OEM-DP8.$qep$),

  ('OEM-DP8',
   $qep$When equipment is already in the yard at old cost, does the new list price apply to it?$qep$,
   'ratify','rylee',
   $qep$[{"label":"A","description":"Stock units stay at old cost"},{"label":"B","description":"Stock units re-price to current sheet"},{"label":"C","description":"Per-OEM rule"}]$qep$::jsonb,
   'A', $qep$Engineering recommended Option A.$qep$,
   'answered','Rylee McKenzie (OEM Price Feeds discovery)', '2026-05-17T00:00:00Z',
   'A', $qep$In-stock units stay anchored to QEP actual cost basis. The rep or Sales Manager chooses per quote whether to pass the savings or capture margin; the system shows both with the delta. On-order units re-price to current list at commitment.$qep$),

  ('OEM-DP9',
   $qep$Should list, freight, rebate, and incentive changes all be treated the same way?$qep$,
   'ratify','rylee',
   $qep$[{"label":"split","description":"List and freight standard flow; rebate and incentive require manager review"},{"label":"all_review","description":"All four require manager review"}]$qep$::jsonb,
   'split', $qep$Engineering recommended list and freight as standard flow, rebate and incentive as manager review.$qep$,
   'answered','Rylee McKenzie (OEM Price Feeds discovery)', '2026-05-17T00:00:00Z',
   'all_review', $qep$OVERRODE engineering — most conservative. Any re-price touching list, freight, rebate, or incentive routes to the Sales Manager. This overrides the OEM-DP1 one-tap flow whenever those categories are touched.$qep$),

  ('OEM-DP10',
   $qep$Re-pricing can change a rep commission. How is that handled?$qep$,
   'ratify','rylee',
   $qep$[{"label":"A","description":"Never auto-lower commission without acknowledgement"},{"label":"B","description":"Silently recalculate"},{"label":"C","description":"Recalculate and show a commission-delta line"}]$qep$::jsonb,
   'C', $qep$Engineering recommended Option C.$qep$,
   'answered','Rylee McKenzie (OEM Price Feeds discovery)', '2026-05-17T00:00:00Z',
   'C', $qep$Commission recalculates at 15% of gross margin and the impact card shows old, new, and delta. Never silent. Where the 80/20 split applies, both rep shares show their delta.$qep$)
ON CONFLICT (code) DO UPDATE
SET question_plain        = EXCLUDED.question_plain,
    lane                  = EXCLUDED.lane,
    owner_role            = EXCLUDED.owner_role,
    options               = EXCLUDED.options,
    recommended_option    = EXCLUDED.recommended_option,
    recommended_rationale = EXCLUDED.recommended_rationale,
    status                = EXCLUDED.status,
    answered_by           = EXCLUDED.answered_by,
    answered_at           = EXCLUDED.answered_at,
    answered_option       = EXCLUDED.answered_option,
    answered_rationale    = EXCLUDED.answered_rationale;

COMMIT;
