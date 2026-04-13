/**
 * Customer Portal API Edge Function
 *
 * Unified API for the customer self-service portal.
 * Routes: /fleet, /service-requests, /parts, /invoices, /quotes
 *
 * Auth: Portal customer (via auth_user_id → portal_customers mapping)
 * OR internal staff with workspace access.
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { parseJsonBody } from "../_shared/parse-json-body.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  buildPmKitLinesFromJobCode,
  deterministicPmReason,
  explainPmKitWithLlm,
  sanitizePortalLineItemsForOrder,
  scoreJobCodeForFleet,
  type CustomerFleetRow,
  type JobCodePmRow,
} from "../_shared/portal-pm-kit.ts";
import { sortPortalNotifications } from "../_shared/portal-customer-notify.ts";
import { sendResendEmail } from "../_shared/resend-email.ts";

/** Strip angle brackets for safe notification copy (names are still escaped in UI). */
function safePortalDisplayLabel(raw: string): string {
  return raw.replace(/[<>]/g, "").trim().slice(0, 120);
}

const STAFF_NOTIFY_CHUNK = 80;

const STAFF_NOTIFY_ROLES = ["rep", "admin", "manager", "owner"] as const;

const PORTAL_JOB_STAGE_LABELS: Record<string, string> = {
  request_received: "Request received",
  triaging: "Being reviewed",
  diagnosis_selected: "Diagnosis confirmed",
  quote_drafted: "Quote in progress",
  quote_sent: "Quote sent",
  approved: "Approved",
  parts_pending: "Waiting on parts",
  parts_staged: "Parts ready",
  haul_scheduled: "Transport scheduled",
  scheduled: "Appointment scheduled",
  in_progress: "In progress",
  blocked_waiting: "Waiting",
  quality_check: "Quality review",
  ready_for_pickup: "Ready for pickup",
  invoice_ready: "Invoice ready",
  invoiced: "Invoiced",
  paid_closed: "Completed",
};

const PORTAL_REQUEST_STATUS_LABELS: Record<string, string> = {
  submitted: "Request received",
  received: "Request received",
  triaging: "Being reviewed",
  in_review: "Being reviewed",
  scheduled: "Appointment scheduled",
  in_progress: "In progress",
  waiting: "Waiting",
  completed: "Completed",
  cancelled: "Cancelled",
};

interface PortalDealRow {
  id: string;
  name: string;
  amount: number | null;
  expected_close_on: string | null;
  next_follow_up_at: string | null;
  updated_at: string;
  stage_id: string | null;
  primary_contact_id: string | null;
  company_id: string | null;
  closed_at?: string | null;
}

interface PortalDealStageRow {
  id: string;
  name: string;
  is_closed_won: boolean;
  is_closed_lost: boolean;
}

interface PortalQuoteReviewRow {
  id: string;
  deal_id: string | null;
  status: string;
  counter_notes: string | null;
  quote_data: Record<string, unknown> | null;
  quote_pdf_url: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  expires_at: string | null;
  updated_at: string;
  signer_name: string | null;
}

interface PortalQuoteRevisionRow {
  id: string;
  portal_quote_review_id: string;
  version_number: number;
  quote_data: Record<string, unknown> | null;
  quote_pdf_url: string | null;
  dealer_message: string | null;
  revision_summary: string | null;
  customer_request_snapshot: string | null;
  published_at: string;
  is_current: boolean;
}

interface PortalPaymentIntentRow {
  id: string;
  invoice_id: string | null;
  stripe_payment_intent_id: string;
  amount_cents: number;
  currency: string;
  status: string;
  webhook_signature_verified: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  succeeded_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
}

interface PortalPaymentHistoryItem {
  id: string;
  kind: "stripe" | "manual";
  label: string;
  detail: string;
  amount: number;
  status: "pending" | "processing" | "paid" | "failed";
  created_at: string;
  resolved_at: string | null;
  reference: string | null;
}

interface RentalContractRow {
  id: string;
  portal_customer_id: string;
  equipment_id: string | null;
  assignment_status: "pending_assignment" | "assigned" | null;
  requested_category: string | null;
  requested_make: string | null;
  requested_model: string | null;
  branch_id: string | null;
  delivery_mode: "pickup" | "delivery";
  delivery_location: string | null;
  request_type: "booking" | "extension";
  requested_start_date: string | null;
  requested_end_date: string | null;
  approved_start_date: string | null;
  approved_end_date: string | null;
  status: string;
  estimate_daily_rate: number | null;
  estimate_weekly_rate: number | null;
  estimate_monthly_rate: number | null;
  agreed_daily_rate: number | null;
  agreed_weekly_rate: number | null;
  agreed_monthly_rate: number | null;
  deposit_required: boolean | null;
  deposit_amount: number | null;
  deposit_status: string | null;
  deposit_invoice_id: string | null;
  customer_notes: string | null;
  dealer_response: string | null;
}

interface RentalExtensionRow {
  id: string;
  rental_contract_id: string;
  requested_end_date: string | null;
  approved_end_date: string | null;
  status: string;
  customer_reason: string | null;
  dealer_response: string | null;
  additional_charge: number | null;
  payment_invoice_id: string | null;
  payment_status: string | null;
  created_at: string;
}

interface RentalRateRuleRow {
  id: string;
  customer_id: string | null;
  equipment_id: string | null;
  branch_id: string | null;
  category: string | null;
  make: string | null;
  model: string | null;
  season_start: string | null;
  season_end: string | null;
  daily_rate: number | null;
  weekly_rate: number | null;
  monthly_rate: number | null;
  minimum_days: number | null;
  is_active: boolean;
  priority_rank: number;
  notes: string | null;
}

interface DocumentVisibilityAuditRow {
  document_id: string;
  visibility_after: boolean | null;
  created_at: string;
  reason: string | null;
}

interface PortalNotificationFeedItem {
  id: string;
  category: "service" | "parts" | "quotes" | "fleet";
  label: string;
  detail: string;
  channel: "portal" | "email" | "sms";
  occurred_at: string;
}

function titleCaseStatus(raw: string | null | undefined): string {
  if (!raw) return "Status unavailable";
  return raw.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizePortalStatus(input: {
  requestStatus?: string | null;
  requestEta?: string | null;
  requestUpdatedAt?: string | null;
  jobStage?: string | null;
  jobEta?: string | null;
  jobUpdatedAt?: string | null;
  idleUpdatedAt?: string | null;
}): {
  label: string;
  source: "service_job" | "portal_request" | "default";
  source_label: string;
  eta: string | null;
  last_updated_at: string | null;
} {
  if (input.jobStage) {
    return {
      label: PORTAL_JOB_STAGE_LABELS[input.jobStage] ?? titleCaseStatus(input.jobStage),
      source: "service_job",
      source_label: "Live shop status",
      eta: input.jobEta ?? input.requestEta ?? null,
      last_updated_at: input.jobUpdatedAt ?? input.requestUpdatedAt ?? null,
    };
  }

  if (input.requestStatus) {
    return {
      label: PORTAL_REQUEST_STATUS_LABELS[input.requestStatus] ?? titleCaseStatus(input.requestStatus),
      source: "portal_request",
      source_label: "Portal request",
      eta: input.requestEta ?? null,
      last_updated_at: input.requestUpdatedAt ?? null,
    };
  }

  return {
    label: "Operational",
    source: "default",
    source_label: "Equipment status",
    eta: null,
    last_updated_at: input.idleUpdatedAt ?? null,
  };
}

function normalizePortalDealStatus(input: {
  dealStageName?: string | null;
  isClosedWon?: boolean;
  isClosedLost?: boolean;
  expectedCloseOn?: string | null;
  nextFollowUpAt?: string | null;
  dealUpdatedAt?: string | null;
  quoteStatus?: string | null;
  quoteViewedAt?: string | null;
  quoteSignedAt?: string | null;
  quoteExpiresAt?: string | null;
  quoteUpdatedAt?: string | null;
}): {
  label: string;
  source: "quote_review" | "deal_progress";
  source_label: string;
  eta: string | null;
  last_updated_at: string | null;
  next_action: string | null;
} {
  const quoteStatus = input.quoteStatus?.trim().toLowerCase() ?? "";
  const dealStageName = input.dealStageName?.trim().toLowerCase() ?? "";

  if (quoteStatus === "accepted") {
    return {
      label: "Quote accepted",
      source: "quote_review",
      source_label: "Your quote response",
      eta: input.expectedCloseOn ?? null,
      last_updated_at: input.quoteSignedAt ?? input.quoteUpdatedAt ?? input.dealUpdatedAt ?? null,
      next_action: "We’re finalizing the paperwork and next dealership steps.",
    };
  }

  if (quoteStatus === "rejected") {
    return {
      label: "Quote declined",
      source: "quote_review",
      source_label: "Your quote response",
      eta: null,
      last_updated_at: input.quoteUpdatedAt ?? input.dealUpdatedAt ?? null,
      next_action: "Contact the dealership if you want a revised option or updated quote.",
    };
  }

  if (quoteStatus === "countered") {
    return {
      label: "Changes requested",
      source: "quote_review",
      source_label: "Your quote response",
      eta: input.quoteExpiresAt ?? input.expectedCloseOn ?? null,
      last_updated_at: input.quoteUpdatedAt ?? input.dealUpdatedAt ?? null,
      next_action: "We’re reviewing your requested changes.",
    };
  }

  if (quoteStatus === "viewed") {
    return {
      label: "Quote reviewed",
      source: "quote_review",
      source_label: "Your quote response",
      eta: input.quoteExpiresAt ?? input.expectedCloseOn ?? null,
      last_updated_at: input.quoteViewedAt ?? input.quoteUpdatedAt ?? input.dealUpdatedAt ?? null,
      next_action: "Review the quote details and sign when you're ready.",
    };
  }

  if (quoteStatus === "sent") {
    return {
      label: "Quote ready for review",
      source: "quote_review",
      source_label: "Quote review",
      eta: input.quoteExpiresAt ?? input.expectedCloseOn ?? null,
      last_updated_at: input.quoteUpdatedAt ?? input.dealUpdatedAt ?? null,
      next_action: "Open the quote to review pricing and next steps.",
    };
  }

  if (input.isClosedWon) {
    return {
      label: "Deal confirmed",
      source: "deal_progress",
      source_label: "Deal progress",
      eta: null,
      last_updated_at: input.dealUpdatedAt ?? null,
      next_action: "Your dealership team is handling the final delivery or paperwork steps.",
    };
  }

  if (input.isClosedLost) {
    return {
      label: "Opportunity closed",
      source: "deal_progress",
      source_label: "Deal progress",
      eta: null,
      last_updated_at: input.dealUpdatedAt ?? null,
      next_action: "Reach back out if you want to reopen this opportunity.",
    };
  }

  if (dealStageName.includes("demo")) {
    return {
      label: "Demo scheduled",
      source: "deal_progress",
      source_label: "Deal progress",
      eta: input.expectedCloseOn ?? input.nextFollowUpAt ?? null,
      last_updated_at: input.dealUpdatedAt ?? null,
      next_action: "We’ll confirm your demo timing and any prep details.",
    };
  }

  if (dealStageName.includes("quote")) {
    return {
      label: "Quote in progress",
      source: "deal_progress",
      source_label: "Deal progress",
      eta: input.expectedCloseOn ?? input.nextFollowUpAt ?? null,
      last_updated_at: input.dealUpdatedAt ?? null,
      next_action: "Your dealership team is preparing the quote details.",
    };
  }

  if (dealStageName.includes("negotiat")) {
    return {
      label: "Finalizing options",
      source: "deal_progress",
      source_label: "Deal progress",
      eta: input.expectedCloseOn ?? input.nextFollowUpAt ?? null,
      last_updated_at: input.dealUpdatedAt ?? null,
      next_action: "We’re working through final options and pricing.",
    };
  }

  if (input.nextFollowUpAt) {
    return {
      label: "In progress with dealership",
      source: "deal_progress",
      source_label: "Deal progress",
      eta: input.nextFollowUpAt,
      last_updated_at: input.dealUpdatedAt ?? null,
      next_action: "Expect the next dealership update on the scheduled follow-up.",
    };
  }

  return {
    label: "In progress with dealership",
    source: "deal_progress",
    source_label: "Deal progress",
    eta: input.expectedCloseOn ?? null,
    last_updated_at: input.dealUpdatedAt ?? null,
    next_action: "Your dealership team is actively working this opportunity.",
  };
}

function quoteDataText(value: Record<string, unknown> | null, keyA: string, keyB: string): string | null {
  const raw = (typeof value?.[keyA] === "string" ? value[keyA] : typeof value?.[keyB] === "string" ? value[keyB] : null) as string | null;
  const trimmed = raw?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function quoteDataLines(value: Record<string, unknown> | null, keyA: string, keyB: string): string[] {
  const source = value?.[keyA] ?? value?.[keyB];
  if (!Array.isArray(source)) return [];
  return source
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      if (typeof record.description === "string" && record.description.trim()) return record.description.trim();
      if (typeof record.name === "string" && record.name.trim()) return record.name.trim();
      if (typeof record.label === "string" && record.label.trim()) return record.label.trim();
      const combined = [record.make, record.model, record.year].filter(Boolean).join(" ").trim();
      return combined || null;
    })
    .filter((item): item is string => Boolean(item));
}

function quoteDataFinancing(value: Record<string, unknown> | null): string[] {
  const source = value?.financing;
  if (!Array.isArray(source)) return [];
  return source
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const parts = [
        typeof record.type === "string" ? record.type.toUpperCase() : null,
        Number.isFinite(Number(record.monthlyPayment)) ? `$${Math.round(Number(record.monthlyPayment)).toLocaleString()}/mo` : null,
        Number.isFinite(Number(record.termMonths)) ? `${Math.round(Number(record.termMonths))} mo` : null,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(" · ") : null;
    })
    .filter((item): item is string => Boolean(item));
}

function quoteDataTerms(value: Record<string, unknown> | null): string[] {
  const source = value?.terms ?? value?.legal_terms;
  if (typeof source === "string" && source.trim()) return [source.trim()];
  if (!Array.isArray(source)) return [];
  return source.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function compareStringLists(label: string, previous: string[], current: string[]): string[] {
  if (JSON.stringify(previous) === JSON.stringify(current)) return [];
  return [`${label}: ${previous.join(", ") || "none"} → ${current.join(", ") || "none"}`];
}

function buildPortalQuoteCompare(
  currentVersion: PortalQuoteRevisionRow | null,
  previousVersion: PortalQuoteRevisionRow | null,
): Record<string, unknown> | null {
  if (!currentVersion || !previousVersion) return null;

  const currentQuoteData = currentVersion.quote_data ?? {};
  const previousQuoteData = previousVersion.quote_data ?? {};
  const currentPrice = Number(currentQuoteData.net_total ?? currentQuoteData.netTotal ?? 0);
  const previousPrice = Number(previousQuoteData.net_total ?? previousQuoteData.netTotal ?? 0);
  const priceChanges = Number.isFinite(currentPrice) && Number.isFinite(previousPrice) && currentPrice !== previousPrice
    ? [`Net total: $${previousPrice.toLocaleString()} → $${currentPrice.toLocaleString()}`]
    : [];

  const equipmentChanges = compareStringLists(
    "Equipment",
    quoteDataLines(previousQuoteData, "equipment", "equipment"),
    quoteDataLines(currentQuoteData, "equipment", "equipment"),
  );
  const financingChanges = compareStringLists(
    "Financing",
    quoteDataFinancing(previousQuoteData),
    quoteDataFinancing(currentQuoteData),
  );
  const termsChanges = compareStringLists(
    "Terms",
    quoteDataTerms(previousQuoteData),
    quoteDataTerms(currentQuoteData),
  );

  const previousDealerMessage = previousVersion.dealer_message ?? quoteDataText(previousQuoteData, "dealer_message", "dealerMessage");
  const currentDealerMessage = currentVersion.dealer_message ?? quoteDataText(currentQuoteData, "dealer_message", "dealerMessage");

  return {
    has_changes: priceChanges.length > 0 || equipmentChanges.length > 0 || financingChanges.length > 0 || termsChanges.length > 0 || previousDealerMessage !== currentDealerMessage,
    price_changes: priceChanges,
    equipment_changes: equipmentChanges,
    financing_changes: financingChanges,
    terms_changes: termsChanges,
    dealer_message_change:
      previousDealerMessage !== currentDealerMessage
        ? `${previousDealerMessage ?? "No prior dealer message"} → ${currentDealerMessage ?? "No current dealer message"}`
        : null,
  };
}

function buildPortalInvoiceTimeline(input: {
  invoiceDate: string | null;
  status: string | null;
  paidAt: string | null;
  updatedAt: string | null;
  paymentHistory: PortalPaymentHistoryItem[];
}): Array<{ label: string; detail: string; at: string | null; tone: "blue" | "amber" | "emerald" | "red" }> {
  const timeline: Array<{ label: string; detail: string; at: string | null; tone: "blue" | "amber" | "emerald" | "red" }> = [
    {
      label: "Invoice issued",
      detail: "The dealership published this invoice to the customer billing center.",
      at: input.invoiceDate,
      tone: "blue",
    },
  ];

  for (const payment of input.paymentHistory) {
    timeline.push({
      label: payment.label,
      detail: payment.detail,
      at: payment.resolved_at ?? payment.created_at,
      tone:
        payment.status === "paid" ? "emerald" : payment.status === "failed" ? "red" : payment.status === "processing" ? "blue" : "amber",
    });
  }

  if (input.status === "paid") {
    timeline.push({
      label: "Balance resolved",
      detail: "The invoice balance is fully resolved.",
      at: input.paidAt ?? input.updatedAt,
      tone: "emerald",
    });
  }

  return timeline;
}

function serviceWorkspaceSummaryLine(statusLabel: string, requestType: string): string {
  if (/completed/i.test(statusLabel)) {
    return `Your ${requestType} request is complete and the final status is available in the portal timeline.`;
  }
  if (/waiting/i.test(statusLabel) || /parts/i.test(statusLabel)) {
    return `Your ${requestType} request is active, but the dealership is waiting on a dependency before closing it.`;
  }
  if (/review|triag/i.test(statusLabel)) {
    return `Your ${requestType} request is being reviewed by the dealership team.`;
  }
  return `Your ${requestType} request is active and moving through the dealership workflow.`;
}

function daysBetween(startDate: string | null, endDate: string | null): number | null {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
}

function withinSeason(rule: RentalRateRuleRow, now: Date): boolean {
  if (!rule.season_start || !rule.season_end) return true;
  const start = new Date(rule.season_start);
  const end = new Date(rule.season_end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return true;
  return now >= start && now <= end;
}

function resolveRentalPricingEstimate(input: {
  rules: RentalRateRuleRow[];
  customerId: string;
  equipmentId?: string | null;
  branchId?: string | null;
  category?: string | null;
  make?: string | null;
  model?: string | null;
  equipmentRates?: { daily: number | null; weekly: number | null; monthly: number | null };
}): { dailyRate: number | null; weeklyRate: number | null; monthlyRate: number | null; sourceLabel: string } {
  const now = new Date();
  const matches = input.rules
    .filter((rule) => rule.is_active)
    .filter((rule) => withinSeason(rule, now))
    .filter((rule) => !rule.customer_id || rule.customer_id === input.customerId)
    .filter((rule) => !rule.equipment_id || rule.equipment_id === input.equipmentId)
    .filter((rule) => !rule.branch_id || rule.branch_id === input.branchId)
    .filter((rule) => !rule.category || rule.category === input.category)
    .filter((rule) => !rule.make || rule.make === input.make)
    .filter((rule) => !rule.model || rule.model === input.model)
    .map((rule) => ({
      rule,
      score:
        (rule.customer_id ? 1000 : 0) +
        (rule.equipment_id ? 800 : 0) +
        (rule.branch_id ? 400 : 0) +
        (rule.category ? 300 : 0) +
        (rule.make ? 200 : 0) +
        (rule.model ? 100 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.rule.priority_rank - b.rule.priority_rank);

  const winning = matches[0]?.rule ?? null;
  if (winning) {
    const scopeParts = [
      winning.customer_id ? "customer override" : null,
      winning.equipment_id ? "unit override" : null,
      winning.branch_id ? "branch rule" : null,
      winning.category ? `category ${winning.category}` : null,
      winning.make ? winning.make : null,
      winning.model ? winning.model : null,
    ].filter(Boolean);
    return {
      dailyRate: winning.daily_rate ?? input.equipmentRates?.daily ?? null,
      weeklyRate: winning.weekly_rate ?? input.equipmentRates?.weekly ?? null,
      monthlyRate: winning.monthly_rate ?? input.equipmentRates?.monthly ?? null,
      sourceLabel: scopeParts.join(" · ") || "pricing rule",
    };
  }

  return {
    dailyRate: input.equipmentRates?.daily ?? null,
    weeklyRate: input.equipmentRates?.weekly ?? null,
    monthlyRate: input.equipmentRates?.monthly ?? null,
    sourceLabel: "equipment base rate",
  };
}

function normalizeRentalPaymentStatus(rawStatus: string | null | undefined): "not_required" | "pending" | "processing" | "paid" | "failed" {
  switch ((rawStatus ?? "").toLowerCase()) {
    case "paid":
      return "paid";
    case "processing":
    case "partial":
    case "viewed":
      return "processing";
    case "failed":
    case "void":
    case "overdue":
      return "failed";
    case "pending":
    case "sent":
      return "pending";
    default:
      return "not_required";
  }
}

function buildRentalPaymentStatusView(input: {
  kind: "deposit" | "extension";
  rawStatus: string | null | undefined;
  amount: number | null;
  invoiceId: string | null;
  companyId: string | null;
}): {
  kind: "deposit" | "extension";
  status: "not_required" | "pending" | "processing" | "paid" | "failed";
  amount: number | null;
  invoiceId: string | null;
  companyId: string | null;
  headline: string;
  detail: string;
  canPayNow: boolean;
  canFinalize: boolean;
} | null {
  const kindLabel = input.kind === "deposit" ? "deposit" : "extension";
  const status = normalizeRentalPaymentStatus(input.rawStatus);

  if (status === "not_required" && !input.invoiceId && !input.amount) {
    return null;
  }

  if (status === "paid") {
    return {
      kind: input.kind,
      status,
      amount: input.amount,
      invoiceId: input.invoiceId,
      companyId: input.companyId,
      headline: input.kind === "deposit" ? "Deposit received" : "Extension payment received",
      detail: input.kind === "deposit"
        ? "The dealership has a paid deposit on file. Finalize the rental to activate the contract."
        : "The approved extension payment is settled. Finalize the extension to apply the new rental end date.",
      canPayNow: false,
      canFinalize: true,
    };
  }

  if (status === "processing") {
    return {
      kind: input.kind,
      status,
      amount: input.amount,
      invoiceId: input.invoiceId,
      companyId: input.companyId,
      headline: input.kind === "deposit" ? "Deposit processing" : "Extension payment processing",
      detail: "The payment provider is still processing this checkout. Finalize once the portal shows a successful settlement.",
      canPayNow: Boolean(input.invoiceId && input.companyId && (input.amount ?? 0) > 0),
      canFinalize: true,
    };
  }

  if (status === "failed") {
    return {
      kind: input.kind,
      status,
      amount: input.amount,
      invoiceId: input.invoiceId,
      companyId: input.companyId,
      headline: input.kind === "deposit" ? "Deposit payment needs attention" : "Extension payment needs attention",
      detail: `The ${kindLabel} payment did not complete. Retry checkout or contact the dealership team if the failure persists.`,
      canPayNow: Boolean(input.invoiceId && input.companyId && (input.amount ?? 0) > 0),
      canFinalize: false,
    };
  }

  if (status === "pending") {
    return {
      kind: input.kind,
      status,
      amount: input.amount,
      invoiceId: input.invoiceId,
      companyId: input.companyId,
      headline: input.kind === "deposit" ? "Deposit ready for checkout" : "Extension payment ready for checkout",
      detail: `The dealership approved this ${kindLabel} requirement. Complete checkout, then finalize here once payment clears.`,
      canPayNow: Boolean(input.invoiceId && input.companyId && (input.amount ?? 0) > 0),
      canFinalize: true,
    };
  }

  return {
    kind: input.kind,
    status,
    amount: input.amount,
    invoiceId: input.invoiceId,
    companyId: input.companyId,
    headline: input.kind === "deposit" ? "No deposit required" : "No extension payment required",
    detail: `No customer payment is required before the ${kindLabel} can move forward.`,
    canPayNow: false,
    canFinalize: false,
  };
}

function normalizePortalPaymentStatus(intent: PortalPaymentIntentRow | null): {
  label: string;
  tone: "blue" | "amber" | "emerald" | "red";
  detail: string;
  last_updated_at: string | null;
} | null {
  if (!intent) return null;

  if (intent.status === "succeeded" && intent.webhook_signature_verified) {
    return {
      label: "Payment verified",
      tone: "emerald",
      detail: "Your payment was received and verified by the dealership payment workflow.",
      last_updated_at: intent.succeeded_at ?? intent.updated_at,
    };
  }

  if (intent.status === "failed") {
    return {
      label: "Payment failed",
      tone: "red",
      detail: intent.failure_reason?.trim() || "The payment attempt did not complete. Try again or contact the dealership.",
      last_updated_at: intent.failed_at ?? intent.updated_at,
    };
  }

  if (intent.status === "processing") {
    return {
      label: "Payment processing",
      tone: "blue",
      detail: "Your payment is still processing with the checkout provider.",
      last_updated_at: intent.updated_at,
    };
  }

  return {
    label: "Checkout started",
    tone: "amber",
    detail: "A payment session was created, but the dealership has not received a verified success event yet.",
    last_updated_at: intent.updated_at ?? intent.created_at,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function buildPortalPaymentHistory(
  invoice: Record<string, unknown>,
  intents: PortalPaymentIntentRow[],
): PortalPaymentHistoryItem[] {
  const history: PortalPaymentHistoryItem[] = intents.map((intent) => {
    const amount = Number(intent.amount_cents ?? 0) / 100;
    const metadata = asRecord(intent.metadata);
    const checkoutSessionId = typeof metadata.checkout_session_id === "string"
      ? metadata.checkout_session_id
      : null;

    if (intent.status === "succeeded" && intent.webhook_signature_verified) {
      return {
        id: intent.id,
        kind: "stripe",
        label: "Card payment received",
        detail: "Stripe verified the payment and the invoice was reconciled.",
        amount,
        status: "paid",
        created_at: intent.created_at,
        resolved_at: intent.succeeded_at ?? intent.updated_at,
        reference: checkoutSessionId ?? intent.stripe_payment_intent_id,
      };
    }

    if (intent.status === "failed") {
      return {
        id: intent.id,
        kind: "stripe",
        label: "Card payment failed",
        detail: intent.failure_reason?.trim() || "The checkout attempt failed before the dealership could receive funds.",
        amount,
        status: "failed",
        created_at: intent.created_at,
        resolved_at: intent.failed_at ?? intent.updated_at,
        reference: checkoutSessionId ?? intent.stripe_payment_intent_id,
      };
    }

    if (intent.status === "processing") {
      return {
        id: intent.id,
        kind: "stripe",
        label: "Card payment processing",
        detail: "Stripe is still processing this payment attempt.",
        amount,
        status: "processing",
        created_at: intent.created_at,
        resolved_at: intent.updated_at,
        reference: checkoutSessionId ?? intent.stripe_payment_intent_id,
      };
    }

    return {
      id: intent.id,
      kind: "stripe",
      label: "Checkout started",
      detail: "A secure payment session was created, but it has not completed yet.",
      amount,
      status: "pending",
      created_at: intent.created_at,
      resolved_at: intent.updated_at,
      reference: checkoutSessionId ?? intent.stripe_payment_intent_id,
    };
  });

  const invoiceAmountPaid = Number(invoice.amount_paid ?? 0);
  const paymentMethod = typeof invoice.payment_method === "string" ? invoice.payment_method.trim() : "";
  const paymentReference = typeof invoice.payment_reference === "string" ? invoice.payment_reference.trim() : "";
  const paidAt = typeof invoice.paid_at === "string" ? invoice.paid_at : null;

  const hasStripeSettlement = history.some((entry) =>
    entry.kind === "stripe"
    && entry.status === "paid"
    && paymentReference.startsWith("stripe:")
    && paymentReference.slice("stripe:".length) === entry.reference
  );

  if (invoiceAmountPaid > 0 && (!paymentReference.startsWith("stripe:") || !hasStripeSettlement)) {
    history.push({
      id: `manual-${String(invoice.id ?? "invoice")}`,
      kind: "manual",
      label: paymentMethod ? `${paymentMethod.toUpperCase()} payment recorded` : "Payment recorded",
      detail: paymentReference
        ? `Dealership recorded this payment with reference ${paymentReference}.`
        : "Dealership recorded this payment on the invoice.",
      amount: invoiceAmountPaid,
      status: "paid",
      created_at: paidAt ?? String(invoice.updated_at ?? invoice.created_at ?? new Date().toISOString()),
      resolved_at: paidAt,
      reference: paymentReference || null,
    });
  }

  return history.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

function normalizePortalDocumentVisibility(input: {
  createdAt: string;
  latestAudit: DocumentVisibilityAuditRow | null;
}): {
  label: string;
  detail: string;
  released_at: string;
} {
  const releaseAt = input.latestAudit?.created_at ?? input.createdAt;
  const reason = input.latestAudit?.reason?.trim() || "Shared by your dealership team for portal access.";

  return {
    label: "Visible in customer portal",
    detail: reason,
    released_at: releaseAt,
  };
}

function notificationLabel(notificationType: string): string {
  switch (notificationType) {
    case "quote_ready":
      return "Quote available";
    case "schedule_confirmed":
      return "Service scheduled";
    case "job_started":
      return "Service started";
    case "job_completed":
      return "Service completed";
    case "invoice_ready":
      return "Invoice ready";
    case "tat_delay_advisory":
      return "Service delay advisory";
    case "parts_shipped":
      return "Parts order shipped";
    default:
      return titleCaseStatus(notificationType);
  }
}

function equipmentDisplayLabel(input: {
  make?: string | null;
  model?: string | null;
  year?: number | null;
}): string {
  const label = [input.make, input.model].filter(Boolean).join(" ").trim();
  return input.year ? `${label} (${input.year})` : label || "Equipment";
}

function normalizePortalPartsOrderStatus(input: {
  orderStatus: string | null;
  estimatedDelivery: string | null;
  updatedAt: string | null;
}): {
  label: string;
  source: "default";
  source_label: string;
  eta: string | null;
  last_updated_at: string | null;
  next_action?: string | null;
} {
  const status = (input.orderStatus ?? "").toLowerCase();

  if (status === "draft") {
    return {
      label: "Draft order",
      source: "default",
      source_label: "Parts counter",
      eta: null,
      last_updated_at: input.updatedAt,
      next_action: "Submit the draft when you are ready for the dealership to process it.",
    };
  }

  if (status === "submitted") {
    return {
      label: "Submitted to dealership",
      source: "default",
      source_label: "Parts counter",
      eta: input.estimatedDelivery,
      last_updated_at: input.updatedAt,
      next_action: "The parts team is reviewing availability and will confirm next steps.",
    };
  }

  if (status === "confirmed") {
    return {
      label: "Availability confirmed",
      source: "default",
      source_label: "Parts counter",
      eta: input.estimatedDelivery,
      last_updated_at: input.updatedAt,
      next_action: "Your dealership has confirmed the order and is preparing fulfillment.",
    };
  }

  if (status === "processing") {
    return {
      label: "Preparing shipment",
      source: "default",
      source_label: "Parts counter",
      eta: input.estimatedDelivery,
      last_updated_at: input.updatedAt,
      next_action: "The parts team is picking and staging your order.",
    };
  }

  if (status === "shipped") {
    return {
      label: "Shipped",
      source: "default",
      source_label: "Parts counter",
      eta: input.estimatedDelivery,
      last_updated_at: input.updatedAt,
      next_action: "Watch the delivery ETA and contact your dealership if the shipment changes.",
    };
  }

  if (status === "delivered") {
    return {
      label: "Delivered",
      source: "default",
      source_label: "Parts counter",
      eta: input.estimatedDelivery,
      last_updated_at: input.updatedAt,
      next_action: "If anything is missing or damaged, contact your dealership team.",
    };
  }

  if (status === "cancelled") {
    return {
      label: "Cancelled",
      source: "default",
      source_label: "Parts counter",
      eta: null,
      last_updated_at: input.updatedAt,
      next_action: "Contact your dealership if you need to place a replacement order.",
    };
  }

  return {
    label: "Order update pending",
    source: "default",
    source_label: "Parts counter",
    eta: input.estimatedDelivery,
    last_updated_at: input.updatedAt,
  };
}

/** Internal users in profile_workspaces for this tenant + eligible roles (no cross-workspace blast). */
async function workspaceStaffRecipientIds(
  admin: SupabaseClient,
  portalWorkspaceId: string,
): Promise<string[]> {
  const { data: pwRows, error: pwErr } = await admin
    .from("profile_workspaces")
    .select("profile_id")
    .eq("workspace_id", portalWorkspaceId);
  if (pwErr) {
    console.warn("portal-api profile_workspaces:", pwErr);
    return [];
  }
  const profileIds = [
    ...new Set(((pwRows ?? []) as { profile_id: string }[]).map((r) => r.profile_id)),
  ];
  if (profileIds.length === 0) {
    console.warn("portal-api: no profile_workspaces for workspace", portalWorkspaceId);
    return [];
  }
  const out: string[] = [];
  for (let i = 0; i < profileIds.length; i += STAFF_NOTIFY_CHUNK) {
    const chunk = profileIds.slice(i, i + STAFF_NOTIFY_CHUNK);
    const { data: rec } = await admin
      .from("profiles")
      .select("id")
      .in("id", chunk)
      .in("role", [...STAFF_NOTIFY_ROLES]);
    for (const r of (rec as { id: string }[] | null) ?? []) {
      out.push(r.id);
    }
  }
  return [...new Set(out)];
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseAnon) {
      return safeJsonError("Service misconfigured", 503, origin);
    }

    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    const supabase = createClient(
      supabaseUrl,
      supabaseAnon,
      { global: { headers: { Authorization: authHeader } } },
    );
    const admin = serviceKey
      ? createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      : null;

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return safeJsonError("Unauthorized", 401, origin);
    }

    // Verify caller is a portal customer (not internal staff using wrong API)
    const { data: portalCustomer } = await supabase
      .from("portal_customers")
      .select("id, is_active, workspace_id, crm_company_id, crm_contact_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (!portalCustomer) {
      return safeJsonError("Not a portal customer. Use internal QRM API.", 403, origin);
    }
    if (!portalCustomer.is_active) {
      return safeJsonError("Portal account is deactivated.", 403, origin);
    }

    const portalWorkspaceId = portalCustomer.workspace_id as string;

    const url = new URL(req.url);
    const rawPath = url.pathname.replace(/^\/functions\/v1\/portal-api\/?/, "");
    const pathParts = rawPath.split("/").filter(Boolean);
    const route = pathParts[0] ?? "";
    const subRoute = pathParts[1] ?? "";

    // ── /fleet — Customer equipment fleet ──────────────────────────────
    if (route === "fleet") {
      if (req.method === "GET") {
        const { data, error } = await supabase
          .from("customer_fleet")
          .select("*, maintenance_schedules(*)")
          .order("created_at", { ascending: false });

        if (error) return safeJsonError("Failed to load fleet", 500, origin);
        return safeJsonOk({ fleet: data }, origin);
      }
    }

    // ── /service-requests — Service request CRUD ───────────────────────
    if (route === "service-requests") {
      // GET /service-requests/:id/timeline — customer-safe shop timeline (P1-D)
      if (
        req.method === "GET" &&
        pathParts.length >= 3 &&
        pathParts[2] === "timeline"
      ) {
        const requestId = pathParts[1]?.trim() ?? "";
        if (!requestId || !/^[0-9a-f-]{36}$/i.test(requestId)) {
          return safeJsonError("Invalid service request id", 400, origin);
        }
        const { data, error } = await supabase.rpc("portal_get_service_job_timeline", {
          p_service_request_id: requestId,
        });
        if (error) {
          console.error("portal_get_service_job_timeline:", error);
          return safeJsonError("Failed to load timeline", 500, origin);
        }
        const payload = data as { ok?: boolean; error?: string } | null;
        if (payload && payload.ok === false && payload.error === "not_found") {
          return safeJsonError("Request not found", 404, origin);
        }
        if (payload && payload.ok === false && payload.error === "not_portal_user") {
          return safeJsonError("Not allowed", 403, origin);
        }
        return safeJsonOk(data ?? {}, origin);
      }

      if (req.method === "GET") {
        if (!admin) {
          return safeJsonError("Service workspace is not configured on this environment.", 503, origin);
        }

        const { data, error } = await admin
          .from("service_requests")
          .select(`
            *,
            internal_job:service_jobs (
              id,
              current_stage,
              priority,
              updated_at,
              closed_at,
              scheduled_end_at,
              branch_id,
              status_flags
            )
          `)
          .eq("portal_customer_id", portalCustomer.id)
          .eq("workspace_id", portalWorkspaceId)
          .order("created_at", { ascending: false });

        if (error) return safeJsonError("Failed to load requests", 500, origin);

        const branchIds = [...new Set(
          ((data ?? []) as Array<Record<string, unknown>>)
            .map((request) => {
              const internalJobRaw = request.internal_job;
              const internalJob = Array.isArray(internalJobRaw)
                ? (internalJobRaw[0] as Record<string, unknown> | undefined)
                : (internalJobRaw as Record<string, unknown> | null);
              return typeof internalJob?.branch_id === "string" ? internalJob.branch_id : null;
            })
            .filter((value): value is string => Boolean(value)),
        )];

        const { data: branchRows } = branchIds.length > 0
          ? await admin.from("branches").select("id, display_name").in("id", branchIds)
          : { data: [] };
        const branchById = new Map(((branchRows ?? []) as Array<Record<string, unknown>>).map((row) => [
          String(row.id),
          typeof row.display_name === "string" ? row.display_name : "Assigned branch",
        ]));

        const requests = ((data ?? []) as Array<Record<string, unknown>>).map((request) => {
          const internalJobRaw = request.internal_job;
          const internalJob = Array.isArray(internalJobRaw)
            ? (internalJobRaw[0] as Record<string, unknown> | undefined)
            : (internalJobRaw as Record<string, unknown> | null);

          const portalStatus = normalizePortalStatus({
            requestStatus: typeof request.status === "string" ? request.status : null,
            requestEta: typeof request.estimated_completion === "string" ? request.estimated_completion : null,
            requestUpdatedAt: typeof request.updated_at === "string" ? request.updated_at : null,
            jobStage: typeof internalJob?.current_stage === "string" ? internalJob.current_stage : null,
            jobEta: typeof internalJob?.scheduled_end_at === "string" ? internalJob.scheduled_end_at : null,
            jobUpdatedAt: typeof internalJob?.updated_at === "string" ? internalJob.updated_at : null,
          });

          const statusLabel = portalStatus.label;
          const branchLabel = typeof internalJob?.branch_id === "string"
            ? branchById.get(internalJob.branch_id) ?? null
            : null;
          const nextStep = portalStatus.source === "service_job"
            ? `The ${branchLabel ?? "shop"} is progressing this request through ${statusLabel.toLowerCase()}.`
            : `Your dealership will acknowledge and route this ${String(request.request_type)} request.`;

          return {
            ...request,
            portal_status: portalStatus,
            photo_count: Array.isArray(request.photos) ? request.photos.length : 0,
            workspace_timeline: {
              branch_label: branchLabel,
              next_step: nextStep,
              customer_summary: serviceWorkspaceSummaryLine(statusLabel, String(request.request_type ?? "service")),
            },
          };
        });

        const typedRequests = requests as Array<Record<string, unknown> & { status?: string; portal_status?: { label?: string } }>;
        const openRequests = typedRequests.filter((request) => !["completed", "cancelled"].includes(String(request.status)));
        const completedRequests = typedRequests.filter((request) => ["completed", "cancelled"].includes(String(request.status)));
        const blockedRequests = requests.filter((request) =>
          /waiting|parts/i.test(String(request.portal_status?.label ?? "")),
        );

        return safeJsonOk({
          requests,
          open_requests: openRequests,
          completed_requests: completedRequests.slice(0, 10),
          blocked_requests: blockedRequests,
          workspace_summary: {
            open_count: openRequests.length,
            completed_count: completedRequests.length,
            blocked_count: blockedRequests.length,
          },
        }, origin);
      }

      if (req.method === "POST") {
        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body as Record<string, unknown>;
        if (!body.request_type || !body.description) {
          return safeJsonError("request_type and description required", 400, origin);
        }

        const validTypes = ["repair", "maintenance", "warranty", "parts", "inspection", "emergency"];
        if (!validTypes.includes(String(body.request_type))) {
          return safeJsonError(`request_type must be one of: ${validTypes.join(", ")}`, 400, origin);
        }

        const validUrgencies = ["low", "normal", "high", "emergency"];
        if (body.urgency && !validUrgencies.includes(String(body.urgency))) {
          return safeJsonError(`urgency must be one of: ${validUrgencies.join(", ")}`, 400, origin);
        }
        const validDepartments = ["service", "parts"];
        if (body.department && !validDepartments.includes(String(body.department))) {
          return safeJsonError(`department must be one of: ${validDepartments.join(", ")}`, 400, origin);
        }

        // Whitelist safe fields — block billing/status manipulation
        const safeBody = {
          workspace_id: portalWorkspaceId,
          portal_customer_id: portalCustomer.id,
          fleet_id: body.fleet_id ?? null,
          request_type: body.request_type,
          description: body.description,
          urgency: (body.urgency as string) || "normal",
          department: (body.department as string) || null,
          photos: Array.isArray(body.photos) ? body.photos : [],
          preferred_date: body.preferred_date ?? null,
          preferred_branch: body.preferred_branch ?? null,
        };

        const { data, error } = await supabase
          .from("service_requests")
          .insert(safeBody)
          .select()
          .single();

        if (error) return safeJsonError("Failed to create request", 500, origin);
        return safeJsonOk({ request: data }, origin, 201);
      }
    }

    // ── /parts — Parts orders ──────────────────────────────────────────
    if (route === "parts") {
      // POST /parts/suggest-pm-kit — AI-assisted PM kit from job_codes + optional LLM narrative
      if (subRoute === "suggest-pm-kit" && req.method === "POST") {
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!serviceKey) {
          return safeJsonError("PM kit suggestions are not configured on this environment.", 503, origin);
        }

        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body as Record<string, unknown>;
        const fleetId = typeof body.fleet_id === "string" ? body.fleet_id.trim() : "";
        if (!fleetId) {
          return safeJsonError("fleet_id is required", 400, origin);
        }

        const admin = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: fleetRow, error: fleetErr } = await admin
          .from("customer_fleet")
          .select(
            "id, make, model, serial_number, current_hours, next_service_due, service_interval_hours, workspace_id, portal_customer_id",
          )
          .eq("id", fleetId)
          .eq("portal_customer_id", portalCustomer.id)
          .eq("workspace_id", portalWorkspaceId)
          .maybeSingle();

        if (fleetErr || !fleetRow) {
          return safeJsonError("Fleet machine not found for this account.", 404, origin);
        }

        const fleet = fleetRow as CustomerFleetRow;
        const makeTrim = fleet.make?.trim() ?? "";
        if (!makeTrim) {
          return safeJsonError("Fleet record is missing equipment make.", 400, origin);
        }

        let { data: jobCodes } = await admin
          .from("job_codes")
          .select("id, job_name, make, model_family, parts_template, common_add_ons, confidence_score")
          .eq("workspace_id", portalWorkspaceId)
          .eq("make", makeTrim)
          .order("confidence_score", { ascending: false })
          .limit(25);

        if (!jobCodes?.length) {
          const { data: fuzzy } = await admin
            .from("job_codes")
            .select("id, job_name, make, model_family, parts_template, common_add_ons, confidence_score")
            .eq("workspace_id", portalWorkspaceId)
            .ilike("make", `%${makeTrim}%`)
            .order("confidence_score", { ascending: false })
            .limit(25);
          jobCodes = fuzzy ?? [];
        }

        const codes = (jobCodes ?? []) as JobCodePmRow[];
        if (codes.length === 0) {
          return safeJsonOk({
            ok: false,
            error: "no_job_code_match",
            message:
              "No dealership PM template is on file for this equipment make yet. Enter part numbers manually or contact parts.",
          }, origin);
        }

        const sorted = [...codes].sort(
          (a, b) => scoreJobCodeForFleet(b, fleet) - scoreJobCodeForFleet(a, fleet),
        );
        const chosen = sorted[0];
        const lineItems = buildPmKitLinesFromJobCode(chosen);
        if (lineItems.length === 0) {
          return safeJsonOk({
            ok: false,
            error: "empty_template",
            message:
              "A job code matched your machine but its PM parts list is empty. Add lines manually or ask your dealer to publish templates.",
            matched_job_code: {
              id: chosen.id,
              job_name: chosen.job_name,
              make: chosen.make,
              model_family: chosen.model_family,
            },
          }, origin);
        }

        const apiKey = Deno.env.get("OPENAI_API_KEY");
        const fallbackReason = deterministicPmReason(fleet, chosen, lineItems.length);
        const aiReason = (await explainPmKitWithLlm(apiKey, fleet, chosen, lineItems)) ?? fallbackReason;

        return safeJsonOk({
          ok: true,
          ai_suggested_pm_kit: true,
          ai_suggestion_reason: aiReason,
          line_items: lineItems.map((l) => ({
            part_number: l.part_number,
            quantity: l.quantity,
            description: l.description,
            unit_price: l.unit_price,
            is_ai_suggested: true,
          })),
          matched_job_code: {
            id: chosen.id,
            job_name: chosen.job_name,
            make: chosen.make,
            model_family: chosen.model_family,
          },
        }, origin);
      }

      // POST /parts/submit — draft → submitted (validated here; RLS blocks naive status bumps)
      if (subRoute === "submit" && req.method === "POST") {
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!serviceKey) {
          return safeJsonError("Order submission is not configured on this environment.", 503, origin);
        }
        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body as Record<string, unknown>;
        const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
        if (!orderId) {
          return safeJsonError("order_id is required", 400, origin);
        }

        const admin = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: row, error: fetchErr } = await admin
          .from("parts_orders")
          .select("id, portal_customer_id, status, workspace_id")
          .eq("id", orderId)
          .maybeSingle();

        if (fetchErr || !row) {
          return safeJsonError("Order not found.", 404, origin);
        }
        if (row.portal_customer_id !== portalCustomer.id || row.workspace_id !== portalWorkspaceId) {
          return safeJsonError("Order not found.", 404, origin);
        }
        if (row.status !== "draft") {
          return safeJsonError("Only draft orders can be submitted to the dealership.", 400, origin);
        }

        const { data: run, error: runErr } = await admin
          .from("parts_fulfillment_runs")
          .insert({ workspace_id: portalWorkspaceId, status: "submitted" })
          .select("id")
          .single();

        if (runErr || !run?.id) {
          console.error("portal-api parts fulfillment run:", runErr);
          return safeJsonError("Failed to submit order", 500, origin);
        }

        const { data: updated, error: upErr } = await admin
          .from("parts_orders")
          .update({ status: "submitted", fulfillment_run_id: run.id })
          .eq("id", orderId)
          .select()
          .single();

        if (upErr) {
          console.error("portal-api parts submit:", upErr);
          return safeJsonError("Failed to submit order", 500, origin);
        }

        const { error: evErr } = await admin.from("parts_fulfillment_events").insert({
          workspace_id: portalWorkspaceId,
          fulfillment_run_id: run.id,
          event_type: "portal_submitted",
          payload: { parts_order_id: orderId, audit_channel: "portal" },
        });
        if (evErr) {
          console.warn("portal-api fulfillment event:", evErr);
        }

        const shortRef = orderId.replace(/-/g, "").slice(0, 8).toUpperCase();

        try {
          const { data: pc } = await admin
            .from("portal_customers")
            .select("email, notification_preferences, first_name, last_name")
            .eq("id", portalCustomer.id)
            .maybeSingle();
          const custLabel = safePortalDisplayLabel(
            [pc?.first_name, pc?.last_name].filter(Boolean).join(" ").trim() || "Portal customer",
          );

          const prefs = pc?.notification_preferences as { email?: boolean } | undefined;
          const em = typeof pc?.email === "string" ? pc.email.trim() : "";
          if (prefs?.email !== false && em.includes("@")) {
            await sendResendEmail({
              to: em,
              subject: `QEP — Parts order submitted (${shortRef})`,
              text:
                `Your parts order request was submitted to the dealership.\n\n` +
                `Reference: ${shortRef}\n\n` +
                `We will confirm availability and contact you if anything changes.\n\n` +
                `— Quality Equipment & Parts`,
            });
          }

          const recipientIds = await workspaceStaffRecipientIds(admin, portalWorkspaceId);
          const rows = recipientIds.map((uid) => ({
            workspace_id: portalWorkspaceId,
            user_id: uid,
            kind: "service_portal_parts_submitted",
            title: "Portal parts order submitted",
            body:
              `${custLabel} submitted a parts order (${shortRef}). Open Service → Portal orders to process.`,
            metadata: {
              parts_order_id: orderId,
              fulfillment_run_id: run.id,
              notification_type: "portal_parts_submitted",
            },
          }));
          for (let i = 0; i < rows.length; i += STAFF_NOTIFY_CHUNK) {
            const slice = rows.slice(i, i + STAFF_NOTIFY_CHUNK);
            const { error: niErr } = await admin.from("crm_in_app_notifications").insert(slice);
            if (niErr) {
              console.warn("portal-api staff in-app notify:", niErr);
              break;
            }
          }
        } catch (e) {
          console.warn("portal-api submit notify:", e);
        }

        return safeJsonOk({ order: updated }, origin);
      }

      if (req.method === "GET") {
        const { data, error } = await supabase
          .from("parts_orders")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) return safeJsonError("Failed to load orders", 500, origin);
        const orders = ((data ?? []) as Array<Record<string, unknown>>).map((order) => ({
          ...order,
          portal_status: normalizePortalPartsOrderStatus({
            orderStatus: typeof order.status === "string" ? order.status : null,
            estimatedDelivery: typeof order.estimated_delivery === "string" ? order.estimated_delivery : null,
            updatedAt: typeof order.updated_at === "string" ? order.updated_at : null,
          }),
        }));
        return safeJsonOk({ orders }, origin);
      }

      if (req.method === "POST") {
        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body as Record<string, unknown>;

        const line_items = sanitizePortalLineItemsForOrder(body.line_items);
        if (line_items.length === 0) {
          return safeJsonError("line_items array is required with at least one valid item", 400, origin);
        }

        const aiReason =
          typeof body.ai_suggestion_reason === "string"
            ? body.ai_suggestion_reason.trim().slice(0, 2000)
            : null;

        // Whitelist safe fields — totals computed server-side, not customer-provided
        const safeBody: Record<string, unknown> = {
          workspace_id: portalWorkspaceId,
          portal_customer_id: portalCustomer.id,
          fleet_id: body.fleet_id || null,
          status: "draft", // Always start as draft
          line_items,
          shipping_address: body.shipping_address || null,
          notes: body.notes || null,
        };

        if (body.ai_suggested_pm_kit === true) {
          safeBody.ai_suggested_pm_kit = true;
          safeBody.ai_suggestion_reason = aiReason;
        }

        const { data, error } = await supabase
          .from("parts_orders")
          .insert(safeBody)
          .select()
          .single();

        if (error) return safeJsonError("Failed to create order", 500, origin);
        return safeJsonOk({ order: data }, origin, 201);
      }
    }

    // ── /invoices — Payment portal ─────────────────────────────────────
    if (route === "invoices") {
      if (req.method === "GET" && !subRoute) {
        const { data, error } = await supabase
          .from("customer_invoices")
          .select("*, customer_invoice_line_items(*)")
          .order("invoice_date", { ascending: false });

        if (error) return safeJsonError("Failed to load invoices", 500, origin);

        const invoiceRows = (data ?? []) as Array<Record<string, unknown>>;
        const invoiceIds = invoiceRows
          .map((row) => typeof row.id === "string" ? row.id : null)
          .filter((value): value is string => Boolean(value));

        let intentsByInvoice = new Map<string, PortalPaymentIntentRow[]>();
        const crmCompanyId = typeof portalCustomer.crm_company_id === "string" ? portalCustomer.crm_company_id : null;
        if (invoiceIds.length > 0 && crmCompanyId) {
          const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: intentRows } = await admin
            .from("portal_payment_intents")
            .select("id, invoice_id, stripe_payment_intent_id, amount_cents, currency, status, webhook_signature_verified, metadata, created_at, updated_at, succeeded_at, failed_at, failure_reason")
            .eq("company_id", crmCompanyId)
            .in("invoice_id", invoiceIds)
            .order("created_at", { ascending: false });

          for (const row of ((intentRows ?? []) as PortalPaymentIntentRow[])) {
            if (row.invoice_id) {
              intentsByInvoice.set(row.invoice_id, [...(intentsByInvoice.get(row.invoice_id) ?? []), row]);
            }
          }
        }

        let subscriptionBillingByInvoice = new Map<string, Record<string, unknown>>();
        if (invoiceIds.length > 0 && crmCompanyId) {
          const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data: usageRows } = await admin
            .from("eaas_usage_records")
            .select("invoice_id, period_start, period_end, hours_included, hours_used, overage_hours, overage_charge, subscription_id, eaas_subscriptions!inner(plan_name, includes_maintenance)")
            .in("invoice_id", invoiceIds);

          for (const row of ((usageRows ?? []) as Array<Record<string, unknown>>)) {
            const invoiceId = typeof row.invoice_id === "string" ? row.invoice_id : null;
            if (!invoiceId || subscriptionBillingByInvoice.has(invoiceId)) continue;
            const subscription = row.eaas_subscriptions as Record<string, unknown> | null;
            subscriptionBillingByInvoice.set(invoiceId, {
              subscription_id: typeof row.subscription_id === "string" ? row.subscription_id : "",
              plan_name: typeof subscription?.plan_name === "string" ? subscription.plan_name : "Subscription plan",
              billing_period_start: typeof row.period_start === "string" ? row.period_start : "",
              billing_period_end: typeof row.period_end === "string" ? row.period_end : "",
              included_hours: typeof row.hours_included === "number" ? row.hours_included : null,
              used_hours: typeof row.hours_used === "number" ? row.hours_used : null,
              overage_hours: typeof row.overage_hours === "number" ? row.overage_hours : null,
              overage_charge: typeof row.overage_charge === "number" ? row.overage_charge : null,
              maintenance_included: subscription?.includes_maintenance !== false,
            });
          }
        }

        const invoices = invoiceRows.map((invoice) => {
          const invoiceId = typeof invoice.id === "string" ? invoice.id : null;
          const invoiceIntents = invoiceId ? intentsByInvoice.get(invoiceId) ?? [] : [];
          const latestIntent = invoiceIntents[0] ?? null;
          const portalPaymentHistory = buildPortalPaymentHistory(invoice, invoiceIntents);
          return {
            ...invoice,
            portal_payment_status: normalizePortalPaymentStatus(latestIntent),
            portal_payment_history: portalPaymentHistory,
            portal_subscription_billing: invoiceId ? subscriptionBillingByInvoice.get(invoiceId) ?? null : null,
            portal_invoice_timeline: buildPortalInvoiceTimeline({
              invoiceDate: typeof invoice.invoice_date === "string" ? invoice.invoice_date : null,
              status: typeof invoice.status === "string" ? invoice.status : null,
              paidAt: typeof invoice.paid_at === "string" ? invoice.paid_at : null,
              updatedAt: typeof invoice.updated_at === "string" ? invoice.updated_at : null,
              paymentHistory: portalPaymentHistory,
            }),
          };
        });

        const typedInvoices = invoices as Array<Record<string, unknown> & {
          balance_due?: number | null;
          status?: string | null;
          portal_payment_history?: PortalPaymentHistoryItem[];
          portal_subscription_billing?: Record<string, unknown> | null;
        }>;

        const billingSummary = {
          open_balance: typedInvoices.reduce((sum, invoice) => sum + Number(invoice.balance_due ?? 0), 0),
          overdue_balance: typedInvoices
            .filter((invoice) => String(invoice.status) === "overdue")
            .reduce((sum, invoice) => sum + Number(invoice.balance_due ?? 0), 0),
          subscription_invoices: typedInvoices.filter((invoice) => Boolean(invoice.portal_subscription_billing)).length,
          payments_in_flight: typedInvoices.filter((invoice) =>
            Array.isArray(invoice.portal_payment_history)
              && invoice.portal_payment_history.some((entry) => entry.status === "processing" || entry.status === "pending")
          ).length,
        };

        return safeJsonOk({ invoices, billing_summary: billingSummary }, origin);
      }

      if (req.method === "POST" && subRoute === "pay") {
        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body as {
          invoice_id?: string;
          amount?: number;
          payment_method?: string;
          payment_reference?: string;
        };
        if (!body.invoice_id || body.amount == null) {
          return safeJsonError("invoice_id and amount required", 400, origin);
        }
        const amt = Number(body.amount);
        if (!Number.isFinite(amt) || amt <= 0) {
          return safeJsonError("amount must be a positive number", 400, origin);
        }

        const { data: rpcResult, error: rpcErr } = await supabase.rpc(
          "portal_record_invoice_payment",
          {
            p_invoice_id: body.invoice_id,
            p_amount: amt,
            p_payment_method: body.payment_method ?? null,
            p_payment_reference: body.payment_reference ?? null,
          },
        );
        if (rpcErr) return safeJsonError(rpcErr.message, 400, origin);
        const res = rpcResult as { ok?: boolean; error?: string };
        if (!res?.ok) {
          return safeJsonError(res?.error ?? "payment_failed", 400, origin);
        }
        return safeJsonOk({ ok: true, result: rpcResult }, origin);
      }
    }

    // ── /quotes — Quote review + e-signature ───────────────────────────
    if (route === "quotes") {
      if (req.method === "GET") {
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!serviceKey) {
          return safeJsonError("Quote review is not configured on this environment.", 503, origin);
        }

        const admin = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data, error } = await admin
          .from("portal_quote_reviews")
          .select("*")
          .eq("portal_customer_id", portalCustomer.id)
          .order("created_at", { ascending: false });

        if (error) return safeJsonError("Failed to load quotes", 500, origin);

        const quoteRows = (data ?? []) as PortalQuoteReviewRow[];
        const quoteIds = quoteRows.map((row) => row.id);
        const dealIds = [...new Set(quoteRows.map((row) => row.deal_id).filter((value): value is string => Boolean(value)))];

        let dealsById = new Map<string, PortalDealRow>();
        let stagesById = new Map<string, PortalDealStageRow>();
        if (dealIds.length > 0) {
          const { data: dealRows } = await admin
            .from("crm_deals")
            .select("id, name, amount, expected_close_on, next_follow_up_at, updated_at, stage_id, primary_contact_id, company_id, closed_at")
            .in("id", dealIds)
            .is("deleted_at", null);

          const deals = (dealRows ?? []) as PortalDealRow[];
          dealsById = new Map(deals.map((deal) => [deal.id, deal]));

          const stageIds = [...new Set(deals.map((deal) => deal.stage_id).filter((value): value is string => Boolean(value)))];
          if (stageIds.length > 0) {
            const { data: stageRows } = await admin
              .from("crm_deal_stages")
              .select("id, name, is_closed_won, is_closed_lost")
              .in("id", stageIds);
            const stages = (stageRows ?? []) as PortalDealStageRow[];
            stagesById = new Map(stages.map((stage) => [stage.id, stage]));
          }
        }

        let revisionsByQuoteId = new Map<string, PortalQuoteRevisionRow[]>();
        if (quoteIds.length > 0) {
          const { data: revisionRows } = await admin
            .from("portal_quote_review_versions")
            .select("id, portal_quote_review_id, version_number, quote_data, quote_pdf_url, dealer_message, revision_summary, customer_request_snapshot, published_at, is_current")
            .in("portal_quote_review_id", quoteIds)
            .order("version_number", { ascending: false });

          for (const row of ((revisionRows ?? []) as PortalQuoteRevisionRow[])) {
            const existing = revisionsByQuoteId.get(row.portal_quote_review_id) ?? [];
            existing.push(row);
            revisionsByQuoteId.set(row.portal_quote_review_id, existing);
          }
        }

        const quotes = quoteRows.map((quote) => {
          const deal = quote.deal_id ? dealsById.get(quote.deal_id) ?? null : null;
          const stage = deal?.stage_id ? stagesById.get(deal.stage_id) ?? null : null;
          const revisions = revisionsByQuoteId.get(quote.id) ?? [];
          const currentRevision = revisions.find((revision) => revision.is_current) ?? revisions[0] ?? null;
          const previousRevision = revisions.length > 1 ? revisions[1] : null;
          const portalStatus = normalizePortalDealStatus({
            dealStageName: stage?.name ?? null,
            isClosedWon: stage?.is_closed_won ?? false,
            isClosedLost: stage?.is_closed_lost ?? false,
            expectedCloseOn: deal?.expected_close_on ?? null,
            nextFollowUpAt: deal?.next_follow_up_at ?? null,
            dealUpdatedAt: deal?.updated_at ?? null,
            quoteStatus: quote.status,
            quoteViewedAt: quote.viewed_at,
            quoteSignedAt: quote.signed_at,
            quoteExpiresAt: quote.expires_at,
            quoteUpdatedAt: quote.updated_at,
          });

          return {
            ...quote,
            deal_name: deal?.name ?? null,
            amount: deal?.amount ?? null,
            quote_pdf_url: currentRevision?.quote_pdf_url ?? quote.quote_pdf_url ?? null,
            quote_data: currentRevision?.quote_data ?? quote.quote_data ?? null,
            portal_status: portalStatus,
            current_revision: currentRevision
              ? {
                id: currentRevision.id,
                version_number: currentRevision.version_number,
                published_at: currentRevision.published_at,
                is_current: currentRevision.is_current,
                dealer_message: currentRevision.dealer_message,
                revision_summary: currentRevision.revision_summary,
                customer_request_snapshot: currentRevision.customer_request_snapshot,
                quote_pdf_url: currentRevision.quote_pdf_url,
                quote_data: currentRevision.quote_data,
              }
              : null,
            revision_history: revisions.map((revision) => ({
              id: revision.id,
              version_number: revision.version_number,
              published_at: revision.published_at,
              is_current: revision.is_current,
              dealer_message: revision.dealer_message,
              revision_summary: revision.revision_summary,
              customer_request_snapshot: revision.customer_request_snapshot,
            })),
            compare_to_previous: buildPortalQuoteCompare(currentRevision, previousRevision),
          };
        });

        return safeJsonOk({ quotes }, origin);
      }

      if (req.method === "PUT") {
        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body as Record<string, unknown>;
        if (!body.id) return safeJsonError("id required", 400, origin);

        const validStatuses = ["viewed", "accepted", "rejected", "countered"];
        if (body.status && !validStatuses.includes(String(body.status))) {
          return safeJsonError(`status must be one of: ${validStatuses.join(", ")}`, 400, origin);
        }

        // Build safe update — customers cannot set signature fields directly
        const safeUpdates: Record<string, unknown> = {};

        if (body.status === "viewed") {
          safeUpdates.status = "viewed";
          safeUpdates.viewed_at = new Date().toISOString();
        } else if (body.status === "accepted") {
          if (!body.signer_name || typeof body.signer_name !== "string") {
            return safeJsonError("signer_name required when accepting", 400, origin);
          }
          // Sanitize: strip HTML tags, limit length
          const cleanName = body.signer_name.replace(/<[^>]*>/g, "").trim().substring(0, 100);
          if (!cleanName) {
            return safeJsonError("signer_name cannot be empty", 400, origin);
          }
          safeUpdates.status = "accepted";
          safeUpdates.signer_name = cleanName;
          safeUpdates.signed_at = new Date().toISOString();
          if (body.signature_png_base64 && typeof body.signature_png_base64 === "string") {
            const raw = String(body.signature_png_base64).replace(/\s/g, "");
            if (raw.length > 400_000) {
              return safeJsonError("signature image too large", 400, origin);
            }
            if (!/^[A-Za-z0-9+/=]+$/.test(raw)) {
              return safeJsonError("signature must be base64 PNG", 400, origin);
            }
            safeUpdates.signature_url = `data:image/png;base64,${raw}`;
          }
          // Use Cloudflare's trusted header, fallback chain for non-CF environments
          safeUpdates.signer_ip = req.headers.get("cf-connecting-ip")
            || req.headers.get("x-real-ip")
            || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            || "unknown";
          // signature_url would be set by a separate upload flow
        } else if (body.status === "rejected") {
          safeUpdates.status = "rejected";
        } else if (body.status === "countered") {
          if (!body.counter_notes || typeof body.counter_notes !== "string") {
            return safeJsonError("counter_notes required when requesting changes", 400, origin);
          }
          const cleanNotes = body.counter_notes.replace(/<[^>]*>/g, "").trim().substring(0, 2000);
          if (!cleanNotes) {
            return safeJsonError("counter_notes cannot be empty", 400, origin);
          }
          safeUpdates.status = "countered";
          safeUpdates.counter_notes = cleanNotes;
        }

        if (Object.keys(safeUpdates).length === 0) {
          return safeJsonError("No valid fields to update", 400, origin);
        }

        const { data, error } = await supabase
          .from("portal_quote_reviews")
          .update(safeUpdates)
          .eq("id", body.id)
          .select()
          .single();

        if (error) return safeJsonError("Failed to update quote", 500, origin);
        return safeJsonOk({ quote: data }, origin);
      }
    }

    // ── /deals/active — Active portal commercial work ────────────────
    if (route === "deals" && subRoute === "active" && req.method === "GET") {
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceKey) {
        return safeJsonError("Active deals are not configured on this environment.", 503, origin);
      }

      const admin = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const crmCompanyId = typeof portalCustomer.crm_company_id === "string" ? portalCustomer.crm_company_id : null;
      const crmContactId = typeof portalCustomer.crm_contact_id === "string" ? portalCustomer.crm_contact_id : null;

      if (!crmCompanyId && !crmContactId) {
        return safeJsonOk({ deals: [] }, origin);
      }

      let dealQuery = admin
        .from("crm_deals")
        .select("id, name, amount, expected_close_on, next_follow_up_at, updated_at, stage_id, primary_contact_id, company_id, closed_at")
        .is("deleted_at", null);

      if (crmCompanyId && crmContactId) {
        dealQuery = dealQuery.or(`company_id.eq.${crmCompanyId},primary_contact_id.eq.${crmContactId}`);
      } else if (crmCompanyId) {
        dealQuery = dealQuery.eq("company_id", crmCompanyId);
      } else if (crmContactId) {
        dealQuery = dealQuery.eq("primary_contact_id", crmContactId);
      }

      const { data: dealRows, error: dealError } = await dealQuery.order("updated_at", { ascending: false }).limit(30);
      if (dealError) return safeJsonError("Failed to load active deals", 500, origin);

      const deals = (dealRows ?? []) as PortalDealRow[];
      if (deals.length === 0) {
        return safeJsonOk({ deals: [] }, origin);
      }

      const stageIds = [...new Set(deals.map((deal) => deal.stage_id).filter((value): value is string => Boolean(value)))];
      const { data: stageRows } = stageIds.length > 0
        ? await admin.from("crm_deal_stages").select("id, name, is_closed_won, is_closed_lost").in("id", stageIds)
        : { data: [] as PortalDealStageRow[] };
      const stagesById = new Map(((stageRows ?? []) as PortalDealStageRow[]).map((stage) => [stage.id, stage]));

      const dealIds = deals.map((deal) => deal.id);
      const { data: quoteRows } = await admin
        .from("portal_quote_reviews")
        .select("id, deal_id, status, viewed_at, signed_at, expires_at, updated_at, signer_name")
        .eq("portal_customer_id", portalCustomer.id)
        .in("deal_id", dealIds)
        .order("updated_at", { ascending: false });
      const latestQuoteByDeal = new Map<string, PortalQuoteReviewRow>();
      for (const row of ((quoteRows ?? []) as PortalQuoteReviewRow[])) {
        if (row.deal_id && !latestQuoteByDeal.has(row.deal_id)) {
          latestQuoteByDeal.set(row.deal_id, row);
        }
      }

      const activeDeals = deals
        .map((deal) => {
          const stage = deal.stage_id ? stagesById.get(deal.stage_id) ?? null : null;
          const quote = latestQuoteByDeal.get(deal.id) ?? null;
          const portalStatus = normalizePortalDealStatus({
            dealStageName: stage?.name ?? null,
            isClosedWon: stage?.is_closed_won ?? false,
            isClosedLost: stage?.is_closed_lost ?? false,
            expectedCloseOn: deal.expected_close_on,
            nextFollowUpAt: deal.next_follow_up_at,
            dealUpdatedAt: deal.updated_at,
            quoteStatus: quote?.status ?? null,
            quoteViewedAt: quote?.viewed_at ?? null,
            quoteSignedAt: quote?.signed_at ?? null,
            quoteExpiresAt: quote?.expires_at ?? null,
            quoteUpdatedAt: quote?.updated_at ?? null,
          });

          return {
            deal_id: deal.id,
            deal_name: deal.name,
            amount: deal.amount,
            expected_close_on: deal.expected_close_on,
            next_follow_up_at: deal.next_follow_up_at,
            quote_review_id: quote?.id ?? null,
            quote_review_status: quote?.status ?? null,
            portal_status: portalStatus,
          };
        })
        .filter((deal) => {
          const stage = deals.find((row) => row.id === deal.deal_id)?.stage_id
            ? stagesById.get(deals.find((row) => row.id === deal.deal_id)!.stage_id!)
            : null;
          if (stage?.is_closed_lost) return false;
          if (stage?.is_closed_won && !["accepted"].includes((deal.quote_review_status ?? "").toLowerCase())) {
            return false;
          }
          if ((deal.quote_review_status ?? "").toLowerCase() === "rejected") return false;
          return true;
        });

      return safeJsonOk({ deals: activeDeals }, origin);
    }

    // ── /subscriptions — EaaS subscriptions ────────────────────────────
    if (route === "subscriptions") {
      if (req.method === "GET") {
        if (!admin) {
          return safeJsonError("Subscriptions are not configured on this environment.", 503, origin);
        }

        const { data, error } = await admin
          .from("eaas_subscriptions")
          .select("id, equipment_id, plan_name, plan_type, status, billing_cycle, base_monthly_rate, usage_cap_hours, overage_rate, next_billing_date, next_rotation_date, includes_maintenance")
          .eq("portal_customer_id", portalCustomer.id)
          .eq("workspace_id", portalWorkspaceId)
          .order("created_at", { ascending: false });

        if (error) return safeJsonError("Failed to load subscriptions", 500, origin);
        const subscriptions = (data ?? []) as Array<{
          id: string;
          equipment_id: string | null;
          plan_name: string;
          plan_type: string;
          status: string;
          billing_cycle: string | null;
          base_monthly_rate: number;
          usage_cap_hours: number | null;
          overage_rate: number | null;
          next_billing_date: string | null;
          next_rotation_date: string | null;
          includes_maintenance: boolean | null;
        }>;

        if (subscriptions.length === 0) {
          return safeJsonOk({ subscriptions: [] }, origin);
        }

        const subscriptionIds = subscriptions.map((subscription) => subscription.id);
        const equipmentIds = subscriptions
          .map((subscription) => subscription.equipment_id)
          .filter((value): value is string => Boolean(value));

        const { data: usageRows } = await admin
          .from("eaas_usage_records")
          .select("subscription_id, hours_used, overage_hours, period_end")
          .in("subscription_id", subscriptionIds)
          .order("period_end", { ascending: false });

        const { data: maintenanceRows } = await admin
          .from("maintenance_schedules")
          .select("subscription_id, scheduled_date, status")
          .in("subscription_id", subscriptionIds)
          .in("status", ["scheduled", "due", "in_progress", "overdue"])
          .order("scheduled_date", { ascending: true });

        const { data: equipmentRows } = equipmentIds.length > 0
          ? await admin
            .from("crm_equipment")
            .select("id, make, model, serial_number, year")
            .in("id", equipmentIds)
          : { data: [] };

        const latestUsageBySubscription = new Map<string, { hours_used: number | null; overage_hours: number | null }>();
        for (const row of ((usageRows ?? []) as Array<Record<string, unknown>>)) {
          const subscriptionId = typeof row.subscription_id === "string" ? row.subscription_id : null;
          if (!subscriptionId || latestUsageBySubscription.has(subscriptionId)) continue;
          latestUsageBySubscription.set(subscriptionId, {
            hours_used: typeof row.hours_used === "number" ? row.hours_used : null,
            overage_hours: typeof row.overage_hours === "number" ? row.overage_hours : null,
          });
        }

        const maintenanceBySubscription = new Map<string, { openCount: number; nextScheduledDate: string | null }>();
        for (const row of ((maintenanceRows ?? []) as Array<Record<string, unknown>>)) {
          const subscriptionId = typeof row.subscription_id === "string" ? row.subscription_id : null;
          if (!subscriptionId) continue;
          const current = maintenanceBySubscription.get(subscriptionId) ?? { openCount: 0, nextScheduledDate: null };
          current.openCount += 1;
          if (!current.nextScheduledDate && typeof row.scheduled_date === "string") {
            current.nextScheduledDate = row.scheduled_date;
          }
          maintenanceBySubscription.set(subscriptionId, current);
        }

        const equipmentById = new Map(
          ((equipmentRows ?? []) as Array<Record<string, unknown>>).map((row) => [
            String(row.id),
            {
              id: String(row.id),
              label: equipmentDisplayLabel({
                make: typeof row.make === "string" ? row.make : null,
                model: typeof row.model === "string" ? row.model : null,
                year: typeof row.year === "number" ? row.year : null,
              }),
              serialNumber: typeof row.serial_number === "string" ? row.serial_number : null,
            },
          ]),
        );

        return safeJsonOk({
          subscriptions: subscriptions.map((subscription) => ({
            id: subscription.id,
            planName: subscription.plan_name,
            planType: subscription.plan_type,
            status: subscription.status,
            billingCycle: subscription.billing_cycle,
            baseMonthlyRate: subscription.base_monthly_rate,
            usageCapHours: subscription.usage_cap_hours,
            overageRate: subscription.overage_rate,
            usageHours: latestUsageBySubscription.get(subscription.id)?.hours_used ?? null,
            overageHours: latestUsageBySubscription.get(subscription.id)?.overage_hours ?? null,
            nextBillingDate: subscription.next_billing_date,
            nextRotationDate: subscription.next_rotation_date,
            includesMaintenance: subscription.includes_maintenance !== false,
            maintenanceStatus: maintenanceBySubscription.get(subscription.id) ?? {
              openCount: 0,
              nextScheduledDate: null,
            },
            equipment: subscription.equipment_id
              ? equipmentById.get(subscription.equipment_id) ?? {
                id: subscription.equipment_id,
                label: "Assigned equipment",
                serialNumber: null,
              }
              : null,
          })),
        }, origin);
      }
    }

    // ── /rentals — Rental returns and closeout state ──────────────────
    if (route === "rentals") {
      if (req.method === "GET") {
        if (!admin) {
          return safeJsonError("Rental operations are not configured on this environment.", 503, origin);
        }

        const [{ data: contractRows, error: contractError }, { data: extensionRows, error: extensionError }, { data: availableRows, error: availableError }, { data: customerFleetRows, error: customerFleetError }, { data: branchRows, error: branchError }, { data: ruleRows, error: ruleError }] =
          await Promise.all([
            admin
              .from("rental_contracts")
              .select("*")
              .eq("portal_customer_id", portalCustomer.id)
              .eq("workspace_id", portalWorkspaceId)
              .order("created_at", { ascending: false }),
            admin
              .from("rental_contract_extensions")
              .select("*")
              .eq("workspace_id", portalWorkspaceId)
              .order("created_at", { ascending: false }),
            admin
              .from("crm_equipment")
              .select("id, name, make, model, year, serial_number, category, daily_rental_rate, weekly_rental_rate, monthly_rental_rate")
              .eq("workspace_id", portalWorkspaceId)
              .eq("ownership", "rental_fleet")
              .eq("availability", "available")
              .is("deleted_at", null)
              .limit(200),
            admin
              .from("customer_fleet")
              .select("equipment_id, make, model, serial_number, year")
              .eq("portal_customer_id", portalCustomer.id)
              .eq("workspace_id", portalWorkspaceId)
              .not("equipment_id", "is", null),
            admin
              .from("branches")
              .select("id, display_name")
              .eq("workspace_id", portalWorkspaceId)
              .eq("is_active", true),
            admin
              .from("rental_rate_rules")
              .select("*")
              .eq("workspace_id", portalWorkspaceId)
              .eq("is_active", true),
          ]);

        if (contractError) return safeJsonError("Failed to load rental contracts", 500, origin);
        if (extensionError) return safeJsonError("Failed to load rental extensions", 500, origin);
        if (availableError) return safeJsonError("Failed to load rentable equipment", 500, origin);
        if (customerFleetError) return safeJsonError("Failed to load rental fleet", 500, origin);
        if (branchError) return safeJsonError("Failed to load rental branches", 500, origin);
        if (ruleError) return safeJsonError("Failed to load rental pricing rules", 500, origin);

        const customerFleet = (customerFleetRows ?? []) as Array<{
          equipment_id: string;
          make: string | null;
          model: string | null;
          serial_number: string | null;
          year: number | null;
        }>;
        const contracts = (contractRows ?? []) as RentalContractRow[];
        const contractIds = contracts.map((row) => row.id);
        const extensions = ((extensionRows ?? []) as RentalExtensionRow[]).filter((row) => contractIds.includes(row.rental_contract_id));
        const invoiceIds = [
          ...new Set([
            ...contracts.map((row) => row.deposit_invoice_id).filter(Boolean) as string[],
            ...extensions.map((row) => row.payment_invoice_id).filter(Boolean) as string[],
          ]),
        ];
        const { data: invoiceRows } = invoiceIds.length > 0
          ? await admin.from("customer_invoices").select("id, status").in("id", invoiceIds)
          : { data: [] };
        const invoiceStatusById = new Map(((invoiceRows ?? []) as Array<Record<string, unknown>>).map((row) => [
          String(row.id),
          typeof row.status === "string" ? row.status : null,
        ]));
        const equipmentIds = [
          ...new Set([
            ...customerFleet.map((row) => row.equipment_id).filter(Boolean),
            ...contracts.map((row) => row.equipment_id).filter(Boolean) as string[],
          ]),
        ];

        const { data: returnRows, error: rentalError } = equipmentIds.length > 0
          ? await admin
            .from("rental_returns")
            .select("id, equipment_id, status, rental_contract_reference, inspection_date, decision_at, refund_status, balance_due, charge_amount, deposit_amount, has_charges, rental_contract_id")
            .eq("workspace_id", portalWorkspaceId)
            .in("equipment_id", equipmentIds)
            .order("created_at", { ascending: false })
          : { data: [], error: null };
        if (rentalError) return safeJsonError("Failed to load rental returns", 500, origin);

        const equipmentById = new Map<string, { id: string; label: string; serialNumber: string | null; category: string | null; rates: { daily: number | null; weekly: number | null; monthly: number | null } }>();
        for (const row of ((availableRows ?? []) as Array<Record<string, unknown>>)) {
          equipmentById.set(String(row.id), {
            id: String(row.id),
            label: equipmentDisplayLabel({
              make: typeof row.make === "string" ? row.make : null,
              model: typeof row.model === "string" ? row.model : null,
              year: typeof row.year === "number" ? row.year : null,
            }),
            serialNumber: typeof row.serial_number === "string" ? row.serial_number : null,
            category: typeof row.category === "string" ? row.category : null,
            rates: {
              daily: typeof row.daily_rental_rate === "number" ? row.daily_rental_rate : null,
              weekly: typeof row.weekly_rental_rate === "number" ? row.weekly_rental_rate : null,
              monthly: typeof row.monthly_rental_rate === "number" ? row.monthly_rental_rate : null,
            },
          });
        }
        for (const row of customerFleet) {
          if (!equipmentById.has(row.equipment_id)) {
            equipmentById.set(row.equipment_id, {
              id: row.equipment_id,
              label: equipmentDisplayLabel({ make: row.make, model: row.model, year: row.year }),
              serialNumber: row.serial_number,
              category: null,
              rates: { daily: null, weekly: null, monthly: null },
            });
          }
        }
        const branchById = new Map(((branchRows ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.id), typeof row.display_name === "string" ? row.display_name : "Branch"]));
        const rules = (ruleRows ?? []) as RentalRateRuleRow[];

        const bookings = contracts
          .filter((contract) => contract.request_type === "booking" && !["active", "completed"].includes(contract.status))
          .map((contract) => {
            const equipment = contract.equipment_id ? equipmentById.get(contract.equipment_id) ?? null : null;
            const estimate = resolveRentalPricingEstimate({
              rules,
              customerId: portalCustomer.id,
              equipmentId: contract.equipment_id,
              branchId: contract.branch_id,
              category: contract.requested_category,
              make: contract.requested_make ?? equipment?.label.split(" ")[0] ?? null,
              model: contract.requested_model ?? null,
              equipmentRates: equipment?.rates,
            });
            return {
              id: contract.id,
              requestType: contract.request_type,
              status: contract.status,
              assignmentStatus: contract.assignment_status ?? (contract.equipment_id ? "assigned" : "pending_assignment"),
              deliveryMode: contract.delivery_mode,
              branchId: contract.branch_id,
              branchLabel: contract.branch_id ? branchById.get(contract.branch_id) ?? null : null,
              requestedCategory: contract.requested_category,
              requestedMake: contract.requested_make,
              requestedModel: contract.requested_model,
              requestedStartDate: contract.requested_start_date,
              requestedEndDate: contract.requested_end_date,
              approvedStartDate: contract.approved_start_date,
              approvedEndDate: contract.approved_end_date,
              depositRequired: contract.deposit_required === true,
              depositAmount: contract.deposit_amount,
              depositStatus: contract.deposit_invoice_id
                ? invoiceStatusById.get(contract.deposit_invoice_id) ?? contract.deposit_status
                : contract.deposit_status,
              depositInvoiceId: contract.deposit_invoice_id,
              companyId: typeof portalCustomer.crm_company_id === "string" ? portalCustomer.crm_company_id : null,
              dealerResponse: contract.dealer_response,
              customerNotes: contract.customer_notes,
              pricingEstimate: {
                dailyRate: contract.estimate_daily_rate ?? estimate.dailyRate,
                weeklyRate: contract.estimate_weekly_rate ?? estimate.weeklyRate,
                monthlyRate: contract.estimate_monthly_rate ?? estimate.monthlyRate,
                sourceLabel: estimate.sourceLabel,
              },
              agreedRates: contract.agreed_daily_rate || contract.agreed_weekly_rate || contract.agreed_monthly_rate
                ? {
                  dailyRate: contract.agreed_daily_rate,
                  weeklyRate: contract.agreed_weekly_rate,
                  monthlyRate: contract.agreed_monthly_rate,
                  sourceLabel: "approved contract rates",
                }
                : null,
              paymentStatusView: buildRentalPaymentStatusView({
                kind: "deposit",
                rawStatus: contract.deposit_invoice_id
                  ? invoiceStatusById.get(contract.deposit_invoice_id) ?? contract.deposit_status
                  : contract.deposit_status,
                amount: contract.deposit_amount,
                invoiceId: contract.deposit_invoice_id,
                companyId: typeof portalCustomer.crm_company_id === "string" ? portalCustomer.crm_company_id : null,
              }),
              equipment: equipment
                ? { id: equipment.id, label: equipment.label, serialNumber: equipment.serialNumber }
                : null,
            };
          });

        const activeContracts = contracts
          .filter((contract) => contract.status === "active")
          .map((contract) => {
            const equipment = contract.equipment_id ? equipmentById.get(contract.equipment_id) ?? null : null;
            return {
              id: contract.id,
              requestType: contract.request_type,
              status: contract.status,
              assignmentStatus: contract.assignment_status ?? "assigned",
              deliveryMode: contract.delivery_mode,
              branchId: contract.branch_id,
              branchLabel: contract.branch_id ? branchById.get(contract.branch_id) ?? null : null,
              requestedCategory: contract.requested_category,
              requestedMake: contract.requested_make,
              requestedModel: contract.requested_model,
              requestedStartDate: contract.requested_start_date,
              requestedEndDate: contract.requested_end_date,
              approvedStartDate: contract.approved_start_date,
              approvedEndDate: contract.approved_end_date,
              depositRequired: contract.deposit_required === true,
              depositAmount: contract.deposit_amount,
              depositStatus: contract.deposit_invoice_id
                ? invoiceStatusById.get(contract.deposit_invoice_id) ?? contract.deposit_status
                : contract.deposit_status,
              depositInvoiceId: contract.deposit_invoice_id,
              companyId: typeof portalCustomer.crm_company_id === "string" ? portalCustomer.crm_company_id : null,
              dealerResponse: contract.dealer_response,
              customerNotes: contract.customer_notes,
              pricingEstimate: null,
              agreedRates: {
                dailyRate: contract.agreed_daily_rate,
                weeklyRate: contract.agreed_weekly_rate,
                monthlyRate: contract.agreed_monthly_rate,
                sourceLabel: "approved contract rates",
              },
              paymentStatusView: buildRentalPaymentStatusView({
                kind: "deposit",
                rawStatus: contract.deposit_invoice_id
                  ? invoiceStatusById.get(contract.deposit_invoice_id) ?? contract.deposit_status
                  : contract.deposit_status,
                amount: contract.deposit_amount,
                invoiceId: contract.deposit_invoice_id,
                companyId: typeof portalCustomer.crm_company_id === "string" ? portalCustomer.crm_company_id : null,
              }),
              equipment: equipment
                ? { id: equipment.id, label: equipment.label, serialNumber: equipment.serialNumber }
                : null,
            };
          });

        const extensionRequests = extensions.map((extension) => {
          const paymentStatus = extension.payment_invoice_id
            ? invoiceStatusById.get(extension.payment_invoice_id) ?? extension.payment_status
            : extension.payment_status;
          return {
            id: extension.id,
            rentalContractId: extension.rental_contract_id,
            status: extension.status,
            requestedEndDate: extension.requested_end_date,
            approvedEndDate: extension.approved_end_date,
            customerReason: extension.customer_reason,
            dealerResponse: extension.dealer_response,
            additionalCharge: extension.additional_charge,
            paymentInvoiceId: extension.payment_invoice_id,
            paymentStatus,
            paymentStatusView: buildRentalPaymentStatusView({
              kind: "extension",
              rawStatus: paymentStatus,
              amount: extension.additional_charge,
              invoiceId: extension.payment_invoice_id,
              companyId: typeof portalCustomer.crm_company_id === "string" ? portalCustomer.crm_company_id : null,
            }),
            createdAt: extension.created_at,
          };
        });

        const returns = ((returnRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
          id: String(row.id),
          status: typeof row.status === "string" ? row.status : "inspection_pending",
          rentalContractReference: typeof row.rental_contract_reference === "string" ? row.rental_contract_reference : null,
          inspectionDate: typeof row.inspection_date === "string" ? row.inspection_date : null,
          decisionAt: typeof row.decision_at === "string" ? row.decision_at : null,
          refundStatus: typeof row.refund_status === "string" ? row.refund_status : null,
          balanceDue: typeof row.balance_due === "number" ? row.balance_due : null,
          chargeAmount: typeof row.charge_amount === "number" ? row.charge_amount : null,
          depositAmount: typeof row.deposit_amount === "number" ? row.deposit_amount : null,
          hasCharges: typeof row.has_charges === "boolean" ? row.has_charges : null,
          equipment: typeof row.equipment_id === "string" ? equipmentById.get(row.equipment_id) ?? null : null,
        }));

        return safeJsonOk({
          bookings,
          active_contracts: activeContracts,
          extension_requests: extensionRequests,
          returns,
          workspace_summary: {
            bookingCount: bookings.length,
            activeContractCount: activeContracts.length,
            extensionCount: extensionRequests.length,
            closeoutCount: returns.length,
          },
          booking_catalog: {
            units: Array.from(equipmentById.values()).map((equipment) => ({
              id: equipment.id,
              label: equipment.label,
              category: equipment.category,
              dailyRate: equipment.rates.daily,
              weeklyRate: equipment.rates.weekly,
              monthlyRate: equipment.rates.monthly,
            })),
            categories: Array.from(new Set(Array.from(equipmentById.values()).map((equipment) => equipment.category).filter(Boolean))) as string[],
          },
        }, origin);
      }

      if (subRoute === "book" && req.method === "POST") {
        if (!admin) return safeJsonError("Rental operations are not configured on this environment.", 503, origin);
        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body as Record<string, unknown>;
        const mode = body.mode === "category_first" ? "category_first" : "exact_unit";
        const requestedStartDate = typeof body.requestedStartDate === "string" ? body.requestedStartDate : typeof body.requested_start_date === "string" ? body.requested_start_date : "";
        const requestedEndDate = typeof body.requestedEndDate === "string" ? body.requestedEndDate : typeof body.requested_end_date === "string" ? body.requested_end_date : "";
        if (!requestedStartDate || !requestedEndDate) return safeJsonError("requested_start_date and requested_end_date required", 400, origin);

        let equipmentRow: Record<string, unknown> | null = null;
        let equipmentId: string | null = typeof body.equipmentId === "string" ? body.equipmentId : typeof body.equipment_id === "string" ? body.equipment_id : null;
        if (mode === "exact_unit") {
          if (!equipmentId) return safeJsonError("equipment_id required for exact unit booking", 400, origin);
          const { data, error } = await admin
            .from("crm_equipment")
            .select("id, make, model, category, daily_rental_rate, weekly_rental_rate, monthly_rental_rate")
            .eq("workspace_id", portalWorkspaceId)
            .eq("id", equipmentId)
            .eq("ownership", "rental_fleet")
            .eq("availability", "available")
            .limit(1)
            .maybeSingle();
          if (error || !data) return safeJsonError("Requested rental unit is unavailable", 404, origin);
          equipmentRow = data as Record<string, unknown>;
        }

        const { data: bookingRuleRows, error: bookingRuleError } = await admin
          .from("rental_rate_rules")
          .select("*")
          .eq("workspace_id", portalWorkspaceId)
          .eq("is_active", true);
        if (bookingRuleError) return safeJsonError("Failed to resolve rental pricing", 500, origin);
        const bookingRules = (bookingRuleRows ?? []) as RentalRateRuleRow[];

        const branchId = typeof body.branchId === "string" ? body.branchId : typeof body.branch_id === "string" ? body.branch_id : null;
        const estimate = resolveRentalPricingEstimate({
          rules: bookingRules,
          customerId: portalCustomer.id,
          equipmentId,
          branchId,
          category: typeof body.requestedCategory === "string" ? body.requestedCategory : typeof body.requested_category === "string" ? body.requested_category : typeof equipmentRow?.category === "string" ? equipmentRow.category : null,
          make: typeof body.requestedMake === "string" ? body.requestedMake : typeof body.requested_make === "string" ? body.requested_make : typeof equipmentRow?.make === "string" ? equipmentRow.make : null,
          model: typeof body.requestedModel === "string" ? body.requestedModel : typeof body.requested_model === "string" ? body.requested_model : typeof equipmentRow?.model === "string" ? equipmentRow.model : null,
          equipmentRates: equipmentRow
            ? {
              daily: typeof equipmentRow.daily_rental_rate === "number" ? equipmentRow.daily_rental_rate : null,
              weekly: typeof equipmentRow.weekly_rental_rate === "number" ? equipmentRow.weekly_rental_rate : null,
              monthly: typeof equipmentRow.monthly_rental_rate === "number" ? equipmentRow.monthly_rental_rate : null,
            }
            : undefined,
        });

        const { data: contract, error } = await admin
          .from("rental_contracts")
          .insert({
            workspace_id: portalWorkspaceId,
            portal_customer_id: portalCustomer.id,
            equipment_id: equipmentId,
            assignment_status: mode === "category_first" ? "pending_assignment" : "assigned",
            requested_category: typeof body.requestedCategory === "string" ? body.requestedCategory : typeof body.requested_category === "string" ? body.requested_category : null,
            requested_make: typeof body.requestedMake === "string" ? body.requestedMake : typeof body.requested_make === "string" ? body.requested_make : null,
            requested_model: typeof body.requestedModel === "string" ? body.requestedModel : typeof body.requested_model === "string" ? body.requested_model : null,
            branch_id: branchId,
            delivery_mode: body.deliveryMode === "delivery" || body.delivery_mode === "delivery" ? "delivery" : "pickup",
            delivery_location: typeof body.deliveryLocation === "string" ? body.deliveryLocation : typeof body.delivery_location === "string" ? body.delivery_location : null,
            request_type: "booking",
            requested_start_date: requestedStartDate,
            requested_end_date: requestedEndDate,
            status: "submitted",
            estimate_daily_rate: estimate.dailyRate,
            estimate_weekly_rate: estimate.weeklyRate,
            estimate_monthly_rate: estimate.monthlyRate,
            deposit_required: false,
            deposit_status: "not_required",
            customer_notes: typeof body.customerNotes === "string" ? body.customerNotes : typeof body.customer_notes === "string" ? body.customer_notes : null,
          })
          .select()
          .single();
        if (error) return safeJsonError("Failed to create rental booking", 500, origin);
        return safeJsonOk({ contract }, origin, 201);
      }

      if (subRoute === "estimate" && req.method === "POST") {
        if (!admin) return safeJsonError("Rental operations are not configured on this environment.", 503, origin);
        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body as Record<string, unknown>;

        const equipmentId = typeof body.equipment_id === "string" ? body.equipment_id : null;
        let equipmentRow: Record<string, unknown> | null = null;
        if (equipmentId) {
          const { data, error } = await admin
            .from("crm_equipment")
            .select("id, make, model, category, daily_rental_rate, weekly_rental_rate, monthly_rental_rate")
            .eq("workspace_id", portalWorkspaceId)
            .eq("id", equipmentId)
            .eq("ownership", "rental_fleet")
            .limit(1)
            .maybeSingle();
          if (error) return safeJsonError("Failed to load rental unit for estimate", 500, origin);
          equipmentRow = (data ?? null) as Record<string, unknown> | null;
        }

        const { data: estimateRuleRows, error: estimateRuleError } = await admin
          .from("rental_rate_rules")
          .select("*")
          .eq("workspace_id", portalWorkspaceId)
          .eq("is_active", true);
        if (estimateRuleError) return safeJsonError("Failed to resolve rental pricing", 500, origin);

        const estimate = resolveRentalPricingEstimate({
          rules: (estimateRuleRows ?? []) as RentalRateRuleRow[],
          customerId: portalCustomer.id,
          equipmentId,
          branchId: typeof body.branch_id === "string" ? body.branch_id : null,
          category: typeof body.requested_category === "string" ? body.requested_category : typeof equipmentRow?.category === "string" ? equipmentRow.category : null,
          make: typeof body.requested_make === "string" ? body.requested_make : typeof equipmentRow?.make === "string" ? equipmentRow.make : null,
          model: typeof body.requested_model === "string" ? body.requested_model : typeof equipmentRow?.model === "string" ? equipmentRow.model : null,
          equipmentRates: equipmentRow
            ? {
              daily: typeof equipmentRow.daily_rental_rate === "number" ? equipmentRow.daily_rental_rate : null,
              weekly: typeof equipmentRow.weekly_rental_rate === "number" ? equipmentRow.weekly_rental_rate : null,
              monthly: typeof equipmentRow.monthly_rental_rate === "number" ? equipmentRow.monthly_rental_rate : null,
            }
            : undefined,
        });

        return safeJsonOk({
          estimate: {
            dailyRate: estimate.dailyRate,
            weeklyRate: estimate.weeklyRate,
            monthlyRate: estimate.monthlyRate,
            sourceLabel: estimate.sourceLabel,
          },
        }, origin);
      }

      if (subRoute === "extend" && req.method === "POST") {
        if (!admin) return safeJsonError("Rental operations are not configured on this environment.", 503, origin);
        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body as Record<string, unknown>;
        const rentalContractId = typeof body.rental_contract_id === "string" ? body.rental_contract_id : "";
        const requestedEndDate = typeof body.requested_end_date === "string" ? body.requested_end_date : "";
        if (!rentalContractId || !requestedEndDate) return safeJsonError("rental_contract_id and requested_end_date required", 400, origin);

        const { data: contract, error: contractError } = await admin
          .from("rental_contracts")
          .select("id, portal_customer_id, requested_end_date, approved_end_date")
          .eq("id", rentalContractId)
          .eq("portal_customer_id", portalCustomer.id)
          .maybeSingle();
        if (contractError || !contract) return safeJsonError("Rental contract not found", 404, origin);

        const { data: extension, error } = await admin
          .from("rental_contract_extensions")
          .insert({
            workspace_id: portalWorkspaceId,
            rental_contract_id: rentalContractId,
            requested_end_date: requestedEndDate,
            status: "submitted",
            customer_reason: typeof body.customer_reason === "string" ? body.customer_reason : null,
            requested_by: portalCustomer.id,
            payment_status: "not_required",
          })
          .select()
          .single();
        if (error) return safeJsonError("Failed to create rental extension request", 500, origin);
        return safeJsonOk({ extension }, origin, 201);
      }

      if (subRoute === "request" && req.method === "PUT") {
        if (!admin) return safeJsonError("Rental operations are not configured on this environment.", 503, origin);
        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body as Record<string, unknown>;
        const kind = body.kind === "extension" ? "extension" : "contract";
        const id = typeof body.id === "string" ? body.id : "";
        if (!id) return safeJsonError("id required", 400, origin);

        if (kind === "contract") {
          const { data: contract, error: contractError } = await admin
            .from("rental_contracts")
            .select("id, portal_customer_id, status")
            .eq("id", id)
            .eq("portal_customer_id", portalCustomer.id)
            .maybeSingle();
          if (contractError || !contract) return safeJsonError("Rental contract not found", 404, origin);
          if (!["submitted", "reviewing", "quoted"].includes(contract.status)) {
            return safeJsonError("This rental request can no longer be edited by the customer", 400, origin);
          }

          const patch: Record<string, unknown> = {};
          if (body.action === "cancel") {
            patch.status = "cancelled";
          } else {
            if (typeof body.requested_start_date === "string") patch.requested_start_date = body.requested_start_date;
            if (typeof body.requested_end_date === "string") patch.requested_end_date = body.requested_end_date;
            if (typeof body.customer_notes === "string") patch.customer_notes = body.customer_notes;
            if (typeof body.delivery_location === "string") patch.delivery_location = body.delivery_location;
          }

          const { data: updated, error } = await admin
            .from("rental_contracts")
            .update(patch)
            .eq("id", id)
            .select()
            .single();
          if (error) return safeJsonError("Failed to update rental request", 500, origin);
          return safeJsonOk({ contract: updated }, origin);
        }

        const { data: extension, error: extensionError } = await admin
          .from("rental_contract_extensions")
          .select("id, status, rental_contract_id, rental_contracts!inner(portal_customer_id)")
          .eq("id", id)
          .maybeSingle();
        if (extensionError || !extension) return safeJsonError("Rental extension request not found", 404, origin);
        const contractJoin = Array.isArray(extension.rental_contracts) ? extension.rental_contracts[0] : extension.rental_contracts;
        if (contractJoin?.portal_customer_id !== portalCustomer.id) return safeJsonError("Rental extension request not found", 404, origin);
        if (!["submitted", "reviewing"].includes(extension.status)) {
          return safeJsonError("This extension request can no longer be edited by the customer", 400, origin);
        }

        const patch: Record<string, unknown> = {};
        if (body.action === "cancel") patch.status = "cancelled";
        else {
          if (typeof body.requested_end_date === "string") patch.requested_end_date = body.requested_end_date;
          if (typeof body.customer_reason === "string") patch.customer_reason = body.customer_reason;
        }
        const { data: updated, error } = await admin
          .from("rental_contract_extensions")
          .update(patch)
          .eq("id", id)
          .select()
          .single();
        if (error) return safeJsonError("Failed to update rental extension request", 500, origin);
        return safeJsonOk({ extension: updated }, origin);
      }

      if (subRoute === "approve-payment" && req.method === "POST") {
        if (!admin) return safeJsonError("Rental operations are not configured on this environment.", 503, origin);
        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;
        const body = parsed.body as Record<string, unknown>;
        const kind = body.kind === "extension" ? "extension" : "contract";
        const id = typeof body.id === "string" ? body.id : "";
        if (!id) return safeJsonError("id required", 400, origin);

        if (kind === "contract") {
          const { data: contract, error: contractError } = await admin
            .from("rental_contracts")
            .select("id, portal_customer_id, status, deposit_required, deposit_invoice_id")
            .eq("id", id)
            .eq("portal_customer_id", portalCustomer.id)
            .maybeSingle();
          if (contractError || !contract) return safeJsonError("Rental contract not found", 404, origin);

          let invoiceStatus = "paid";
          if (contract.deposit_required && contract.deposit_invoice_id) {
            const { data: invoice } = await admin
              .from("customer_invoices")
              .select("status")
              .eq("id", contract.deposit_invoice_id)
              .maybeSingle();
            invoiceStatus = typeof invoice?.status === "string" ? invoice.status : "";
          }

          if (contract.deposit_required && invoiceStatus !== "paid") {
            return safeJsonError("Rental deposit is not settled yet", 400, origin);
          }

          const { data: updated, error } = await admin
            .from("rental_contracts")
            .update({
              status: "active",
              deposit_status: contract.deposit_required ? "paid" : "not_required",
            })
            .eq("id", id)
            .select()
            .single();
          if (error) return safeJsonError("Failed to finalize rental payment", 500, origin);
          return safeJsonOk({ contract: updated }, origin);
        }

        const { data: extension, error: extensionError } = await admin
          .from("rental_contract_extensions")
          .select("id, status, payment_invoice_id, rental_contract_id, approved_end_date, rental_contracts!inner(portal_customer_id)")
          .eq("id", id)
          .maybeSingle();
        if (extensionError || !extension) return safeJsonError("Rental extension request not found", 404, origin);
        const contractJoin = Array.isArray(extension.rental_contracts) ? extension.rental_contracts[0] : extension.rental_contracts;
        if (contractJoin?.portal_customer_id !== portalCustomer.id) return safeJsonError("Rental extension request not found", 404, origin);

        let invoiceStatus = "paid";
        if (extension.payment_invoice_id) {
          const { data: invoice } = await admin
            .from("customer_invoices")
            .select("status")
            .eq("id", extension.payment_invoice_id)
            .maybeSingle();
          invoiceStatus = typeof invoice?.status === "string" ? invoice.status : "";
        }
        if (extension.payment_invoice_id && invoiceStatus !== "paid") {
          return safeJsonError("Extension payment is not settled yet", 400, origin);
        }

        await admin
          .from("rental_contract_extensions")
          .update({ payment_status: extension.payment_invoice_id ? "paid" : "not_required" })
          .eq("id", id);
        const { data: updatedContract, error } = await admin
          .from("rental_contracts")
          .update({
            approved_end_date: extension.approved_end_date,
            requested_end_date: extension.approved_end_date,
          })
          .eq("id", extension.rental_contract_id)
          .select()
          .single();
        if (error) return safeJsonError("Failed to finalize extension payment", 500, origin);
        return safeJsonOk({ contract: updatedContract }, origin);
      }
    }

    // ── /warranty-claims — Warranty claim submission ──────────────────
    if (route === "warranty-claims") {
      if (req.method === "GET") {
        const { data, error } = await supabase
          .from("portal_warranty_claims")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) return safeJsonError("Failed to load warranty claims", 500, origin);
        return safeJsonOk({ claims: data }, origin);
      }

      if (req.method === "POST") {
        const body = await req.json();
        if (!body.claim_type || !body.description) {
          return safeJsonError("claim_type and description required", 400, origin);
        }

        const validTypes = ["manufacturer_defect", "premature_failure", "warranty_repair", "recall", "other"];
        if (!validTypes.includes(body.claim_type)) {
          return safeJsonError(`claim_type must be one of: ${validTypes.join(", ")}`, 400, origin);
        }

        const safeBody = {
          portal_customer_id: portalCustomer.id,
          fleet_id: body.fleet_id || null,
          claim_type: body.claim_type,
          description: body.description,
          photos: Array.isArray(body.photos) ? body.photos : [],
        };

        const { data, error } = await supabase
          .from("portal_warranty_claims")
          .insert(safeBody)
          .select()
          .single();

        if (error) return safeJsonError("Failed to submit warranty claim", 500, origin);

        // Notify internal staff
        const supabaseAdmin = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const { data: serviceStaff } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .in("iron_role", ["iron_woman", "iron_man"])
          .limit(5);

        if (serviceStaff) {
          for (const staff of serviceStaff) {
            await supabaseAdmin.from("crm_in_app_notifications").insert({
              workspace_id: "default",
              user_id: staff.id,
              kind: "warranty_claim",
              title: "New Warranty Claim",
              body: `${body.claim_type.replace(/_/g, " ")} claim submitted: ${body.description.substring(0, 100)}`,
              metadata: { claim_id: data.id, portal_customer_id: portalCustomer.id },
            });
          }
        }

        return safeJsonOk({ claim: data }, origin, 201);
      }
    }

    // ── /fleet-with-status — Live service job state per equipment ────
    if (route === "fleet-with-status" && req.method === "GET") {
      const { data, error } = await supabase.rpc("get_portal_fleet_with_status", {
        p_portal_customer_id: portalCustomer.id,
      });
      if (error) return safeJsonError("Failed to load fleet with status", 500, origin);
      const fleet = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
        const activeServiceJob = row.active_service_job as Record<string, unknown> | null;
        const portalStatus = normalizePortalStatus({
          jobStage: typeof activeServiceJob?.current_stage === "string" ? activeServiceJob.current_stage : null,
          jobEta: typeof activeServiceJob?.estimated_completion === "string"
            ? activeServiceJob.estimated_completion
            : null,
          jobUpdatedAt: typeof activeServiceJob?.last_updated_at === "string"
            ? activeServiceJob.last_updated_at
            : null,
          idleUpdatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
        });

        return {
          ...row,
          stage_label: portalStatus.label,
          stage_source: portalStatus.source,
          stage_source_label: portalStatus.source_label,
          eta: portalStatus.eta,
          last_updated_at: portalStatus.last_updated_at,
          portal_status: portalStatus,
        };
      });
      return safeJsonOk({ fleet }, origin);
    }

    // ── /parts/reorder-history — Parts history by machine + one-click ─
    if (route === "parts-history" && req.method === "GET") {
      const { data, error } = await supabase.rpc("get_parts_reorder_history", {
        p_portal_customer_id: portalCustomer.id,
      });
      if (error) return safeJsonError("Failed to load parts history", 500, origin);
      return safeJsonOk({ history: data }, origin);
    }

    // ── /documents — Document library by fleet/serial ────────────────
    if (route === "documents") {
      if (req.method === "GET") {
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!serviceKey) {
          return safeJsonError("Document library is not configured on this environment.", 503, origin);
        }

        const admin = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const url2 = new URL(req.url);
        const fleetId = url2.searchParams.get("fleet_id");
        let query = supabase
          .from("equipment_documents")
          .select("*")
          .eq("customer_visible", true)
          .order("created_at", { ascending: false });

        if (fleetId) query = query.eq("fleet_id", fleetId);

        const { data, error } = await query;
        if (error) return safeJsonError("Failed to load documents", 500, origin);

        const docs = (data ?? []) as Array<Record<string, unknown>>;
        const docIds = docs
          .map((doc) => typeof doc.id === "string" ? doc.id : null)
          .filter((value): value is string => Boolean(value));

        let latestAuditByDocument = new Map<string, DocumentVisibilityAuditRow>();
        if (docIds.length > 0) {
          const { data: auditRows } = await admin
            .from("document_visibility_audit")
            .select("document_id, visibility_after, created_at, reason")
            .in("document_id", docIds)
            .order("created_at", { ascending: false });

          for (const row of ((auditRows ?? []) as DocumentVisibilityAuditRow[])) {
            if (!row.document_id || latestAuditByDocument.has(row.document_id)) continue;
            if (row.visibility_after === false) continue;
            latestAuditByDocument.set(row.document_id, row);
          }
        }

        const documents = docs.map((doc) => {
          const docId = typeof doc.id === "string" ? doc.id : "";
          const latestAudit = latestAuditByDocument.get(docId) ?? null;
          return {
            ...doc,
            portal_visibility: normalizePortalDocumentVisibility({
              createdAt: typeof doc.created_at === "string" ? doc.created_at : new Date().toISOString(),
              latestAudit,
            }),
          };
        });

        return safeJsonOk({ documents }, origin);
      }
    }

    // ── /settings — Portal profile + notification preferences/history ───
    if (route === "settings") {
      if (req.method === "GET") {
        const { data: customerRow, error: customerErr } = await supabase
          .from("portal_customers")
          .select("id, first_name, last_name, email, phone, notification_preferences")
          .eq("id", portalCustomer.id)
          .maybeSingle();

        if (customerErr || !customerRow) {
          return safeJsonError("Failed to load portal settings", 500, origin);
        }

        const { data: notificationRows, error: notificationErr } = await supabase
          .from("portal_customer_notifications")
          .select("id, category, event_type, channel, title, body, sent_at")
          .order("sent_at", { ascending: false })
          .limit(20);

        if (notificationErr) {
          return safeJsonError("Failed to load notification history", 500, origin);
        }

        const notificationFeed: PortalNotificationFeedItem[] = sortPortalNotifications(
          ((notificationRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
            id: String(row.id),
            category: (typeof row.category === "string" ? row.category : "service") as PortalNotificationFeedItem["category"],
            label: typeof row.title === "string" ? row.title : notificationLabel(typeof row.event_type === "string" ? row.event_type : "update"),
            detail: typeof row.body === "string" ? row.body : "Notification update",
            channel: typeof row.channel === "string" && ["portal", "email", "sms"].includes(row.channel)
              ? row.channel as "portal" | "email" | "sms"
              : "portal",
            occurred_at: typeof row.sent_at === "string" ? row.sent_at : new Date().toISOString(),
          })),
        );

        const prefs = (customerRow.notification_preferences && typeof customerRow.notification_preferences === "object" && !Array.isArray(customerRow.notification_preferences))
          ? customerRow.notification_preferences as Record<string, unknown>
          : {};

        return safeJsonOk({
          customer: {
            id: customerRow.id,
            first_name: customerRow.first_name,
            last_name: customerRow.last_name,
            email: customerRow.email,
            phone: customerRow.phone,
            notification_preferences: {
              email: prefs.email !== false,
              sms: prefs.sms === true,
            },
          },
          notifications: notificationFeed.slice(0, 20),
        }, origin);
      }

      if (req.method === "PUT") {
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!serviceKey) {
          return safeJsonError("Portal settings are not configured on this environment.", 503, origin);
        }
        const parsed = await parseJsonBody(req, origin);
        if (!parsed.ok) return parsed.response;

        const body = parsed.body as Record<string, unknown>;
        const rawPrefs = (body.notification_preferences && typeof body.notification_preferences === "object" && !Array.isArray(body.notification_preferences))
          ? body.notification_preferences as Record<string, unknown>
          : {};

        const admin = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const nextPrefs = {
          email: rawPrefs.email !== false,
          sms: rawPrefs.sms === true,
        };

        const { data: updated, error: updateErr } = await admin
          .from("portal_customers")
          .update({ notification_preferences: nextPrefs })
          .eq("id", portalCustomer.id)
          .select("notification_preferences")
          .maybeSingle();

        if (updateErr || !updated) {
          return safeJsonError("Failed to update notification preferences", 500, origin);
        }

        return safeJsonOk({ notification_preferences: updated.notification_preferences }, origin);
      }
    }

    // ── /fleet/:id/trade-interest — Toggle trade-in interest ────────
    if (route === "fleet" && req.method === "PUT") {
      const body = await req.json();
      if (!body.fleet_id) return safeJsonError("fleet_id required", 400, origin);

      const { data, error } = await supabase
        .from("customer_fleet")
        .update({
          trade_in_interest: body.trade_in_interest ?? false,
          trade_in_notes: body.trade_in_notes ?? null,
        })
        .eq("id", body.fleet_id)
        .select()
        .single();

      if (error) return safeJsonError("Failed to update trade-in interest", 500, origin);
      return safeJsonOk({ fleet_item: data }, origin);
    }

    return safeJsonError("Not found", 404, origin);
  } catch (err) {
    console.error("portal-api error:", err);
    captureEdgeException(err, { fn: "portal-api", req });
    return safeJsonError("Internal server error", 500, req.headers.get("origin"));
  }
});
