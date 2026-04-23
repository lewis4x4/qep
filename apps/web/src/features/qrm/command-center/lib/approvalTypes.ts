/**
 * Approval Center — type definitions and normalization.
 *
 * Merges 4 different approval sources (margin flags, deposits, trades, demos)
 * into a single sorted list the Approval Center page can render uniformly.
 */

import type { QuoteApprovalConditionType } from "../../../../../../../shared/qep-moonshot-contracts";

// ─── Types ─────────────────────────────────────────────────────────────────

export type ApprovalType = "margin" | "deposit" | "trade" | "demo" | "quote";

export interface ApprovalItem {
  id: string;
  type: ApprovalType;
  dealId: string | null;
  viewHref: string | null;
  dealName: string;
  contactName: string;
  amount: number;
  /** Human-readable context: "Margin 8.2%" or "Tier 2 · $1,000" etc. */
  detail: string;
  createdAt: string;
  /** High if >48h since the approval was requested. */
  urgency: "normal" | "high";
  /** Raw data needed for the mutation (varies by type). */
  meta: Record<string, unknown>;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const HIGH_URGENCY_MS = 48 * 60 * 60 * 1000; // 48 hours

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${Math.round(amount)}`;
}

function contactName(row: { first_name?: string | null; last_name?: string | null } | null): string {
  if (!row) return "—";
  const parts = [row.first_name, row.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "—";
}

function dealNameFromJoin(joined: { name?: string } | { name?: string }[] | null): string {
  if (!joined) return "Untitled deal";
  if (Array.isArray(joined)) return joined[0]?.name ?? "Untitled deal";
  return joined.name ?? "Untitled deal";
}

function urgency(createdAt: string, nowTime: number): "normal" | "high" {
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return "normal";
  return (nowTime - t) > HIGH_URGENCY_MS ? "high" : "normal";
}

// ─── Input row types (match Supabase select projections) ───────────────────

export interface MarginRow {
  id: string;
  name: string;
  amount: number | null;
  margin_pct: number | null;
  margin_amount: number | null;
  margin_check_status: string | null;
  updated_at: string;
  crm_contacts: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null;
}

export interface DepositRow {
  id: string;
  deal_id: string | null;
  amount: number | null;
  status: string | null;
  tier: string | null;
  created_at: string;
  crm_deals: { name: string; amount?: number | null } | { name: string; amount?: number | null }[] | null;
}

export interface TradeRow {
  id: string;
  deal_id: string | null;
  status: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  preliminary_value: number | null;
  created_at: string;
  crm_deals: { name: string } | { name: string }[] | null;
}

export interface DemoRow {
  id: string;
  deal_id: string | null;
  status: string | null;
  equipment_category: string | null;
  scheduled_date: string | null;
  needs_assessment_complete: boolean | null;
  buying_intent_confirmed: boolean | null;
  created_at: string;
  crm_deals: { name: string } | { name: string }[] | null;
}

export interface QuoteApprovalRow {
  id: string;
  quote_package_id: string;
  quote_package_version_id: string;
  version_number: number;
  deal_id: string | null;
  quote_number: string | null;
  branch_slug: string | null;
  branch_name: string | null;
  submitted_by_name: string | null;
  assigned_to_name: string | null;
  assigned_role: string | null;
  route_mode: "branch_sales_manager" | "branch_general_manager" | "owner_direct" | "admin_direct" | "admin_queue" | "owner_queue" | "manager_queue";
  policy_snapshot_json: Record<string, unknown> | null;
  reason_summary_json: { reasons?: string[] | null } | null;
  decision_note: string | null;
  status: string;
  requested_at: string;
  due_at: string | null;
  escalate_at: string | null;
  customer_name: string | null;
  customer_company: string | null;
  net_total: number | null;
  margin_pct: number | null;
  conditions?: Array<{
    id: string;
    condition_type: QuoteApprovalConditionType;
    condition_payload_json: Record<string, unknown>;
    sort_order: number;
  }> | null;
  evaluations?: Array<{
    id: string;
    conditionType: QuoteApprovalConditionType;
    label: string;
    satisfied: boolean;
    detail: string;
    blocking: boolean;
  }> | null;
}

// ─── Normalizer ────────────────────────────────────────────────────────────

export function normalizeApprovals(
  marginDeals: MarginRow[] | null,
  deposits: DepositRow[] | null,
  trades: TradeRow[] | null,
  demos: DemoRow[] | null,
  quotes: QuoteApprovalRow[] | null,
  nowTime: number = Date.now(),
): ApprovalItem[] {
  const items: ApprovalItem[] = [];

  // Margin flags
  for (const deal of marginDeals ?? []) {
    const contact = Array.isArray(deal.crm_contacts) ? deal.crm_contacts[0] : deal.crm_contacts;
    const pct = deal.margin_pct !== null ? deal.margin_pct.toFixed(1) : "?";
    items.push({
      id: deal.id,
      type: "margin",
      dealId: deal.id,
      viewHref: deal.id ? `/qrm/deals/${deal.id}` : null,
      dealName: deal.name ?? "Untitled deal",
      contactName: contactName(contact),
      amount: deal.amount ?? 0,
      detail: `Margin ${pct}%${deal.margin_amount !== null ? ` · ${formatCurrency(deal.margin_amount)}` : ""}`,
      createdAt: deal.updated_at,
      urgency: urgency(deal.updated_at, nowTime),
      meta: { marginPct: deal.margin_pct },
    });
  }

  // Deposit verifications
  for (const dep of deposits ?? []) {
    const dealData = Array.isArray(dep.crm_deals) ? dep.crm_deals[0] : dep.crm_deals;
    const tierLabel = dep.tier ? dep.tier.replace("_", " ").replace("tier ", "Tier ") : "";
    items.push({
      id: dep.id,
      type: "deposit",
      dealId: dep.deal_id,
      viewHref: dep.deal_id ? `/qrm/deals/${dep.deal_id}` : null,
      dealName: dealNameFromJoin(dep.crm_deals),
      contactName: "—", // deposits don't join contacts directly
      amount: dep.amount ?? 0,
      detail: `${tierLabel}${tierLabel ? " · " : ""}${formatCurrency(dep.amount ?? 0)} required`,
      createdAt: dep.created_at,
      urgency: urgency(dep.created_at, nowTime),
      meta: { depositStatus: dep.status, dealAmount: (dealData as Record<string, unknown>)?.amount },
    });
  }

  // Trade reviews
  for (const trade of trades ?? []) {
    const yearMakeModel = [trade.year, trade.make, trade.model].filter(Boolean).join(" ");
    items.push({
      id: trade.id,
      type: "trade",
      dealId: trade.deal_id,
      viewHref: trade.deal_id ? `/qrm/deals/${trade.deal_id}` : null,
      dealName: dealNameFromJoin(trade.crm_deals),
      contactName: "—",
      amount: trade.preliminary_value ?? 0,
      detail: `${yearMakeModel || "Trade-in"} · ${formatCurrency(trade.preliminary_value ?? 0)} prelim`,
      createdAt: trade.created_at,
      urgency: urgency(trade.created_at, nowTime),
      meta: { preliminaryValue: trade.preliminary_value },
    });
  }

  // Demo requests
  for (const demo of demos ?? []) {
    const catLabel = demo.equipment_category ?? "Equipment";
    items.push({
      id: demo.id,
      type: "demo",
      dealId: demo.deal_id,
      viewHref: demo.deal_id ? `/qrm/deals/${demo.deal_id}` : null,
      dealName: dealNameFromJoin(demo.crm_deals),
      contactName: "—",
      amount: 0,
      detail: `${catLabel} demo${demo.scheduled_date ? ` · ${new Date(demo.scheduled_date).toLocaleDateString()}` : ""}`,
      createdAt: demo.created_at,
      urgency: urgency(demo.created_at, nowTime),
      meta: {
        needsAssessment: demo.needs_assessment_complete,
        buyingIntent: demo.buying_intent_confirmed,
      },
    });
  }

  for (const approval of quotes ?? []) {
    const quotePackageId = approval.quote_package_id ?? null;
    const dealId = approval.deal_id ?? null;
    const customerCompany = approval.customer_company?.trim() ?? "";
    const customerName = approval.customer_name?.trim() ?? "";
    const quoteNumber = approval.quote_number?.trim() ?? "";
    const branchName = approval.branch_name?.trim() ?? "";
    const assignedToName = approval.assigned_to_name?.trim() ?? "";
    const submittedByName = approval.submitted_by_name?.trim() ?? "";
    const marginPct = typeof approval.margin_pct === "number"
      ? approval.margin_pct
      : Number(approval.margin_pct ?? NaN);
    const amount = typeof approval.net_total === "number"
      ? approval.net_total
      : Number(approval.net_total ?? 0);
    const headline = customerCompany || customerName || "Quote approval";
    const detailBits = [
      quoteNumber ? `Quote ${quoteNumber}` : null,
      branchName ? `Branch ${branchName}` : null,
      submittedByName ? `Rep ${submittedByName}` : null,
      assignedToName ? `Assigned to ${assignedToName}` : null,
      approval.version_number ? `v${approval.version_number}` : null,
      Number.isFinite(marginPct) ? `Margin ${marginPct.toFixed(1)}%` : null,
      approval.decision_note,
      ...(Array.isArray(approval.reason_summary_json?.reasons) ? approval.reason_summary_json.reasons.slice(0, 2) : []),
    ].filter(Boolean);

    items.push({
      id: approval.id,
      type: "quote",
      dealId,
      viewHref: quotePackageId ? `/quote-v2?package_id=${encodeURIComponent(quotePackageId)}` : (dealId ? `/qrm/deals/${dealId}` : null),
      dealName: headline,
      contactName: customerCompany && customerName ? customerName : "—",
      amount: Number.isFinite(amount) ? amount : 0,
      detail: detailBits.join(" · ") || "Quote awaiting sales manager approval",
      createdAt: approval.requested_at,
      urgency: urgency(approval.requested_at, nowTime),
      meta: {
        approvalCaseId: approval.id,
        quotePackageId,
        quotePackageVersionId: approval.quote_package_version_id,
        versionNumber: approval.version_number,
        routeMode: approval.route_mode,
        assignedToName,
        status: approval.status,
        conditions: approval.conditions ?? [],
        evaluations: approval.evaluations ?? [],
      },
    });
  }

  // Sort: high urgency first, then by createdAt descending (newest first)
  items.sort((a, b) => {
    if (a.urgency === "high" && b.urgency !== "high") return -1;
    if (a.urgency !== "high" && b.urgency === "high") return 1;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });

  return items;
}
