/**
 * Shell Map — every legacy /qrm/* route maps to one of the four surfaces in
 * QrmShellV2, optionally with a lens identifier so the secondary row can
 * highlight the right chip.
 *
 * This is the contract that makes the 25-tab → 4-surface collapse provable.
 * If we add a new route, we add a row here. If we ever fall through to
 * `defaultSurface`, that's a bug, not silent behaviour.
 *
 * Surfaces:
 *   today      — what to do in the next 8 hours (moves, schedules, SLA risk)
 *   graph      — the entity explorer (deals, contacts, companies, fleet, rentals)
 *   pulse      — what changed (signals, exceptions, threats, rescue, compete, etc.)
 *   ask        — the ambient agent (Ask Iron)
 *
 * Lenses are surface-local filter identifiers. Inside "graph", a lens is an
 * entity type (deals/contacts/companies/inventory/rentals/operators). Inside
 * "pulse", a lens is a signal category (exceptions/threat/compete/...).
 */

export type SurfaceId = "today" | "graph" | "pulse" | "ask";

export interface SurfaceResolution {
  surface: SurfaceId;
  lens?: string;
}

interface RouteRule {
  /** Path prefix to match. Longest prefix wins. */
  prefix: string;
  surface: SurfaceId;
  lens?: string;
}

const ROUTE_RULES: RouteRule[] = [
  // --- TODAY (what to do now) -----------------------------------------------
  { prefix: "/qrm/activities", surface: "today", lens: "activities" },
  { prefix: "/qrm/campaigns", surface: "today", lens: "campaigns" },
  { prefix: "/qrm/time-bank", surface: "today", lens: "time-bank" },
  { prefix: "/qrm/replacement-prediction", surface: "today", lens: "replace" },
  { prefix: "/qrm/seasonal-opportunity-map", surface: "today", lens: "seasonal" },
  { prefix: "/qrm/revenue-rescue", surface: "today", lens: "rescue" },
  { prefix: "/qrm/post-sale-experience", surface: "today", lens: "post-sale" },
  { prefix: "/qrm/command/approvals", surface: "today", lens: "approvals" },
  { prefix: "/qrm/command/blockers", surface: "today", lens: "blockers" },
  { prefix: "/qrm/command/quotes", surface: "today", lens: "quotes" },
  { prefix: "/qrm/command/trace", surface: "today", lens: "trace" },
  { prefix: "/qrm/my/reality", surface: "today", lens: "my-mirror" },

  // --- GRAPH (the entity explorer) ------------------------------------------
  { prefix: "/qrm/deals", surface: "graph", lens: "deals" },
  { prefix: "/qrm/pipeline", surface: "graph", lens: "deals" },
  { prefix: "/qrm/contacts", surface: "graph", lens: "contacts" },
  { prefix: "/qrm/companies", surface: "graph", lens: "companies" },
  { prefix: "/qrm/accounts", surface: "graph", lens: "companies" },
  { prefix: "/qrm/inventory-pressure", surface: "graph", lens: "inventory" },
  { prefix: "/qrm/rentals", surface: "graph", lens: "rentals" },
  { prefix: "/qrm/operator-intelligence", surface: "graph", lens: "operators" },
  { prefix: "/qrm/opportunity-map", surface: "graph", lens: "map" },
  { prefix: "/qrm/duplicates", surface: "graph", lens: "duplicates" },

  // --- PULSE (what changed) -------------------------------------------------
  { prefix: "/qrm/exceptions", surface: "pulse", lens: "exceptions" },
  { prefix: "/qrm/iron-in-motion", surface: "pulse", lens: "motion" },
  { prefix: "/qrm/competitive-threat-map", surface: "pulse", lens: "threat" },
  { prefix: "/qrm/competitive-displacement", surface: "pulse", lens: "compete" },
  { prefix: "/qrm/service-to-sales", surface: "pulse", lens: "svc-sales" },
  { prefix: "/qrm/parts-intelligence", surface: "pulse", lens: "parts-intel" },
  { prefix: "/qrm/workflow-audit", surface: "pulse", lens: "audit" },
  { prefix: "/qrm/learning-layer", surface: "pulse", lens: "learning" },
  { prefix: "/qrm/sop-folk", surface: "pulse", lens: "sop-folk" },
  { prefix: "/qrm/rep-sku", surface: "pulse", lens: "rep-sku" },
  { prefix: "/qrm/exit-register", surface: "pulse", lens: "exit-register" },

  // --- ASK IRON -------------------------------------------------------------
  { prefix: "/qrm/operations-copilot", surface: "ask", lens: "copilot" },

  // --- ROOT -----------------------------------------------------------------
  // /qrm and /qrm/command land on Today by default.
  { prefix: "/qrm/command", surface: "today" },
  { prefix: "/qrm", surface: "today" },
];

// Sort by descending prefix length so more specific rules win.
const SORTED_RULES = [...ROUTE_RULES].sort((a, b) => b.prefix.length - a.prefix.length);

const DEFAULT_SURFACE: SurfaceId = "today";

export function resolveSurface(pathname: string): SurfaceResolution {
  for (const rule of SORTED_RULES) {
    if (pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) {
      return { surface: rule.surface, lens: rule.lens };
    }
  }
  return { surface: DEFAULT_SURFACE };
}

/**
 * Stable ordering of surfaces in the top nav.
 */
export const SURFACE_ORDER: readonly SurfaceId[] = ["today", "graph", "pulse", "ask"] as const;

export interface SurfaceDefinition {
  id: SurfaceId;
  label: string;
  description: string;
  /** Default href when the surface is clicked from the top nav. */
  href: string;
}

export const SURFACES: Record<SurfaceId, SurfaceDefinition> = {
  today: {
    id: "today",
    label: "Today",
    description: "What to do in the next 8 hours.",
    href: "/qrm/activities",
  },
  graph: {
    id: "graph",
    label: "Graph",
    description: "Every contact, company, deal, machine, rental — one explorer.",
    href: "/qrm/contacts",
  },
  pulse: {
    id: "pulse",
    label: "Pulse",
    description: "What changed. Signals, exceptions, alerts — each with a drafted move.",
    href: "/qrm/exceptions",
  },
  ask: {
    id: "ask",
    label: "Ask Iron",
    description: "The ambient agent. Voice or text. Always listening.",
    href: "/qrm/operations-copilot",
  },
};

export interface LensDefinition {
  id: string;
  label: string;
  href: string;
  surface: SurfaceId;
}

/**
 * Secondary-row chip definitions per surface. Order matters — this is the
 * left-to-right display order in the chip row.
 */
export const SURFACE_LENSES: Record<SurfaceId, LensDefinition[]> = {
  today: [
    { id: "activities", label: "Activities", href: "/qrm/activities", surface: "today" },
    { id: "campaigns", label: "Campaigns", href: "/qrm/campaigns", surface: "today" },
    { id: "time-bank", label: "Time Bank", href: "/qrm/time-bank", surface: "today" },
    { id: "approvals", label: "Approvals", href: "/qrm/command/approvals", surface: "today" },
    { id: "blockers", label: "Blockers", href: "/qrm/command/blockers", surface: "today" },
    { id: "replace", label: "Replace", href: "/qrm/replacement-prediction", surface: "today" },
    { id: "rescue", label: "Rescue", href: "/qrm/revenue-rescue", surface: "today" },
    { id: "seasonal", label: "Seasonal", href: "/qrm/seasonal-opportunity-map", surface: "today" },
    { id: "post-sale", label: "Post-Sale", href: "/qrm/post-sale-experience", surface: "today" },
  ],
  graph: [
    { id: "deals", label: "Deals", href: "/qrm/deals", surface: "graph" },
    { id: "contacts", label: "Contacts", href: "/qrm/contacts", surface: "graph" },
    { id: "companies", label: "Companies", href: "/qrm/companies", surface: "graph" },
    { id: "inventory", label: "Inventory", href: "/qrm/inventory-pressure", surface: "graph" },
    { id: "rentals", label: "Rentals", href: "/qrm/rentals", surface: "graph" },
    { id: "operators", label: "Operators", href: "/qrm/operator-intelligence", surface: "graph" },
    { id: "map", label: "Map", href: "/qrm/opportunity-map", surface: "graph" },
  ],
  pulse: [
    { id: "exceptions", label: "Exceptions", href: "/qrm/exceptions", surface: "pulse" },
    { id: "motion", label: "Motion", href: "/qrm/iron-in-motion", surface: "pulse" },
    { id: "svc-sales", label: "Svc\u2192Sales", href: "/qrm/service-to-sales", surface: "pulse" },
    { id: "parts-intel", label: "Parts Intel", href: "/qrm/parts-intelligence", surface: "pulse" },
    { id: "threat", label: "Threat", href: "/qrm/competitive-threat-map", surface: "pulse" },
    { id: "compete", label: "Compete", href: "/qrm/competitive-displacement", surface: "pulse" },
    { id: "learning", label: "Learning", href: "/qrm/learning-layer", surface: "pulse" },
    { id: "audit", label: "Audit", href: "/qrm/workflow-audit", surface: "pulse" },
  ],
  ask: [],
};
