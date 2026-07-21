-- 825_owner_answer_source_truth_reconciliation.sql
--
-- Ingests the 2026-07-20 owner-answer packet into the decision register,
-- reverses stale Q6/Q7/Q10/Q14/Q15/Q16 answers, and reconciles the roadmap
-- source of truth that Linear mirrors. No historical migration is rewritten.

begin;

-- ---------------------------------------------------------------------------
-- 1. Store every packet answer in the existing decision register.
-- ---------------------------------------------------------------------------

with packet as (
  select *
  from jsonb_to_recordset($packet$
  [
    {"code":"F1","question":"How should revenue categories work on mixed jobs?","owner_role":"finance","status":"answered","answer":"department_plus_segment","rationale":"Every charge lands in Equipment, Parts, Service, or Rental by its nature. Parts stay Parts even on a service WO; labor, mileage, hauling, and sublet roll to Service. Parts and Service lines also carry Customer, Warranty, Internal, or Sublet segment tags. Tax is a liability and fees return to the originating department."},
    {"code":"F2","question":"How should shared costs be allocated across branches?","owner_role":"finance","status":"answered","answer":"headcount","rationale":"Allocate shared company costs by branch headcount. Current effective-dated headcount values must be supplied and refreshed as staffing changes."},
    {"code":"F3","question":"How should owned equipment and rental-fleet depreciation be handled?","owner_role":"finance","status":"answered","answer":"straight_line_book_with_rental_basis_buydown","rationale":"Owned equipment uses straight-line book depreciation. Rental buy-down payments reduce unit basis. QEP OS carries book depreciation only; the CPA calculates bonus depreciation and Section 179 and reconciles tax back to the books."},
    {"code":"F4","question":"What are the lender-specific floor-plan terms and how is IBS treated?","owner_role":"finance","status":"open","answer":null,"rationale":"Six lenders are identified, but terms, interest, curtailment, and IBS treatment remain open until Tina supplies the lender schedules for a live working session."},
    {"code":"F5","question":"How are books closed and CPA adjustments posted?","owner_role":"finance","status":"answered","answer":"monthly_balance_quarterly_lock_dual_reopen","rationale":"Balance monthly and close quarterly. CPA adjustments post into QEP OS and flow downstream to QuickBooks Desktop. A closed quarter may reopen only with independent Ryan and Tina approval and a logged reason."},
    {"code":"F6","question":"How are open service jobs handled at the January 1 cutover?","owner_role":"finance","status":"answered","answer":"two_week_split_migrate_with_cost","rationale":"Finish short jobs in the legacy system. Migrate jobs unlikely to close within roughly two weeks of the January 1 cutover, tag them as migrated, and carry accumulated labor and parts cost."},
    {"code":"F7","question":"What invoice numbering format should QEP OS use?","owner_role":"finance","status":"answered","answer":"branch_department_five_digit_monotonic","rationale":"Use [Branch]-[Department][five-digit sequence]: branch 01 Lake City, 02 Belleview; departments E Equipment, R Rental, P Parts, W Service. Start at 00001 per branch and department and never reset. Preserve already-issued identifiers."},
    {"code":"F8","question":"How should customers and vendors match during migration?","owner_role":"finance","status":"answered","answer":"intellidealer_match_qep_id_xref","rationale":"Match on the IntelliDealer account number, create a fresh QEP OS ID, and retain the IntelliDealer account number as a permanent cross-reference."},
    {"code":"F9","question":"What are the statement, finance-charge, reminder, and credit-hold rules?","owner_role":"finance","status":"answered","answer":"monthly_1_5_compound_30_60","rationale":"Statements run on the first. Assess 1.5 percent monthly at 30 days, including unpaid prior finance charges, subject to the Florida lawful maximum. Remind between 30 and 60 days and cut off credit at 60 days. Automation must be monthly-idempotent and legally approved before compounding is enabled."},
    {"code":"F10","question":"What remains in QuickBooks Desktop and which bank accounts are reconciled?","owner_role":"finance","status":"answered","answer":"check_register_and_cpa_reporting_feed","rationale":"QuickBooks Desktop retains check cutting/check register and CPA-facing reports fed from QEP OS until retirement. Accounts: First Federal Operating, First Federal Wire, and Campus USA Savings; the wire account reconciles unit payoffs and equipment-deal wires."},
    {"code":"F11","question":"How are sale and rental security deposits tracked?","owner_role":"finance","status":"answered","answer":"separate_liability_subledgers_monthly_reconcile","rationale":"Sale deposits remain liabilities until invoice close and then apply as payment. Rental security deposits remain in a separate liability account until return; damages apply first, shortfall is billed, and the remainder is refunded. Reconcile both monthly."},
    {"code":"F12","question":"Which finance answers are written and which require a working session?","owner_role":"finance","status":"answered","answer":"written_except_f4_live","rationale":"F2-F11 are answered in writing except F4 lender and IBS terms, which require a live session after the schedules are available."},

    {"code":"SV1","question":"Does QEP have named maintenance plans today?","owner_role":"service","status":"answered","answer":"no_formal_catalog_today","rationale":"Service is currently as-needed/per-work-order and PM is case by case."},
    {"code":"SV2","question":"What triggers preventive maintenance?","owner_role":"service","status":"answered","answer":"hours_or_calendar_first","rationale":"PM is due on engine hours or calendar interval, whichever comes first."},
    {"code":"SV3","question":"Should BlackRock draft the initial service-plan catalog?","owner_role":"service","status":"answered","answer":"draft_provisional_catalog","rationale":"BlackRock is authorized to draft a first-pass catalog for later QEP review; provisional plans must not silently become customer-live."},
    {"code":"SV4","question":"What are the final service labor and mileage rates?","owner_role":"service","status":"answered","answer":"confirmed_rate_card","rationale":"Large construction/forestry 185 per hour; grapple/compact 165; field 185 plus 2 per round-trip mile for all service trucks; lube 135; specialty 195; internal 10 percent off door rate."},
    {"code":"SV5","question":"What service margin target and floor apply?","owner_role":"service","status":"answered","answer":"target_55_floor_35","rationale":"Service gross margin is labor sale minus technician labor cost, target 55 percent and floor 35 percent. Shop burden is below gross margin."},
    {"code":"SV6","question":"Which owner-facing service work types are required?","owner_role":"service","status":"answered","answer":"seven_work_types","rationale":"Customer, Internal, Warranty, PM/Maintenance, Rental Service, Hauling/Transport, and Comeback/Rework. Preserve payer and work-class dimensions instead of conflating them."},
    {"code":"SV7","question":"Which hold reasons are required?","owner_role":"service","status":"answered","answer":"five_hold_reasons","rationale":"Waiting on parts, customer approval, warranty authorization, sublet, or payment/deposit."},
    {"code":"SV8","question":"How is technician efficiency calculated?","owner_role":"service","status":"answered","answer":"billable_over_present_minus_hold","rationale":"Efficiency equals billable hours divided by hours present minus hold time."},
    {"code":"SV9","question":"Who is on the technician and driver roster with qualifications?","owner_role":"service","status":"open","answer":null,"rationale":"The service manager still owes the roster with branch, assignment, certifications, vendor logins, tenure, and work restrictions."},
    {"code":"SV10","question":"Does technician pay follow the worker or the job rate?","owner_role":"service","status":"answered","answer":"pay_follows_technician_scale","rationale":"Pay follows the technician and technician type, not the job door rate."},
    {"code":"SV11","question":"Is Driver a distinct role?","owner_role":"service","status":"answered","answer":"dedicated_driver_role","rationale":"Driver is a separate role and headcount, not merely a road-technician assignment."},
    {"code":"SV12","question":"What driver accountability evidence is required?","owner_role":"service","status":"answered","answer":"mileage_time_handoff_condition_fuel_dot_exceptions","rationale":"Capture mileage; departure/arrival/duration; customer handoff and delivery confirmation; equipment condition before and after; fuel and DOT logs; delays and exceptions. Do not track route taken."},
    {"code":"SV13","question":"Is hauling its own work order or a line on another job?","owner_role":"service","status":"answered","answer":"either_with_service_haul_tag","rationale":"Support both a standalone scheduled haul WO and a transport line on repair, rental, or sales work. In either case revenue is a distinct hauling line under Service."},
    {"code":"SV14","question":"How is hauling priced by scenario?","owner_role":"service","status":"answered","answer":"scenario_rate_policy","rationale":"Customer repair haul is negotiable; QEP sale haul is absorbed into deal margin; rental haul is retail; internal inventory moves are actual cost. Overrides require an explicit reason."},
    {"code":"SV15","question":"What are the final internal and retail haul-rate tables?","owner_role":"service","status":"open","answer":null,"rationale":"Internal values are supplied. Ryan is correcting retail figures that fall below internal values. Keep retail seeds inactive/provisional until the corrected sheet arrives."},
    {"code":"SV16","question":"What does Verizon Reveal version one include?","owner_role":"service","status":"answered","answer":"mileage_and_live_map","rationale":"Version one supplies billing mileage plus live map/ETA. Full vehicle/location synchronization is out of scope."},
    {"code":"SV17","question":"What happens when GPS mileage is unavailable?","owner_role":"service","status":"answered","answer":"manual_zero_blocking_review","rationale":"Allow manual mileage so billing does not stall, but flag the value for review."},
    {"code":"SV18","question":"What distinguishes a grapple build from a repair?","owner_role":"service","status":"answered","answer":"sellable_unit_is_build","rationale":"Anything creating a sellable unit is a build; all other work is a service repair. Build labor and parts capitalize into unit basis and FET scope; repairs are service revenue."},
    {"code":"SV19","question":"What metrics govern the grapple build scorecard?","owner_role":"service","status":"open","answer":null,"rationale":"The pay ladder stays the same, but build metrics remain to be defined; likely throughput, hours versus build-sheet estimate, rework/quality, and on-time completion."},
    {"code":"SV20","question":"What evidence and approval are required before grapple release?","owner_role":"service","status":"answered","answer":"service_manager_evidence_gate","rationale":"Service manager signoff plus completed build sheet, test/function run documentation, serial/component records, and finished-unit photos are required before release."},

    {"code":"RN1","question":"Who absorbs normal rental wear and PM?","owner_role":"rental","status":"answered","answer":"qep_absorbs_normal_wear_pm","rationale":"QEP absorbs normal wear and scheduled PM; the renter pays for damage and abuse."},
    {"code":"RN2","question":"Which renter-fault categories must the return inspection capture?","owner_role":"rental","status":"answered","answer":"seven_damage_categories","rationale":"Capture tire/track/undercarriage; glass/lights/mirrors; attachments; abusive hydraulic damage; fluid neglect; missing items; and excessive cleaning. Apply the security deposit to damage first."},
    {"code":"RN3","question":"How are rental PM work orders created?","owner_role":"rental","status":"answered","answer":"automatic_hours_or_calendar_internal_wo","rationale":"Every rental unit has hours-or-calendar PM that automatically opens an internal WO at door-minus-10 labor and cost-plus parts."},
    {"code":"RN4","question":"Where does rental service cost land?","owner_role":"rental","status":"answered","answer":"one_cost_two_ledgers","rationale":"Expense once to Rental P&L and also accumulate statistically on the unit for lifetime cost; the accumulator is not a second GL posting."},
    {"code":"RN5","question":"Where is rental tax sourced?","owner_role":"rental","status":"answered","answer":"destination_use_location","rationale":"Source tax to where the machine is delivered and used, the same destination rule as sales."},
    {"code":"RN6","question":"How do exemptions apply to rentals?","owner_role":"rental","status":"answered","answer":"sales_profile_rule_with_rental_certificate_check","rationale":"Use the customer-profile exemption rule, but Tina must verify each certificate covers rental use rather than purchases only."},
    {"code":"RN7","question":"How are rental security deposits reconciled?","owner_role":"rental","status":"answered","answer":"monthly_liability_reconciliation","rationale":"Reconcile the rental security-deposit liability account monthly and settle damage before refund."},
    {"code":"RN8","question":"How is rental hauling recorded?","owner_role":"rental","status":"answered","answer":"retail_customer_internal_transfer","rationale":"Bill the renter at retail haul rate and cost Rental at the internal haul rate on the same transport event, preserving the hauling spread."},
    {"code":"RN9","question":"How does paid rent and commission work when a rental converts to a sale?","owner_role":"rental","status":"answered","answer":"negotiated_credit_15_margin_net_rental_commission","rationale":"Rent credit is negotiated per deal. Conversion commission is 15 percent of margin less rental commission already paid on the unit, so rental commission must be tied to equipment as well as contract."},
    {"code":"RN10","question":"When does the rental commission clawback apply?","owner_role":"rental","status":"answered","answer":"any_refunded_rent_proportional_five_pct","rationale":"Any returned or refunded rent, including credit memos, corrections, or goodwill refunds, creates a proportional commission clawback at 5 percent."},

    {"code":"SA1","question":"When is the Rylee quote walkthrough performed?","owner_role":"sales","status":"answered","answer":"after_july_24_recorded_review","rationale":"Schedule after the July 24 Belleview opening and retain dated screenshots/PDF evidence."},
    {"code":"SA2","question":"How is Iron Quote compared with IntelliDealer?","owner_role":"sales","status":"answered","answer":"q02699_side_by_side_review","rationale":"Ryan performs a side-by-side review using deal Q02699 as the benchmark after July 24."},
    {"code":"SA3","question":"What outcomes may a quote review record?","owner_role":"sales","status":"answered","answer":"pass_pass_with_exceptions_fail","rationale":"Each review records pass, pass with exceptions, or fail with dated evidence."},
    {"code":"SA4","question":"When are the first three pilot customers named?","owner_role":"sales","status":"answered","answer":"after_both_reviews_pass","rationale":"Name the first three pilot customers in writing only after both reviews pass."},
    {"code":"SA5","question":"What happens after manager approval?","owner_role":"sales","status":"answered","answer":"rep_choice_default_route_back","rationale":"The rep chooses at submission whether approval auto-sends or routes back for a personal note; route-back is the sensible default."},
    {"code":"SA6","question":"May reps quote prospects and when are records created?","owner_role":"sales","status":"answered","answer":"quote_freely_prospect_at_send_customer_at_acceptance","rationale":"Allow prospect quotes. Create a prospect record when sent; convert to a full customer on acceptance and hand off to Tina or Ryan for credit terms and limit approval."},
    {"code":"SA7","question":"How are cash and financing rebates stacked?","owner_role":"sales","status":"answered","answer":"per_oem_program_effective_rule","rationale":"Stacking is dictated by each OEM program and effective date, sourced from manufacturer worksheets. No blanket QEP rule and no ungoverned rep case-by-case policy."},
    {"code":"SA8","question":"Which channels carry availability alerts?","owner_role":"sales","status":"answered","answer":"sms_and_8x8_dedup_with_mute","rationale":"Use both SMS and 8x8, dedupe the same business query, and allow each rep to mute one channel."},
    {"code":"SA9","question":"What is most prominent on the salesperson home screen?","owner_role":"sales","status":"answered","answer":"briefing_deals_followups_plus_persistent_quick_log","rationale":"Place AI daily briefing, open deals, and follow-ups front and center, with persistent one-tap quick logging."},
    {"code":"SA10","question":"How should voice capture be presented?","owner_role":"sales","status":"answered","answer":"one_button_classify_confirm_correct","rationale":"Use one combined voice button. The AI classifies quote, note, or CRM entry and shows the decision for confirmation/correction before navigation or mutation."}
  ]
  $packet$::jsonb) as x(
    code text,
    question text,
    owner_role text,
    status text,
    answer text,
    rationale text
  )
)
insert into public.qep_decisions (
  code,
  question_plain,
  lane,
  owner_role,
  options,
  recommended_option,
  recommended_rationale,
  citations,
  status,
  answered_by,
  answered_at,
  answered_option,
  answered_rationale,
  audit_url
)
select
  p.code,
  p.question,
  'authorize'::public.qep_decision_lane,
  p.owner_role,
  '[]'::jsonb,
  p.answer,
  p.rationale,
  jsonb_build_array(jsonb_build_object(
    'source', 'owner_packet',
    'ref', 'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md',
    'excerpt', 'Owner answer packet response ' || p.code
  )),
  p.status::public.qep_decision_status,
  case when p.status = 'answered' then 'Ryan McKenzie' else null end,
  case when p.status = 'answered' then now() else null end,
  p.answer,
  p.rationale,
  'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md'
from packet p
on conflict (code) do update set
  question_plain = excluded.question_plain,
  owner_role = excluded.owner_role,
  recommended_option = excluded.recommended_option,
  recommended_rationale = excluded.recommended_rationale,
  citations = excluded.citations,
  status = excluded.status,
  answered_by = excluded.answered_by,
  answered_at = excluded.answered_at,
  answered_option = excluded.answered_option,
  answered_rationale = excluded.answered_rationale,
  audit_url = excluded.audit_url,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. Apply explicit reversals/corrections to the older Q-coded decisions.
--    Prior answers remain preserved in qep_decision_precedents.
-- ---------------------------------------------------------------------------

with revised(code, answer, rationale, recommended) as (
  values
    ('Q6', 'rep_choice_default_return_to_rep', 'Owner packet SA5 supersedes the narrower auto-ratified default: the rep chooses auto-send or route-back on each approval submission; route-back remains the default.', 'rep_choice_default_return_to_rep'),
    ('Q7', 'allow_convert_at_acceptance', 'Owner packet SA6 reverses the 2026-06-30 denial. Reps may quote prospects; create the prospect at send, convert to a full customer at acceptance, and open Tina/Ryan credit approval for terms and limit.', 'allow_convert_at_acceptance'),
    ('Q10', 'per_oem', 'Owner packet SA7 reverses the case-by-case answer. Stacking is determined by the OEM program and effective-date rule sourced from manufacturer worksheets.', 'per_oem'),
    ('Q14', 'both', 'Owner packet SA8 chooses dual delivery: SMS and 8x8 with business-query deduplication and a per-rep channel mute.', 'both'),
    ('Q15', 'briefing_deals_followups', 'Owner packet SA9 chooses AI daily briefing, open deals, and follow-ups as the top three, plus persistent quick logging.', 'briefing_deals_followups'),
    ('Q16', 'collapse', 'Owner packet SA10 reverses the auto-lane relabel answer: expose one combined voice button and require classify/confirm/correct before commit.', 'collapse')
)
update public.qep_decisions d
set
  status = 'answered'::public.qep_decision_status,
  answered_option = r.answer,
  answered_rationale = r.rationale,
  answered_by = 'Ryan McKenzie',
  answered_at = now(),
  recommended_option = r.recommended,
  citations = coalesce(d.citations, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'source', 'owner_packet',
    'ref', 'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md',
    'excerpt', '2026-07-20 owner answer supersedes conflicting prior decision.'
  )),
  audit_url = 'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md',
  updated_at = now()
from revised r
where d.code = r.code;

-- Add the newly-authoritative answers to the precedent ledger. Existing rows
-- retain the prior answers, making reversals explicit rather than destructive.
insert into public.qep_decision_precedents (
  source_decision_id,
  pattern_summary,
  applied_answer,
  applied_rationale,
  owner_role
)
select
  d.id,
  d.question_plain,
  d.answered_option,
  d.answered_rationale,
  d.owner_role
from public.qep_decisions d
where d.code in ('Q6', 'Q7', 'Q10', 'Q14', 'Q15', 'Q16')
  and d.answered_option is not null;

-- ---------------------------------------------------------------------------
-- 3. Reconcile existing roadmap rows. Linear mirrors these substantive writes.
-- ---------------------------------------------------------------------------

update public.qep_roadmap_tasks
set
  title = 'Structured department + segment revenue classification',
  description = 'Implement the owner-approved two-layer model: Equipment, Parts, Service, and Rental departments by line nature; Customer, Warranty, Internal, and Sublet segment tags within Parts and Service. Parts on a service WO remain Parts revenue; labor, mileage, hauling, and sublet remain Service. Tax is a liability and fees follow the originating department.',
  ship_state = 'in_progress',
  blocking_decision = null,
  evidence_link = concat_ws(' | ', nullif(evidence_link, ''), 'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md', 'supabase/migrations/825_owner_answer_source_truth_reconciliation.sql'),
  notes = coalesce(notes, '') || E'\n[2026-07-20] Owner answer F1 clears BLK-FIN-WORKING-SESSION. Existing margin facts are the base; exact cross-module classification is now active implementation work.',
  updated_at = now()
where task_id = 'K2.1';

update public.qep_roadmap_tasks
set
  title = 'QuickBooks Desktop check-register + CPA-reporting feed / migration path',
  description = 'QEP OS is the forward accounting system of record and IntelliDealer is the transition SoR. QuickBooks Desktop remains the downstream check register and CPA-reporting destination fed by QEP OS until retirement. Continue the migration path for depreciation, open-WO carryover, normalized Desktop exports, and master reconciliation; lender terms and missing source exports are split into explicit blocked rows.',
  ship_state = 'in_progress',
  blocking_decision = null,
  evidence_link = concat_ws(' | ', nullif(evidence_link, ''), 'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md', 'supabase/migrations/825_owner_answer_source_truth_reconciliation.sql'),
  notes = coalesce(notes, '') || E'\n[2026-07-20] F3/F5-F11 answer the migration architecture and correct the QuickBooks wording. F4 and missing export samples are split into K3.2/K3.3 rather than keeping the whole row decision-blocked.',
  updated_at = now()
where task_id = 'K3.1';

update public.qep_roadmap_tasks
set
  title = 'Owner-ratified finance blueprint execution',
  description = 'Execute the ratified owner rules for department/segment accounting, headcount allocation, straight-line book depreciation, quarterly close/reopen, January 1 open-WO migration, five-digit branch/department numbering, IntelliDealer cross-reference matching, monthly AR policy, QuickBooks Desktop downstream outputs, and deposit liabilities. Exact headcounts, lender terms, and source exports remain separately tracked inputs.',
  ship_state = 'in_progress',
  blocking_decision = null,
  evidence_link = concat_ws(' | ', nullif(evidence_link, ''), 'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md', 'supabase/migrations/825_owner_answer_source_truth_reconciliation.sql'),
  notes = coalesce(notes, '') || E'\n[2026-07-20] F1-F12 resolve the blueprint direction. Work proceeds with exact external values isolated in M0.2/K3.2/K3.3.',
  updated_at = now()
where task_id = 'M0.1';

update public.qep_roadmap_tasks
set
  description = 'Ship monthly customer statements on the 1st, one finance-charge assessment per invoice per monthly period beginning at 30 days, daily reminder/hold evaluation without duplicate finance charges, and tax-remittance reporting. Compounding remains legally gated until approved even though the owner requested it; automated finance charges must honor the lawful cap.',
  ship_state = 'in_progress',
  blocking_decision = null,
  evidence_link = concat_ws(' | ', nullif(evidence_link, ''), 'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md', 'supabase/migrations/825_owner_answer_source_truth_reconciliation.sql'),
  notes = coalesce(notes, '') || E'\n[2026-07-20] F9 clears the policy blocker. A daily-run/monthly-charge idempotency fix and legal activation gate are required before customer billing.',
  updated_at = now()
where task_id = 'M6.1';

update public.qep_roadmap_tasks
set
  description = 'Draft a provisional BlackRock service-plan catalog, support hour-or-calendar intervals, attach plans to equipment, auto-generate deduplicated PM service jobs, prompt scheduling, and draw down agreement entitlements. Provisional plans remain inactive until QEP review; OEM kit/source blockers remain linked rather than fabricated.',
  ship_state = 'in_progress',
  blocking_decision = null,
  evidence_link = concat_ws(' | ', nullif(evidence_link, ''), 'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md', 'supabase/migrations/825_owner_answer_source_truth_reconciliation.sql'),
  notes = coalesce(notes, '') || E'\n[2026-07-20] SV1-SV3 explicitly authorize BlackRock to draft the first-pass catalog, clearing BLK-SERVICE-PLAN-CATALOG. Final activation still requires QEP review.',
  updated_at = now()
where task_id = 'H9.1';

update public.qep_roadmap_tasks
set
  description = 'Owner-approved per-submission choice is implemented: auto-send after approval or route back to the rep for a personal note, with route-back as the default.',
  blocking_decision = null,
  evidence_link = concat_ws(' | ', nullif(evidence_link, ''), 'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md'),
  notes = coalesce(notes, '') || E'\n[2026-07-20] SA5 confirms the shipped ReviewStep/post_approval_action behavior and clears stale Q6 metadata.',
  updated_at = now()
where task_id = 'A4.1';

update public.qep_roadmap_tasks
set
  title = 'Prospect quote lifecycle — create at send, convert at acceptance',
  description = 'Reverse the prior denial: allow a rep to build and save a prospect quote; create qrm_prospects when sent; convert atomically to a full customer at acceptance; open Tina/Ryan credit approval for terms and limit before unrestricted credit use.',
  ship_state = 'in_progress',
  blocking_decision = null,
  evidence_link = concat_ws(' | ', nullif(evidence_link, ''), 'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md', 'supabase/migrations/825_owner_answer_source_truth_reconciliation.sql'),
  notes = coalesce(notes, '') || E'\n[2026-07-20] SA6 reverses Q7=deny. Prior implementation evidence remains historical; this row is reopened for the new lifecycle.',
  updated_at = now()
where task_id = 'A4.2';

update public.qep_roadmap_tasks
set
  title = 'OEM-program rebate stacking policy',
  description = 'Cash/finance stacking is governed by each exact OEM program pair, effective date, and reviewed source worksheet. The fail-closed policy structure is implemented in migration 831, but real ASV/Yanmar/Bandit/CMI rules remain blocked on A7.3 source worksheets rather than guessed.',
  ship_state = 'in_progress',
  blocking_decision = null,
  evidence_link = concat_ws(' | ', nullif(evidence_link, ''), 'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md'),
  notes = coalesce(notes, '') || E'\n[2026-07-20] SA7 supersedes Q10=case_by_case with per-OEM-program governance. Schema/readiness work proceeds, but A4.3 is not shipped and A7.3 remains source-sheet blocked until reviewed manufacturer rules are loaded.',
  updated_at = now()
where task_id = 'A4.3';

update public.qep_roadmap_tasks
set
  title = 'Dual-channel availability alerts — SMS + 8x8',
  description = 'Deliver source-required availability queries through both SMS and 8x8, dedupe one business query across channels, persist delivery/retry evidence, and allow each rep to mute one channel.',
  ship_state = 'in_progress',
  blocking_decision = null,
  evidence_link = concat_ws(' | ', nullif(evidence_link, ''), 'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md', 'supabase/migrations/825_owner_answer_source_truth_reconciliation.sql'),
  notes = coalesce(notes, '') || E'\n[2026-07-20] SA8 answers Q14=both and converts this row from a decision item to implementation work.',
  updated_at = now()
where task_id = 'A4.5';

update public.qep_roadmap_tasks
set
  title = 'Sales-advisor home priority decision',
  description = 'Decision complete: AI daily briefing, open deals, and follow-ups are the top three; persistent quick logging stays one tap away. Implementation is tracked in B1.3.',
  ship_state = 'shipped',
  blocking_decision = null,
  evidence_link = concat_ws(' | ', nullif(evidence_link, ''), 'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md'),
  notes = coalesce(notes, '') || E'\n[2026-07-20] SA9 answers Q15. Prospecting-map embed is not in the selected top-three cut.',
  updated_at = now()
where task_id = 'A4.6';

update public.qep_roadmap_tasks
set
  title = 'Unified voice route decision',
  description = 'Decision complete: one combined voice button classifies quote, note, or CRM entry and requires confirmation/correction before navigation or mutation. Implementation is reopened in B1.1.',
  blocking_decision = null,
  evidence_link = concat_ws(' | ', nullif(evidence_link, ''), 'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md'),
  notes = coalesce(notes, '') || E'\n[2026-07-20] SA10 reverses Q16=relabel; the authoritative answer is collapse with classify/confirm/correct.',
  updated_at = now()
where task_id = 'A4.7';

update public.qep_roadmap_tasks
set
  title = 'One confirmed voice entry point on the advisor floor',
  description = 'Consolidate the floor voice actions into the existing Iron microphone/orchestrator. Show the inferred quote/note/CRM intent with a fast correction step before any navigation or write.',
  ship_state = 'in_progress',
  blocking_decision = null,
  evidence_link = concat_ws(' | ', nullif(evidence_link, ''), 'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md'),
  notes = coalesce(notes, '') || E'\n[2026-07-20] Reopened by SA10; prior relabel closeout is superseded.',
  updated_at = now()
where task_id = 'B1.1';

update public.qep_roadmap_tasks
set
  ship_state = 'na',
  blocking_decision = null,
  notes = coalesce(notes, '') || E'\n[2026-07-20] Q15/SA9 selected briefing, open deals, and follow-ups. An embedded prospecting map is not part of this cut; click-through remains available.',
  updated_at = now()
where task_id in ('B1.2', 'B6.2');

update public.qep_roadmap_tasks
set
  title = 'Advisor home — briefing, open deals, follow-ups, persistent quick log',
  description = 'Reorder the advisor home so AI daily briefing, open deals, and follow-ups are the primary three cards. Reuse the shipped one-tap activity logger as a persistent quick-log action across the floor surface.',
  ship_state = 'in_progress',
  blocking_decision = null,
  evidence_link = concat_ws(' | ', nullif(evidence_link, ''), 'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md'),
  notes = coalesce(notes, '') || E'\n[2026-07-20] SA9 supplies the priority order and expands this from a narrative-depth check into the owner-approved home cut.',
  updated_at = now()
where task_id = 'B1.3';

-- ---------------------------------------------------------------------------
-- 4. Split narrow external blockers and exact implementation gaps into rows.
-- ---------------------------------------------------------------------------

insert into public.qep_roadmap_tasks (
  task_id, stream, wave, title, description, ship_state, owner,
  blocking_decision, depends_on, evidence_link, notes, sort_order
)
values
  (
    'K3.2', 'K', 'K3', 'Lender floor-plan terms + IBS configuration',
    'Configure unit-level terms, interest, curtailment, and payoff rules for Wells Fargo, Bank of Oklahoma, Northpoint Financial, Incredible Bank, US Bank, Mitsubishi Finance, plus the final IBS treatment. Do not infer values.',
    'blocked', 'Tina + Finance + Engineer', 'BLK-FIN-LENDER-SCHEDULES', array['K3.1'],
    'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md',
    '[2026-07-20] F4 remains intentionally blocked until Tina provides all lender schedules and IBS evidence.', 8305
  ),
  (
    'K3.3', 'K', 'K3', 'QuickBooks Desktop check-register + CPA export adapter',
    'Build a normalized downstream finance export ledger, then emit the exact QuickBooks Desktop check-register and CPA-reporting formats Tina/CPA approve. QEP OS remains the ledger; this adapter never owns AR/AP truth.',
    'blocked', 'Tina + CPA + Engineer', 'BLK-FINANCE-EXPORT-SAMPLES', array['K3.1'],
    'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md',
    '[2026-07-20] F10 defines the boundary. Exact Desktop version and sample IIF/CSV/report output are still owed.', 8306
  ),
  (
    'M0.2', 'M', 'M0', 'Effective-dated branch headcount allocation values',
    'Load current headcount per branch into the finance allocation source, with effective dates and an auditable refresh path. F2 answers the method but not the actual values.',
    'blocked', 'Tina + Finance', 'BLK-BRANCH-HEADCOUNT', array['M0.1'],
    'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md',
    '[2026-07-20] Method=headcount is ratified; current branch counts remain an external value blocker.', 9108
  ),
  (
    'H7.2', 'H', 'H7', 'Corrected retail haul-rate catalog',
    'Publish five truck classes by three mileage bands and minimums as admin-maintainable customer rates after Ryan corrects values that fall below internal. Internal and retail snapshots must coexist on each haul.',
    'blocked', 'Ryan + Service + Engineer', 'BLK-SERVICE-RETAIL-HAUL-RATES', array['H7.1'],
    'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md',
    '[2026-07-20] SV15 leaves retail figures provisional; no suspect price is activated.', 8016
  ),
  (
    'H13.2', 'H', 'H13', 'Service technician + dedicated-driver roster',
    'Load branch, assignment, certifications, vendor logins, tenure, and work restrictions for technicians and dedicated drivers; use the roster to govern assignment and permissions.',
    'blocked', 'Service Manager', 'BLK-SERVICE-ROSTER', array['H13.1'],
    'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md',
    '[2026-07-20] SV9 remains blocked on the service-manager roster.', 8017
  ),
  (
    'I9.1', 'I', 'I9', 'Grapple build scorecard metrics',
    'Define and implement build-specific throughput, hours-versus-estimate, rework/quality, and on-time metrics without reusing repair billable-efficiency as the score.',
    'blocked', 'Ryan + Service + Engineer', 'BLK-GRAPPLE-METRICS', array['I1.1', 'I6.1', 'I7.1'],
    'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md',
    '[2026-07-20] SV19 confirms the distinct scorecard but leaves metric definitions open.', 8109
  ),
  (
    'L12.1', 'L', 'L12', 'Rental-to-sale credit, net conversion commission, and refund clawback',
    'Persist negotiated rent credit per conversion; calculate sale commission as 15 percent of margin less rental commission already paid on the unit; post a proportional 5 percent clawback for every refunded rent event.',
    'in_progress', 'Engineer + Finance', null, array['L10.3', 'L11.2'],
    'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md',
    '[2026-07-20] RN9-RN10 close the policy gap left by contract-level attribution.', 9023
  ),
  (
    'L12.2', 'L', 'L12', 'Rental-use tax-exemption certificate verification',
    'Verify and evidence that every exempt customer certificate covers rental use, not only purchases, before rental tax exemption is applied.',
    'blocked', 'Tina + Finance', 'BLK-RENTAL-TAX-CERTS', array['L10.1'],
    'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md',
    '[2026-07-20] RN6 answers the rule but leaves certificate evidence verification open.', 9024
  )
on conflict (task_id) do update set
  title = excluded.title,
  description = excluded.description,
  ship_state = excluded.ship_state,
  owner = excluded.owner,
  blocking_decision = excluded.blocking_decision,
  depends_on = excluded.depends_on,
  evidence_link = excluded.evidence_link,
  notes = excluded.notes,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Preserve explicit audit evidence for both changed and created roadmap rows.
insert into public.qep_roadmap_sync_events (
  direction, task_id, action, changed_fields, actor
)
select
  'reconcile',
  x.task_id,
  x.action,
  jsonb_build_object(
    'reason', '2026_07_20_owner_answer_packet',
    'migration', '825_owner_answer_source_truth_reconciliation.sql',
    'source', 'docs/operations/QEP_OWNER_ANSWER_PLACEMENT_2026-07-20.md',
    'mission_alignment', 'pass: owner decisions become auditable operating controls across equipment, parts, service, rental, finance, and sales while unresolved external evidence stays blocked'
  ),
  'codex'
from (
  select unnest(array[
    'K2.1','K3.1','M0.1','M6.1','H9.1',
    'A4.1','A4.2','A4.3','A4.5','A4.6','A4.7',
    'B1.1','B1.2','B1.3','B6.2'
  ]) as task_id, 'update'::text as action
  union all
  select unnest(array[
    'K3.2','K3.3','M0.2','H7.2','H13.2','I9.1','L12.1','L12.2'
  ]) as task_id, 'create'::text as action
) x;

commit;

-- Rollback / fix-forward notes:
--   This migration records owner decisions and roadmap/Linear source truth.
--   Never delete the answer packet, decision history, sync events, or blocker
--   rows. If an answer changes, supersede it with a dated decision and roadmap
--   update in a later migration so the original evidence remains auditable.
