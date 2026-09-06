// Synthetic in-memory records only. These are not human accounts or production credentials.
export const DUMMY_SUPABASE = "https://qep-ui-test.invalid";
export const WORKSPACE = "ui-fixture";
export const IDS = { user: "00000000-0000-4000-8000-000000000001", company: "00000000-0000-4000-8000-000000000002", machine: "00000000-0000-4000-8000-000000000003", deal: "00000000-0000-4000-8000-000000000004", stage: "00000000-0000-4000-8000-000000000005", job: "00000000-0000-4000-8000-000000000006", segment: "00000000-0000-4000-8000-000000000007", bill: "00000000-0000-4000-8000-000000000008", appraisal: "00000000-0000-4000-8000-000000000009", employee: "00000000-0000-4000-8000-000000000010", subject: "00000000-0000-4000-8000-000000000011" };
export function profileFor(role) { return { id: IDS.user, full_name: `Fixture ${role}`, email: `${role}@ui-fixture.invalid`, role, iron_role: role === "rep" ? "iron_advisor" : null, iron_role_display: null, is_support: false, active_workspace_id: WORKSPACE, workspace_id: WORKSPACE, audience: "internal", stakeholder_subrole: null, floor_mode: false }; }
const now = new Date().toISOString();
const date = now.slice(0, 10);
export const company = { id: IDS.company, workspace_id: WORKSPACE, name: "Fixture Equipment Customer", phone: "555-0100", city: "Test City", state: "FL", assigned_rep_id: IDS.user, created_at: now, updated_at: now };
export const machine = { id: IDS.machine, workspace_id: WORKSPACE, customer_id: IDS.company, company_id: IDS.company, name: "Fixture compact excavator", make: "Fixture", model: "Mini 35", serial_number: "UI-MACHINE-001", year: 2024, category: "compact_construction", metadata: {}, engine_hours: 1240, mileage: null, warranty_registered: true, warranty_provider: "Fixture OEM", warranty_registration_number: "UI-WARRANTY-001", warranty_start_date: "2025-01-01", warranty_end_date: "2027-12-31", warranty_coverage_terms: "Fixture coverage record; claim approval still required.", ownership: "rental_fleet", availability: "available", location_description: "Fixture branch", daily_rental_rate: 250, current_market_value: 45000 };
const stages = [ { id: IDS.stage, workspace_id: WORKSPACE, name: "Needs Assessment", sort_order: 1, probability: 15, is_closed_won: false, is_closed_lost: false, sla_target_minutes: 60 }, { id: "00000000-0000-4000-8000-000000000015", workspace_id: WORKSPACE, name: "Quote Created", sort_order: 2, probability: 25, is_closed_won: false, is_closed_lost: false } ];
const deal = { id: IDS.deal, workspace_id: WORKSPACE, name: "Fixture excavator opportunity", stage_id: IDS.stage, primary_contact_id: null, company_id: IDS.company, assigned_rep_id: IDS.user, amount: 45000, expected_close_on: date, next_follow_up_at: now, last_activity_at: now, closed_at: null, hubspot_deal_id: null, created_at: now, updated_at: now, sla_deadline_at: now, deposit_status: "not_required", deposit_amount: 0, sort_position: 1, margin_pct: 20 };
const activity = { id: "00000000-0000-4000-8000-000000000012", workspace_id: WORKSPACE, activity_type: "note", body: "Fixture rental inquiry: customer needs a compact excavator and delivery; link the correct account.", occurred_at: now, contact_id: null, company_id: null, deal_id: null, created_by: IDS.user, metadata: { source: "voice_capture", targetSource: "inbox", matchConfidence: 0.45, transcript: "Fixture customer needs a compact excavator for a month, with delivery.", voiceCaptureId: "00000000-0000-4000-8000-000000000013" }, created_at: now, updated_at: now };
export const job = { id: IDS.job, workspace_id: WORKSPACE, customer_id: IDS.company, contact_id: null, machine_id: IDS.machine, source_type: "field_request", request_type: "customer_repair", priority: "normal", current_stage: "in_progress", status_flags: [], branch_id: "fixture-branch", advisor_id: null, service_manager_id: null, technician_id: IDS.user, requested_by_name: "Fixture service customer", customer_problem_summary: "Hydraulic attachment drifts under load. Inspect and record corrective work.", ai_diagnosis_summary: null, selected_job_code_id: null, haul_required: false, shop_or_field: "field", scheduled_start_at: now, scheduled_end_at: now, quote_total: 550, invoice_total: null, portal_request_id: null, fulfillment_run_id: null, tracking_token: "fixture-track", created_at: now, updated_at: now, closed_at: null, deleted_at: null, customer: { id: IDS.company, name: "Fixture service customer" }, machine, parts: [], quotes: [], latest_quote: [], hour_meter_reading: 1240, complaint: "Attachment drifts", cause: "Inspection pending", correction: "", field_site_location: "Fixture jobsite", field_site_contact_name: "Fixture contact", field_site_contact_phone: "555-0101", segments: [{ id: IDS.segment, segment_number: 1, description: "Hydraulic diagnosis", status: "open", technician_id: IDS.user, estimated_hours: 2, quoted_labor_hours: 2, hours_actual: null, diagnostic_signoff_status: "not_submitted", repair_signoff_status: "not_started", lockout_tagout_required: true, lockout_tagout_completed: false, warranty_parts_turn_in_required: false, warranty_parts_turn_in_completed: false, photos: [] }] };
const scores = ["Safety", "Technical skill", "Productivity", "Documentation", "Customer care", "Teamwork", "Development"].map((name, i) => ({ category_key: `category_${i}`, category_name: name, display_order: i+1, criteria: ["Review documented work evidence"], score: 8, band: "Excellent", notes: "Fixture evidence", scorecard_role: "technician", source_document: "Isolated UI fixture" }));
export const appraisal = { id: IDS.appraisal, workspace_id: WORKSPACE, subject_employee_id: IDS.employee, subject_profile_id: IDS.subject, reviewer_profile_id: IDS.user, scorecard_role: "technician", review_type: "Annual Performance Review", review_period_start: "2026-01-01", review_period_end: date, status: "draft", manager_summary: "Fixture draft review: document strengths and the next development steps.", key_strengths: ["Systematic diagnostics"], improvement_areas: ["Complete documentation at each handoff"], goals_next_period: ["Complete OEM training"], category_count: 7, overall_score: 8, performance_band: "Excellent", cost_of_living_raise_pct: 0, performance_raise_pct: 8, recommended_raise_pct: 8, subject_display_name: "Fixture Technician", reviewer_name: "Fixture Manager", scores, updated_at: now };
export const bill = { id: IDS.bill, workspace_id: WORKSPACE, vendor_id: null, vendor_name: "Fixture Parts Supplier", invoice_number: "UI-INV-001", invoice_date: date, due_date: date, payable_account_code: "2000", payable_account_name: "Accounts payable", description: "Fixture repair components", status: "draft", approval_status: "pending", subtotal_amount: 250, tax_amount: 0, total_amount: 250, amount_paid: 0, balance_due: 250, notes: "Fixture voucher ready for header review.", updated_at: now };
function tableRows(table, profile) {
 const tables = {
  profiles: [profile], profile_workspaces: [{ profile_id: IDS.user, workspace_id: WORKSPACE }], crm_companies: [company], qrm_companies: [company], crm_equipment: [machine], qrm_equipment: [machine], crm_deal_stages: stages, crm_deals_rep_safe: [deal], crm_deals: [deal], qrm_deals: [deal], crm_activities: [activity], ap_bills: [bill], ap_bill_lines: [{ id: "00000000-0000-4000-8000-000000000016", bill_id: IDS.bill, line_number: 1, description: "Fixture seal kit", quantity: 1, unit_cost: 250, line_total: 250, gl_code: "5000", gl_name: "Repair expense", notes: null }],
  employees: [{ id: "00000000-0000-4000-8000-000000000017", profile_id: IDS.user, display_name: profile.full_name, employee_number: "UI-M1", supervisor_id: null }, { id: IDS.employee, profile_id: IDS.subject, display_name: "Fixture Technician", employee_number: "UI-T1", supervisor_id: "00000000-0000-4000-8000-000000000017" }],
  v_service_metrics_margin_by_request_type: [{ workspace_id: WORKSPACE, request_type: "customer_repair", job_count: 4, quote_count: 4, marginable_line_count: 4, below_floor_line_count: 0, target_met_line_count: 4, total_labor_revenue: 1850, total_service_revenue: 2300, total_margin_cost_basis: 900, total_margin_amount: 1400, margin_pct: 60.9, latest_quote_created_at: now, missing_cost_line_count: 0 }],
  v_service_metrics_owner_watch: [{ workspace_id: WORKSPACE, jobs_30d: 12, comeback_jobs_30d: 1, comeback_rate_pct: 8.3, completed_tat_count: 8, avg_cycle_time_hours: 28, avg_cycle_target_hours: 36, tat_on_time_pct: 87.5, avg_technician_efficiency_pct: 82, labor_recovery_pct: 90, tech_hours_charged_30d: 72, tech_hours_worked_30d: 80, hold_hours_excluded_30d: 6, shop_jobs_30d: 8, field_jobs_30d: 4, field_mix_pct: 33.3, shop_hours_30d: 48, field_hours_30d: 32, open_work_orders: 4, open_hold_count: 1, open_jobs_on_hold_count: 1, warranty_revenue_cents: 50000, warranty_cost_cents: 35000, warranty_filed_cents: 90000, warranty_paid_cents: 50000, warranty_outstanding_cents: 40000, warranty_recovery_pct: 55.6, avg_hours_to_first_touch: 2.5, first_touch_job_count: 10, computed_at: now }],
  v_service_metrics_cycle_time_by_segment: [{ workspace_id: WORKSPACE, segment_name: "customer_repair", request_type: "customer_repair", completed_segment_count: 8, open_segment_count: 4, avg_actual_duration_hours: 28, avg_target_duration_hours: 36, on_time_pct: 87.5 }],
  v_service_metrics_open_wo_by_status: [{ workspace_id: WORKSPACE, current_stage: "in_progress", open_work_order_count: 4, with_open_hold_count: 1, oldest_opened_at: now }], v_service_metrics_open_wo_by_hold_reason: [{ workspace_id: WORKSPACE, hold_state: "waiting_on_parts_sublet", open_hold_count: 1, affected_work_order_count: 1, avg_open_hold_hours: 3, latest_hold_started_at: now }],
 };
 return tables[table] ?? [];
}
export function apiResponse(url, request, profile, log) {
 const path = url.pathname;
 if (path === "/auth/v1/user") return { id: profile.id, aud: "authenticated", role: "authenticated", email: profile.email, app_metadata: { provider: "email", workspace_id: WORKSPACE }, user_metadata: {}, created_at: now };
 if (path.startsWith("/auth/v1/")) return {};
 const rpc = path.split("/rpc/")[1];
 if (rpc) {
  if (rpc === "get_my_workspace") return WORKSPACE;
  if (rpc === "get_my_role") return profile.role;
  if (rpc === "service_owner_metrics") return {
    margin_by_type: [{ workspace_id: WORKSPACE, request_type: "customer_repair", job_count: 4, quote_count: 0, marginable_line_count: 4, below_floor_line_count: 0, target_met_line_count: 4, total_revenue: 2300, total_margin_cost_basis: 900, total_margin_amount: 1400, margin_pct: 60.9, missing_cost_line_count: 0 }],
    cycle_by_type: [{ workspace_id: WORKSPACE, segment_name: "customer_repair", request_type: "customer_repair", completed_segment_count: 8, avg_actual_duration_hours: 28, avg_target_duration_hours: 36, on_time_pct: 87.5 }],
    owner_summary: { workspace_id: WORKSPACE, jobs_30d: 12, comeback_jobs_30d: 1, comeback_rate_pct: 8.3, completed_tat_count: 8, avg_cycle_time_hours: 28, avg_cycle_target_hours: 36, tat_on_time_pct: 87.5, avg_technician_efficiency_pct: 82, labor_recovery_pct: 90, tech_hours_charged_30d: 72, tech_hours_worked_30d: 80, hold_hours_excluded_30d: 6, shop_jobs_30d: 8, field_jobs_30d: 4, field_mix_pct: 40, shop_hours_30d: 48, field_hours_30d: 32, open_work_orders: 4, open_hold_count: 1, open_jobs_on_hold_count: 1, warranty_revenue_cents: 50000, warranty_cost_cents: 35000, warranty_filed_cents: 90000, warranty_paid_cents: 50000, warranty_outstanding_cents: 40000, warranty_filed_count: 3, warranty_recovery_pct: 55.6, avg_hours_to_first_touch: 2.5, first_touch_job_count: 10, computed_at: now }
  };
  if (rpc === "rental_ops_health") return { commission: { live_contracts: 0, with_commission: 0, coverage_pct: null, missing_count: 0, missing_sample: [] }, cycle: { alerts_30d: 0, in_window: 0, billed_within_3d: 0, resolution_pct: null, invoices_posted_30d: 0 }, availability: { alerts_30d: 0, current_low: [] }, geofence: { active_jobsite_fences: 0, exit_events_30d: 0, exit_events_7d: 0 }, generated_at: now };
  if (rpc === "crm_weighted_pipeline_totals") return [{ open_deals: 1, pipeline_amount: 45000, weighted_pipeline: 6750 }];
  if (rpc === "search_companies_for_picker_ranked") return [company];
  log.unmodeled.add(path); return [];
 }
 if (path.startsWith("/functions/v1/")) {
  const fn = path.slice("/functions/v1/".length); let body = {};
  try { body = JSON.parse(request.postData() || "{}"); } catch {}
  if (fn === "service-job-router") return body.action === "list" ? { jobs: [job], total: 1, page: 1, per_page: 50 } : body.action === "machine_history" ? { history: [] } : { job };
  if (fn === "performance-appraisals/scorecards") return { scorecards: scores };
  if (fn === "performance-appraisals") return request.method() === "GET" ? { appraisals: [appraisal] } : { ok: true, updated_at: now };
  if (fn.startsWith("performance-appraisals/")) return { appraisal };
  if (fn.startsWith("qrm-router")) {
   if (path.includes("/moves")) return { moves: [] };
   if (path.includes("/signals")) return { signals: [] };
   if (path.includes("/companies")) return { items: [company], nextCursor: null };
   if (path.includes("/contacts")) return { items: [], nextCursor: null };
   if (path.includes("/search")) return { results: [] };
   return {};
  }
  if (fn.startsWith("rental-ops")) return { items: [], contracts: [], inquiries: [], more: false };
  if (fn === "quote-builder-v2") return { ok: true, notifications: [], unread_count: 0, items: [] };
  log.unmodeled.add(path); return {};
 }
 if (path.startsWith("/rest/v1/")) {
  const table = path.split("/").at(-1);
  let rows = tableRows(table, profile);
  for (const [key, value] of url.searchParams) {
   if (value.startsWith("eq.") && rows.some(row => key in row)) rows = rows.filter(row => String(row[key]) === value.slice(3));
  }
  if (!rows.length) log.emptyTables.add(table);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  if (offset) rows = rows.slice(offset);
  const accept = request.headers().accept ?? "";
  return accept.includes("vnd.pgrst.object") ? rows[0] ?? null : rows;
 }
 log.unmodeled.add(path); return {};
}
export const scenarios = [
 { id: "service-intake-first-seen", role: "service_writer", route: "/service/intake", ready: "New Service Request", async prepare(page) { await page.getByPlaceholder("Search by company name or phone number...").fill("Fixture"); await page.getByRole("button", { name: /Fixture Equipment Customer/ }).first().click(); await page.getByRole("button", { name: "Register a first-seen machine" }).click(); await page.getByLabel("New machine make", { exact: true }).fill("Fixture"); await page.getByLabel("New machine model", { exact: true }).fill("Mini 35"); await page.getByLabel("New machine serial_number", { exact: true }).fill("UI-NEW-002"); await page.getByLabel("New machine year", { exact: true }).fill("2024"); }, target: "The machine and work order will be saved together." },
 { id: "service-intake-warranty", role: "service_writer", route: "/service/intake", ready: "New Service Request", async prepare(page) { await page.getByPlaceholder("Search by company name or phone number...").fill("Fixture"); await page.getByRole("button", { name: /Fixture Equipment Customer/ }).first().click(); const machine = page.getByRole("button", { name: /Fixture Mini 35/ }).first(); await machine.scrollIntoViewIfNeeded(); await page.waitForTimeout(350); await machine.click(); await page.getByText("Warranty at intake", { exact: true }).waitFor(); }, target: "Warranty at intake" },
 { id: "rental-inquiry", role: "rep", route: "/qrm/rentals", ready: "Rental inquiry", target: "Rental inquiry" },
 { id: "qrm-pipeline", role: "manager", route: "/qrm/deals", ready: "New deal", target: "Fixture excavator opportunity" },
 { id: "qrm-voice-inbox", role: "manager", route: "/qrm/voice-inbox", ready: "Voice Capture Inbox", target: "Fixture customer needs a compact excavator" },
 { id: "service-clock", role: "technician", route: "/m/service", ready: "Service Technician Workspace", async prepare(page) { await page.getByRole("button", { name: "Open", exact: true }).first().click(); await page.getByRole("button", { name: "Clock on", exact: true }).waitFor(); }, target: "Job clock" },
 { id: "service-metrics", role: "owner", route: "/service/metrics", ready: "Margin by WO type", target: "Margin by WO type" },
 { id: "accounts-payable", role: "admin", route: `/admin/accounts-payable/${IDS.bill}`, ready: "UI-INV-001", target: "Voucher header" },
 { id: "appraisal", role: "manager", route: "/workforce/appraisals", ready: "Seven equal-weight categories", target: "Seven equal-weight categories" },
];
