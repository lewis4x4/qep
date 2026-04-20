/**
 * Pure helpers for SignalCard presentation. Kept free of supabase / react
 * imports so Bun's test runner can exercise them without spinning up the
 * whole web app (mirrors the moveCardHelpers pattern from Slice 2).
 */

import type {
  QrmSignal,
  QrmSignalKind,
  QrmSignalSeverity,
} from "../lib/signals-types";

/**
 * Human label for each signal kind. Shown as the top-left tag on a card.
 * Kept terse — the title supplies the specifics.
 */
export function labelForSignalKind(kind: QrmSignalKind): string {
  switch (kind) {
    case "stage_change": return "Stage change";
    case "sla_breach": return "SLA breach";
    case "sla_warning": return "SLA warning";
    case "quote_viewed": return "Quote viewed";
    case "quote_expiring": return "Quote expiring";
    case "deposit_received": return "Deposit received";
    case "credit_approved": return "Credit approved";
    case "credit_declined": return "Credit declined";
    case "inbound_email": return "Inbound email";
    case "inbound_call": return "Inbound call";
    case "inbound_sms": return "Inbound SMS";
    case "telematics_idle": return "Machine idle";
    case "telematics_fault": return "Fault code";
    case "permit_filed": return "Permit filed";
    case "auction_listing": return "Auction listing";
    case "competitor_mention": return "Competitor mention";
    case "news_mention": return "News mention";
    case "equipment_available": return "Equipment ready";
    case "equipment_returning": return "Returning soon";
    case "service_due": return "Service due";
    case "warranty_expiring": return "Warranty expiring";
    case "other": return "Signal";
  }
}

/**
 * Tailwind class pair for the severity dot. Keep this deterministic so it
 * can be snapshot-tested if Pulse gains a header-tray overview.
 */
export function severityDotClass(severity: QrmSignalSeverity): string {
  switch (severity) {
    case "critical": return "bg-red-500";
    case "high": return "bg-orange-500";
    case "medium": return "bg-amber-400";
    case "low": return "bg-slate-400";
  }
}

export function severityTextClass(severity: QrmSignalSeverity): string {
  switch (severity) {
    case "critical": return "text-red-700 dark:text-red-300";
    case "high": return "text-orange-700 dark:text-orange-300";
    case "medium": return "text-amber-700 dark:text-amber-300";
    case "low": return "text-slate-600 dark:text-slate-400";
  }
}

/**
 * Deep link into the Graph surface for the entity the signal points at.
 * Mirrors hrefForMoveEntity so the Pulse→Graph handoff stays consistent.
 * Returns null when the signal isn't tied to a routable entity.
 */
export function hrefForSignalEntity(signal: QrmSignal): string | null {
  if (!signal.entity_type || !signal.entity_id) return null;
  switch (signal.entity_type) {
    case "deal": return `/qrm/deals/${signal.entity_id}`;
    case "contact": return `/qrm/contacts/${signal.entity_id}`;
    case "company": return `/qrm/companies/${signal.entity_id}`;
    case "equipment":
      return `/qrm/inventory-pressure?equipment=${signal.entity_id}`;
    case "rental":
      return `/qrm/rentals?request=${signal.entity_id}`;
    case "activity": return `/qrm/activities/${signal.entity_id}`;
    case "workspace":
    default:
      return null;
  }
}

/**
 * Short, fuzzy "how long ago" label. Deterministic given a fixed `nowMs`
 * so the test suite can pin time without mocking Date.
 */
export function relativeTimeLabel(occurredAt: string, nowMs: number): string {
  const thenMs = new Date(occurredAt).getTime();
  if (Number.isNaN(thenMs)) return "";
  const diffSec = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  if (diffSec < 60) return "just now";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const wks = Math.floor(days / 7);
  return `${wks}w ago`;
}
