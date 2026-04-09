/**
 * Blocker Board — type definitions and grouping logic.
 *
 * Merges blocked deals from 3 sources (deposit gate, margin flag, anomaly)
 * into grouped sections for the Blocker Board page.
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export type BlockerCategory = "deposit_missing" | "margin_flagged" | "anomaly_critical";

export interface BlockedDeal {
  id: string;
  dealId: string;
  dealName: string;
  companyName: string;
  contactName: string;
  amount: number;
  stageName: string;
  stageOrder: number;
  category: BlockerCategory;
  /** Human-readable blocker detail. */
  detail: string;
  daysBlocked: number;
  expectedClose: string | null;
  /** For deposit blocks — the deposit row ID for the verify mutation. */
  depositId?: string;
  /** For anomaly blocks — the anomaly row ID for the acknowledge mutation. */
  anomalyId?: string;
  anomalyTitle?: string;
}

export interface BlockerGroup {
  category: BlockerCategory;
  label: string;
  icon: string;
  deals: BlockedDeal[];
  totalValue: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

const GROUP_CONFIG: Record<BlockerCategory, { label: string; icon: string; order: number }> = {
  deposit_missing: { label: "Deposit Missing", icon: "wallet", order: 0 },
  margin_flagged: { label: "Margin Flagged", icon: "scale", order: 1 },
  anomaly_critical: { label: "Critical Anomaly", icon: "alert", order: 2 },
};

// ─── Input row types ───────────────────────────────────────────────────────

export interface BlockerDealRow {
  id: string;
  name: string;
  amount: number | null;
  stage_id: string;
  deposit_status: string | null;
  margin_check_status: string | null;
  margin_pct: number | null;
  expected_close_on: string | null;
  last_activity_at: string | null;
  crm_deal_stages: { name: string; sort_order: number } | { name: string; sort_order: number }[] | null;
  crm_contacts: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null;
  crm_companies: { name: string } | { name: string }[] | null;
}

export interface BlockerDepositRow {
  id: string;
  deal_id: string | null;
  amount: number | null;
  status: string | null;
  tier: string | null;
  required_amount: number | null;
}

export interface BlockerAnomalyRow {
  id: string;
  entity_id: string | null;
  alert_type: string | null;
  severity: string | null;
  title: string | null;
  description: string | null;
  acknowledged: boolean | null;
  created_at: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function unwrapJoin<T>(val: T | T[] | null): T | null {
  if (!val) return null;
  if (Array.isArray(val)) return val[0] ?? null;
  return val;
}

function contactDisplay(c: { first_name: string | null; last_name: string | null } | null): string {
  if (!c) return "—";
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "—";
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${Math.round(amount)}`;
}

function tierLabel(tier: string | null): string {
  if (!tier) return "";
  return tier.replace("_", " ").replace(/\btier\b/i, "Tier");
}

// ─── Grouper ───────────────────────────────────────────────────────────────

export function groupBlockedDeals(
  deals: BlockerDealRow[] | null,
  deposits: BlockerDepositRow[] | null,
  anomalies: BlockerAnomalyRow[] | null,
  nowTime: number = Date.now(),
): { groups: BlockerGroup[]; totalBlocked: number; totalRevenue: number } {
  const depositsByDeal = new Map<string, BlockerDepositRow>();
  for (const dep of deposits ?? []) {
    if (dep.deal_id) depositsByDeal.set(dep.deal_id, dep);
  }

  const anomalyByDeal = new Map<string, BlockerAnomalyRow>();
  for (const anom of anomalies ?? []) {
    if (anom.entity_id) anomalyByDeal.set(anom.entity_id, anom);
  }

  const grouped = new Map<BlockerCategory, BlockedDeal[]>();
  for (const cat of ["deposit_missing", "margin_flagged", "anomaly_critical"] as BlockerCategory[]) {
    grouped.set(cat, []);
  }

  // Process deals with deposit or margin blockers
  for (const deal of deals ?? []) {
    const stage = unwrapJoin(deal.crm_deal_stages);
    const contact = unwrapJoin(deal.crm_contacts);
    const company = unwrapJoin(deal.crm_companies);
    const amt = deal.amount ?? 0;
    const lastActivity = deal.last_activity_at ? Date.parse(deal.last_activity_at) : null;
    const daysBlocked = lastActivity && Number.isFinite(lastActivity)
      ? Math.max(0, Math.floor((nowTime - lastActivity) / DAY_MS))
      : 0;

    const base = {
      dealId: deal.id,
      dealName: deal.name ?? "Untitled deal",
      companyName: company?.name ?? "—",
      contactName: contactDisplay(contact),
      amount: amt,
      stageName: stage?.name ?? "Unknown",
      stageOrder: stage?.sort_order ?? 0,
      daysBlocked,
      expectedClose: deal.expected_close_on,
    };

    // Deposit blocker
    if (deal.deposit_status === "pending") {
      const dep = depositsByDeal.get(deal.id);
      const depAmount = dep?.required_amount ?? dep?.amount ?? 0;
      grouped.get("deposit_missing")!.push({
        ...base,
        id: `deposit-${deal.id}`,
        category: "deposit_missing",
        detail: `${tierLabel(dep?.tier ?? null)}${dep?.tier ? " · " : ""}${formatCurrency(depAmount)} pending`,
        depositId: dep?.id,
      });
    }

    // Margin blocker
    if (deal.margin_check_status === "flagged") {
      const pct = deal.margin_pct !== null ? deal.margin_pct.toFixed(1) : "?";
      grouped.get("margin_flagged")!.push({
        ...base,
        id: `margin-${deal.id}`,
        category: "margin_flagged",
        detail: `Margin ${pct}% (below 10% threshold)`,
      });
    }
  }

  // Process anomaly blockers (may include deals not in the deals query)
  for (const anom of anomalies ?? []) {
    if (!anom.entity_id || anom.acknowledged) continue;
    // Check if this deal is already in one of the other groups
    const alertLabel = (anom.alert_type ?? "unknown").replace(/_/g, " ");
    grouped.get("anomaly_critical")!.push({
      id: `anomaly-${anom.id}`,
      dealId: anom.entity_id,
      dealName: anom.title ?? "Deal with critical anomaly",
      companyName: "—",
      contactName: "—",
      amount: 0,
      stageName: "—",
      stageOrder: 0,
      category: "anomaly_critical",
      detail: alertLabel.charAt(0).toUpperCase() + alertLabel.slice(1),
      daysBlocked: Math.max(0, Math.floor((nowTime - Date.parse(anom.created_at)) / DAY_MS)),
      expectedClose: null,
      anomalyId: anom.id,
      anomalyTitle: anom.title ?? undefined,
    });
  }

  // Build groups in canonical order, compute totals
  const groups: BlockerGroup[] = [];
  let totalBlocked = 0;
  let totalRevenue = 0;

  for (const cat of ["deposit_missing", "margin_flagged", "anomaly_critical"] as BlockerCategory[]) {
    const deals = grouped.get(cat) ?? [];
    if (deals.length === 0) continue;
    deals.sort((a, b) => b.amount - a.amount); // Highest value first
    const groupValue = deals.reduce((sum, d) => sum + d.amount, 0);
    totalBlocked += deals.length;
    totalRevenue += groupValue;
    groups.push({
      category: cat,
      label: GROUP_CONFIG[cat].label,
      icon: GROUP_CONFIG[cat].icon,
      deals,
      totalValue: groupValue,
    });
  }

  return { groups, totalBlocked, totalRevenue };
}
