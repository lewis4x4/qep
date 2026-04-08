/**
 * Wave 7.1 Iron Companion — quick action template registry.
 *
 * Each template either dispatches a flow (`flow_slug`) or just pre-fills
 * the input with a knowledge query (`knowledge_only`). Templates are
 * filtered by the user's role and can be ranked by recency-weighted
 * affinity from `iron_top_flows(user_id)` (migration 206) so the most-
 * used actions float to the top.
 *
 * Add new templates here — the IronBar picks them up automatically. The
 * `phrase` field uses `{slot}` placeholders which the user fills in via
 * the slot-fill UI after the flow is dispatched (we don't try to parse
 * arguments from a single typed line).
 */
import {
  AlertCircle,
  ClipboardList,
  CreditCard,
  FileText,
  Mail,
  MessageCircle,
  Receipt,
  Search,
  Truck,
  UserPlus,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type IronUserRole = "rep" | "admin" | "manager" | "owner";

export interface IronTemplate {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** What gets typed into the input when the user clicks the template. */
  phrase: string;
  /** Roles allowed to see this template. */
  roles: IronUserRole[];
  /** If set, this template dispatches a flow on send. Otherwise it's a knowledge query. */
  flow_slug?: string;
  /** True for templates that bypass the classifier and go straight to iron-knowledge. */
  knowledge_only?: boolean;
}

export const IRON_TEMPLATES: IronTemplate[] = [
  // ── Action templates (dispatch a flow) ─────────────────────────────────
  {
    id: "pull_part",
    label: "Pull a part",
    description: "Reserve a part from inventory and attach it to a work order",
    icon: Wrench,
    phrase: "pull a part for ",
    roles: ["rep", "admin", "manager", "owner"],
    flow_slug: "pull_part",
  },
  {
    id: "start_rental",
    label: "Start a rental",
    description: "Open a rental agreement and reserve equipment",
    icon: Truck,
    phrase: "start a rental for ",
    roles: ["rep", "admin", "manager", "owner"],
    flow_slug: "start_rental",
  },
  {
    id: "log_service_call",
    label: "Log a service call",
    description: "Open a service job for a customer's machine",
    icon: ClipboardList,
    phrase: "log a service call for ",
    roles: ["rep", "admin", "manager", "owner"],
    flow_slug: "log_service_call",
  },
  {
    id: "draft_followup",
    label: "Draft a follow-up email",
    description: "Generate a personalized follow-up email for review",
    icon: Mail,
    phrase: "draft a follow-up to ",
    roles: ["rep", "admin", "manager", "owner"],
    flow_slug: "draft_follow_up_email",
  },
  {
    id: "start_quote",
    label: "Start a quote",
    description: "Build a quote with line items and incentives",
    icon: FileText,
    phrase: "start a quote for ",
    roles: ["rep", "admin", "manager", "owner"],
    flow_slug: "start_quote",
  },
  {
    id: "add_customer",
    label: "Add a customer",
    description: "Create a new customer record",
    icon: UserPlus,
    phrase: "add a new customer ",
    roles: ["rep", "admin", "manager", "owner"],
    flow_slug: "add_customer",
  },
  {
    id: "process_trade_in",
    label: "Process a trade-in",
    description: "Capture a trade-in for valuation and link to a deal",
    icon: Receipt,
    phrase: "process a trade-in for ",
    roles: ["rep", "admin", "manager", "owner"],
    flow_slug: "process_trade_in",
  },
  {
    id: "check_ar",
    label: "Check AR balance",
    description: "Look up a customer's accounts receivable status",
    icon: CreditCard,
    phrase: "what's the AR balance for ",
    roles: ["admin", "manager", "owner"],
    flow_slug: "check_ar_status",
  },

  // ── Knowledge templates (skip the classifier) ─────────────────────────
  {
    id: "ask_question",
    label: "Ask Iron anything",
    description: "Get an answer from QEP data, manuals, and the web",
    icon: MessageCircle,
    phrase: "",
    roles: ["rep", "admin", "manager", "owner"],
    knowledge_only: true,
  },
  {
    id: "find_similar",
    label: "Find a similar deal",
    description: "Search for comparable past deals",
    icon: Search,
    phrase: "find a deal similar to ",
    roles: ["rep", "admin", "manager", "owner"],
    knowledge_only: true,
  },
  {
    id: "torque_spec",
    label: "Look up a spec",
    description: "Equipment specs from manuals and OEM sources",
    icon: Search,
    phrase: "what's the spec on a ",
    roles: ["rep", "admin", "manager", "owner"],
    knowledge_only: true,
  },
  {
    id: "explain_alert",
    label: "Explain an alert",
    description: "Ask Iron to walk you through a system alert",
    icon: AlertCircle,
    phrase: "explain this alert: ",
    roles: ["rep", "admin", "manager", "owner"],
    knowledge_only: true,
  },
];

/**
 * Filter templates by role and (optionally) re-rank a subset to the top.
 *
 * @param role        Current user role
 * @param topFlowSlugs Slugs returned by the iron_top_flows RPC, in rank order
 */
export function filterAndRankTemplates(
  role: IronUserRole | string | null | undefined,
  topFlowSlugs: string[] = [],
): IronTemplate[] {
  const r = (role ?? "rep") as IronUserRole;
  const visible = IRON_TEMPLATES.filter((t) => t.roles.includes(r));
  if (topFlowSlugs.length === 0) return visible;
  // Stable partition: pinned (in iron_top_flows order) first, then the rest
  // in declared order.
  const pinnedSet = new Set(topFlowSlugs);
  const pinned: IronTemplate[] = [];
  const rest: IronTemplate[] = [];
  for (const t of visible) {
    if (t.flow_slug && pinnedSet.has(t.flow_slug)) {
      // Position by topFlowSlugs index
      pinned[topFlowSlugs.indexOf(t.flow_slug)] = t;
    } else {
      rest.push(t);
    }
  }
  return [...pinned.filter(Boolean), ...rest];
}
