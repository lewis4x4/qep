/**
 * Quote Velocity Center — pure metric computation.
 *
 * No IO, no DB, no React. Takes raw quote_packages + quote_signatures rows
 * and produces velocity metrics + a sorted, enriched row list for the table.
 */

// ─── Constants ─────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const AGING_THRESHOLD_DAYS = 14;
const EXPIRING_SOON_DAYS = 14;
const CONVERSION_WINDOW_DAYS = 90;

// ─── Input types (match Supabase select projections) ───────────────────────

export interface QuotePackageRow {
  id: string;
  deal_id: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  expires_at: string | null;
  net_total: number | null;
  margin_pct: number | null;
  entry_mode: string | null;
  requires_requote: boolean | null;
  crm_deals: { name: string } | null;
  crm_contacts: { first_name: string | null; last_name: string | null } | null;
}

export interface SignatureRow {
  id: string;
  quote_package_id: string;
  signed_at: string;
}

// ─── Output types ──────────────────────────────────────────────────────────

export interface StatusBucket {
  status: string;
  count: number;
  value: number;
}

export interface QuoteVelocityMetrics {
  activeCount: number;
  totalExposure: number;
  avgDaysInDraft: number;
  agingCount: number;
  expiringSoonCount: number;
  /** Signed / sent in trailing 90 days (0–1). */
  conversionRate: number;
  statusDistribution: StatusBucket[];
}

export interface QuoteVelocityRow {
  id: string;
  dealId: string | null;
  dealName: string;
  contactName: string;
  status: string;
  effectiveStatus: string;
  netTotal: number;
  marginPct: number | null;
  ageDays: number;
  daysUntilExpiry: number | null;
  isSigned: boolean;
  isAging: boolean;
  isExpiringSoon: boolean;
  requiresRequote: boolean;
  entryMode: string | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function parseTime(v: string | null): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function contactDisplayName(c: { first_name: string | null; last_name: string | null } | null): string {
  if (!c) return "—";
  const parts = [c.first_name, c.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "—";
}

/**
 * Derive the effective status for display and bucketing.
 *
 * Raw status is just 'draft' | 'sent' | etc. We enrich with:
 * - 'signed' if a matching signature exists
 * - 'expired' if expires_at < now
 * - 'expiring' if expires_at within 14 days
 */
function deriveEffectiveStatus(
  rawStatus: string | null,
  expiresAt: string | null,
  isSigned: boolean,
  nowTime: number,
): string {
  if (isSigned) return "signed";
  const expTime = parseTime(expiresAt);
  if (expTime !== null && expTime < nowTime) return "expired";
  if (expTime !== null && (expTime - nowTime) <= EXPIRING_SOON_DAYS * DAY_MS) return "expiring";
  return rawStatus ?? "draft";
}

// ─── Main computation ──────────────────────────────────────────────────────

export function computeQuoteVelocity(
  packages: QuotePackageRow[],
  signatures: SignatureRow[],
  nowTime: number,
): { metrics: QuoteVelocityMetrics; rows: QuoteVelocityRow[] } {
  // Build signature lookup
  const signedSet = new Set(signatures.map((s) => s.quote_package_id));
  const signedAtMap = new Map(signatures.map((s) => [s.quote_package_id, parseTime(s.signed_at)]));

  // Accumulators
  let activeCount = 0;
  let totalExposure = 0;
  let agingCount = 0;
  let expiringSoonCount = 0;
  const draftToSentDays: number[] = [];
  const bucketMap = new Map<string, { count: number; value: number }>();

  // 90-day conversion tracking
  const ninetyDaysAgo = nowTime - CONVERSION_WINDOW_DAYS * DAY_MS;
  let sentIn90d = 0;
  let signedIn90d = 0;

  const rows: QuoteVelocityRow[] = [];

  for (const pkg of packages) {
    const isSigned = signedSet.has(pkg.id);
    const netTotal = pkg.net_total ?? 0;
    const createdTime = parseTime(pkg.created_at) ?? nowTime;
    const sentTime = parseTime(pkg.sent_at);
    const ageDays = Math.max(0, Math.floor((nowTime - createdTime) / DAY_MS));
    const expiresTime = parseTime(pkg.expires_at);
    const daysUntilExpiry = expiresTime !== null ? Math.floor((expiresTime - nowTime) / DAY_MS) : null;

    const effectiveStatus = deriveEffectiveStatus(pkg.status, pkg.expires_at, isSigned, nowTime);

    // Active = draft or sent (not expired, not signed)
    const isActive = effectiveStatus === "draft" || effectiveStatus === "sent" || effectiveStatus === "expiring";
    if (isActive) {
      activeCount++;
      totalExposure += netTotal;
    }

    // Aging: sent >14 days, not signed
    const isAging = effectiveStatus === "sent" && sentTime !== null && (nowTime - sentTime) > AGING_THRESHOLD_DAYS * DAY_MS;
    if (isAging) agingCount++;

    // Expiring soon
    const isExpiringSoon = effectiveStatus === "expiring";
    if (isExpiringSoon) expiringSoonCount++;

    // Draft-to-sent velocity
    if (sentTime !== null && createdTime) {
      const days = (sentTime - createdTime) / DAY_MS;
      if (days >= 0) draftToSentDays.push(days);
    }

    // 90-day conversion
    if (sentTime !== null && sentTime >= ninetyDaysAgo) {
      sentIn90d++;
      const sigTime = signedAtMap.get(pkg.id);
      if (sigTime !== null && sigTime !== undefined && sigTime >= ninetyDaysAgo) {
        signedIn90d++;
      }
    }

    // Status distribution
    const bucket = bucketMap.get(effectiveStatus) ?? { count: 0, value: 0 };
    bucket.count++;
    bucket.value += netTotal;
    bucketMap.set(effectiveStatus, bucket);

    // Row
    rows.push({
      id: pkg.id,
      dealId: pkg.deal_id,
      dealName: pkg.crm_deals?.name ?? "Untitled deal",
      contactName: contactDisplayName(pkg.crm_contacts),
      status: pkg.status ?? "draft",
      effectiveStatus,
      netTotal,
      marginPct: pkg.margin_pct,
      ageDays,
      daysUntilExpiry,
      isSigned,
      isAging,
      isExpiringSoon,
      requiresRequote: pkg.requires_requote ?? false,
      entryMode: pkg.entry_mode,
    });
  }

  // Sort rows: aging first, then expiring, then by age descending
  rows.sort((a, b) => {
    if (a.isAging && !b.isAging) return -1;
    if (!a.isAging && b.isAging) return 1;
    if (a.isExpiringSoon && !b.isExpiringSoon) return -1;
    if (!a.isExpiringSoon && b.isExpiringSoon) return 1;
    return b.ageDays - a.ageDays;
  });

  // Build status distribution in canonical order
  const STATUS_ORDER = ["draft", "sent", "expiring", "signed", "expired"];
  const statusDistribution: StatusBucket[] = STATUS_ORDER
    .filter((s) => bucketMap.has(s))
    .map((s) => ({ status: s, ...bucketMap.get(s)! }));

  // Avg days in draft
  const avgDaysInDraft = draftToSentDays.length > 0
    ? Math.round((draftToSentDays.reduce((a, b) => a + b, 0) / draftToSentDays.length) * 10) / 10
    : 0;

  // Conversion rate
  const conversionRate = sentIn90d > 0 ? Math.round((signedIn90d / sentIn90d) * 100) / 100 : 0;

  return {
    metrics: {
      activeCount,
      totalExposure: Math.round(totalExposure * 100) / 100,
      avgDaysInDraft,
      agingCount,
      expiringSoonCount,
      conversionRate,
      statusDistribution,
    },
    rows,
  };
}
