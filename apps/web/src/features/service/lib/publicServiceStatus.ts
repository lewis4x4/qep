import type { ServiceStage } from "./constants";
import { STAGE_LABELS } from "./constants";

/**
 * Customer-safe status copy for the public track page (not internal enum strings).
 */
export function getPublicServiceStatus(stage: string): {
  headline: string;
  detail: string;
} {
  const s = stage as ServiceStage;
  const friendly = STAGE_LABELS[s] ?? stage.replace(/_/g, " ");

  const intake: ServiceStage[] = ["request_received", "triaging"];
  const quote: ServiceStage[] = ["diagnosis_selected", "quote_drafted", "quote_sent", "approved"];
  const parts: ServiceStage[] = ["parts_pending", "parts_staged"];
  const schedule: ServiceStage[] = ["haul_scheduled", "scheduled"];
  const shop: ServiceStage[] = ["in_progress", "blocked_waiting", "quality_check"];
  const pickup: ServiceStage[] = ["ready_for_pickup"];
  const billing: ServiceStage[] = ["invoice_ready", "invoiced", "paid_closed"];

  if (intake.includes(s)) {
    return {
      headline: "We received your request",
      detail: `Your job is in intake (${friendly}). We’ll update you as we move forward.`,
    };
  }
  if (quote.includes(s)) {
    return {
      headline: "Quote and approval",
      detail:
        s === "quote_sent"
          ? "We’ve sent a quote — we’ll proceed once it’s approved."
          : `Status: ${friendly}.`,
    };
  }
  if (parts.includes(s)) {
    return {
      headline: "Parts",
      detail: `We’re sourcing or staging parts for this job (${friendly}).`,
    };
  }
  if (schedule.includes(s)) {
    return {
      headline: "Scheduled",
      detail: `Work is scheduled or logistics are being arranged (${friendly}).`,
    };
  }
  if (shop.includes(s)) {
    return {
      headline: "In the shop",
      detail: `Technicians are working this job (${friendly}).`,
    };
  }
  if (pickup.includes(s)) {
    return {
      headline: "Ready for pickup",
      detail: "Your equipment is ready — we’ll coordinate pickup or delivery.",
    };
  }
  if (billing.includes(s)) {
    return {
      headline: s === "paid_closed" ? "Closed" : "Billing",
      detail:
        s === "paid_closed"
          ? "This job is complete. Thank you for your business."
          : `Finalizing invoice (${friendly}).`,
    };
  }

  return {
    headline: "Service update",
    detail: friendly,
  };
}
