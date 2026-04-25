import type { IronRole } from "@/features/qrm/lib/iron-roles";
import type { FloorLayout } from "./layout-types";

export const DEFAULT_FLOOR_LAYOUTS: Record<IronRole, FloorLayout> = {
  iron_owner: {
    widgets: [
      { id: "nervous.customer-health", order: 0 },
      { id: "exec.revenue-pace", order: 1 },
      { id: "exec.bu-pulse", order: 2 },
      { id: "iron.owner-large-deals", order: 3 },
    ],
    quickActions: [
      { id: "ask_iron", label: "Ask Iron", route: "/chat", icon: "sparkles" },
      { id: "open_pipeline", label: "Open Pipeline", route: "/qrm", icon: "activity" },
      { id: "monthly_report", label: "Monthly Report", route: "/admin/deal-economics", icon: "trending" },
    ],
    showNarrative: true,
  },
  iron_manager: {
    widgets: [
      { id: "iron.team-pipeline-table", order: 0 },
      { id: "iron.approval-queue", order: 1 },
      { id: "iron.manager-forecast", order: 2 },
      { id: "iron.margin-trend", order: 3 },
      { id: "iron.manager-stalled-deals", order: 4 },
      { id: "iron.owner-large-deals", order: 5 },
    ],
    quickActions: [
      { id: "open_approvals", label: "OPEN APPROVALS", route: "/qrm/approvals", icon: "approve" },
      { id: "new_quote", label: "NEW QUOTE", route: "/quote-v2", icon: "quote" },
      { id: "nudge_rep", label: "NUDGE REP", route: "/qrm/deals?stalled=true", icon: "users" },
    ],
    showNarrative: true,
  },
  iron_advisor: {
    widgets: [
      { id: "sales.my-quotes-by-status", order: 0 },
      { id: "sales.ai-briefing", order: 1 },
      { id: "sales.action-items", order: 2 },
      { id: "sales.recent-activity", order: 3 },
      { id: "qrm.follow-up-queue", order: 4 },
    ],
    quickActions: [
      { id: "new_quote", label: "NEW QUOTE", route: "/quote-v2", icon: "quote" },
      { id: "voice_note", label: "VOICE NOTE", route: "/voice-qrm", icon: "voice" },
      { id: "my_pipeline", label: "MY PIPELINE", route: "/qrm/deals?assigned_to=me", icon: "activity" },
    ],
    showNarrative: true,
  },
  iron_woman: {
    widgets: [
      { id: "iron.approval-queue", order: 0 },
      { id: "iron.credit-applications", order: 1 },
      { id: "iron-woman.sla-performance", order: 2 },
      { id: "iron.order-processing", order: 3 },
      { id: "iron-woman.recent-decisions", order: 4 },
    ],
    quickActions: [
      { id: "approval_queue", label: "APPROVAL QUEUE", route: "/qrm/approvals?role=deal_desk", icon: "approve" },
      { id: "credit_apps", label: "CREDIT APPS", route: "/qrm/approvals?filter=credit", icon: "credit" },
      { id: "margin_reviews", label: "MARGIN REVIEWS", route: "/qrm/approvals?filter=margin_exception", icon: "trending" },
    ],
    showNarrative: true,
  },
  iron_man: {
    widgets: [
      { id: "iron.prep-queue", order: 0 },
      { id: "iron.pdi-checklists", order: 1 },
      { id: "iron.demo-schedule", order: 2 },
      { id: "service.parts-hub-strip", order: 3 },
      { id: "service.delivery-schedule", order: 4 },
    ],
    quickActions: [
      { id: "next_job", label: "NEXT JOB", route: "/service/wip", icon: "wrench" },
      { id: "pdi_checklist", label: "PDI CHECKLIST", route: "/service/inspections", icon: "check" },
      { id: "todays_demos", label: "TODAY'S DEMOS", route: "/qrm/deals?demo=today", icon: "activity" },
    ],
    showNarrative: true,
  },
  iron_parts_counter: {
    widgets: [
      { id: "parts.serial-first", order: 0 },
      { id: "parts.order-status", order: 1 },
      { id: "parts.customer-intel", order: 2 },
      { id: "parts.quote-drafts", order: 3 },
      { id: "parts.counter-inquiries", order: 4 },
    ],
    quickActions: [
      { id: "new_parts_quote", label: "NEW PARTS QUOTE", route: "/parts/orders/new", icon: "parts" },
      { id: "open_drafts", label: "OPEN DRAFTS", route: "/parts/orders?status=draft", icon: "drafts" },
    ],
    showNarrative: true,
  },
  iron_parts_manager: {
    widgets: [
      { id: "parts.demand-forecast", order: 0 },
      { id: "parts.inventory-health", order: 1 },
      { id: "parts.replenish-queue", order: 2 },
      { id: "parts.order-status", order: 3 },
      { id: "parts.lost-sales", order: 4 },
      { id: "parts.supplier-health", order: 5 },
    ],
    quickActions: [
      { id: "review_replen", label: "REVIEW REPLEN", route: "/parts/companion/replenish", icon: "parts" },
      { id: "inventory_health", label: "INVENTORY", route: "/parts/inventory", icon: "box" },
      { id: "supplier_status", label: "SUPPLIER STATUS", route: "/parts/companion/suppliers", icon: "activity" },
    ],
    showNarrative: true,
  },
};
