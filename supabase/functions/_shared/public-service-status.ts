/**
 * Customer-facing status lines for public job tracking (no internal enum exposure).
 * Keep in sync with apps/web/src/features/service/lib/publicServiceStatus.ts
 */

const STAGE_LABELS: Record<string, string> = {
  request_received: "Request Received",
  triaging: "Triaging",
  diagnosis_selected: "Diagnosis Selected",
  quote_drafted: "Quote Drafted",
  quote_sent: "Quote Sent",
  approved: "Approved",
  parts_pending: "Parts Pending",
  parts_staged: "Parts Staged",
  haul_scheduled: "Haul Scheduled",
  scheduled: "Scheduled",
  in_progress: "In Progress",
  blocked_waiting: "Blocked / Waiting",
  quality_check: "Quality Check",
  ready_for_pickup: "Ready for Pickup",
  invoice_ready: "Invoice Ready",
  invoiced: "Invoiced",
  paid_closed: "Paid / Closed",
};

export function publicServiceStatusFromStage(stage: string | null | undefined): {
  headline: string;
  detail: string;
  friendly_stage: string;
} {
  const s = String(stage ?? "request_received");
  const friendly = STAGE_LABELS[s] ?? s.replace(/_/g, " ");

  const intake = new Set(["request_received", "triaging"]);
  const quote = new Set([
    "diagnosis_selected",
    "quote_drafted",
    "quote_sent",
    "approved",
  ]);
  const parts = new Set(["parts_pending", "parts_staged"]);
  const schedule = new Set(["haul_scheduled", "scheduled"]);
  const shop = new Set(["in_progress", "blocked_waiting", "quality_check"]);
  const pickup = new Set(["ready_for_pickup"]);
  const billing = new Set(["invoice_ready", "invoiced", "paid_closed"]);

  if (intake.has(s)) {
    return {
      headline: "We received your request",
      detail:
        `Your service job is in intake (${friendly}). We’ll post updates as work progresses.`,
      friendly_stage: friendly,
    };
  }
  if (quote.has(s)) {
    return {
      headline: "Quote and approval",
      detail: s === "quote_sent"
        ? "We’ve sent a quote — we’ll proceed once it’s approved."
        : `Status: ${friendly}.`,
      friendly_stage: friendly,
    };
  }
  if (parts.has(s)) {
    return {
      headline: "Parts",
      detail: `We’re sourcing or staging parts for this job (${friendly}).`,
      friendly_stage: friendly,
    };
  }
  if (schedule.has(s)) {
    return {
      headline: "Scheduled",
      detail: `Work is scheduled or logistics are being arranged (${friendly}).`,
      friendly_stage: friendly,
    };
  }
  if (shop.has(s)) {
    return {
      headline: "In the shop",
      detail: `Technicians are working this job (${friendly}).`,
      friendly_stage: friendly,
    };
  }
  if (pickup.has(s)) {
    return {
      headline: "Ready for pickup",
      detail: "Your equipment is ready — we’ll coordinate pickup or delivery.",
      friendly_stage: friendly,
    };
  }
  if (billing.has(s)) {
    return {
      headline: s === "paid_closed" ? "Closed" : "Billing",
      detail: s === "paid_closed"
        ? "This job is complete. Thank you for your business."
        : `Finalizing invoice (${friendly}).`,
      friendly_stage: friendly,
    };
  }

  return {
    headline: "Service update",
    detail: friendly,
    friendly_stage: friendly,
  };
}
