/**
 * QEP Price Sheet Reminders — Quarterly cadence checker (Slice 04)
 *
 * getPendingUpdates() checks each brand's last-published price sheet against
 * the expected update cadence and returns a list of overdue/upcoming updates.
 *
 * Used by the dashboard widget ("Price sheets to check") and by the admin
 * price-sheets list page header.
 *
 * Cadence rules (confirmed from master index + Rylee quote):
 *   - ASV programs:     quarterly (Jan/Apr/Jul/Oct 1)
 *   - ASV price book:   annual    (Jan 1)
 *   - Yanmar programs:  quarterly
 *   - Develon programs: quarterly
 *   - Other brands:     flag if last publish > 6 months ago
 *
 * Pure / testable: DB I/O injected via SupabaseLike. Date injected so tests
 * can control "today" without time travel hacks.
 */

interface SupabaseLike {
  from: (table: string) => any;
}

export type UpdateUrgency = "overdue" | "due" | "upcoming" | "current";

export interface PendingUpdate {
  brandCode: string;
  brandName: string;
  sheetType: "price_book" | "retail_programs";
  /** ISO date string of the last published sheet for this brand+type, or null */
  lastPublishedAt: string | null;
  /** The quarter/year description: "Q2 2026", "Annual 2026", etc. */
  expectedPeriod: string;
  urgency: UpdateUrgency;
  /** Human-readable prompt shown in the dashboard widget */
  message: string;
}

// ── Internal cadence definition ───────────────────────────────────────────────

interface BrandCadence {
  brandCode: string;
  sheetType: "price_book" | "retail_programs";
  /** "quarterly" | "annual" | "6mo" */
  cadence: "quarterly" | "annual" | "6mo";
}

const CADENCE_RULES: BrandCadence[] = [
  { brandCode: "ASV",     sheetType: "retail_programs", cadence: "quarterly" },
  { brandCode: "ASV",     sheetType: "price_book",      cadence: "annual"    },
  { brandCode: "YANMAR",  sheetType: "retail_programs", cadence: "quarterly" },
  { brandCode: "DEVELON", sheetType: "retail_programs", cadence: "quarterly" },
];

// ── Quarter helpers ───────────────────────────────────────────────────────────

/** Returns the most recent quarter-start date at or before `date`. */
export function currentQuarterStart(date: Date): Date {
  const month = date.getUTCMonth(); // 0-based
  const quarterStartMonth = Math.floor(month / 3) * 3;
  return new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth, 1));
}

/** Returns the quarter label for a quarter-start date: "Q1 2026", "Q2 2026", etc. */
export function quarterLabel(quarterStart: Date): string {
  const q = Math.floor(quarterStart.getUTCMonth() / 3) + 1;
  return `Q${q} ${quarterStart.getUTCFullYear()}`;
}

/** Returns the annual label: "Annual 2026". */
export function annualLabel(date: Date): string {
  return `Annual ${date.getUTCFullYear()}`;
}

/**
 * Returns urgency for a cadence rule given the last-publish date.
 *   overdue  — expected period already started with no upload
 *   due      — expected period starts today (within 0–7 days)
 *   upcoming — expected period starts within 30 days
 *   current  — last upload covers the current expected period
 */
export function computeUrgency(
  cadence: "quarterly" | "annual" | "6mo",
  lastPublishedAt: Date | null,
  today: Date,
): UpdateUrgency {
  if (cadence === "quarterly") {
    const qStart = currentQuarterStart(today);
    if (!lastPublishedAt || lastPublishedAt < qStart) return "overdue";
    return "current";
  }

  if (cadence === "annual") {
    const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    if (!lastPublishedAt || lastPublishedAt < yearStart) return "overdue";
    return "current";
  }

  // 6mo: flag if last publish > 180 days ago
  if (!lastPublishedAt) return "overdue";
  const daysSince = (today.getTime() - lastPublishedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince > 180) return "overdue";
  if (daysSince > 150) return "upcoming";
  return "current";
}

function buildMessage(
  brandName: string,
  sheetType: "price_book" | "retail_programs",
  urgency: UpdateUrgency,
  expectedPeriod: string,
  lastPublishedAt: string | null,
): string {
  const typeLabel = sheetType === "price_book" ? "price book" : "programs";
  if (!lastPublishedAt) {
    return `${brandName} ${typeLabel} — never uploaded. Upload the ${expectedPeriod} ${typeLabel} when available.`;
  }
  if (urgency === "overdue") {
    return `${brandName} ${typeLabel} — ${expectedPeriod} expected, not uploaded yet.`;
  }
  if (urgency === "upcoming") {
    return `${brandName} ${typeLabel} — update coming up soon. Watch for the ${expectedPeriod} release.`;
  }
  return `${brandName} ${typeLabel} — up to date for ${expectedPeriod}.`;
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Returns pending/overdue price sheet updates based on brand cadence rules.
 *
 * Only returns items with urgency "overdue" or "upcoming" — "current" items
 * are filtered out since they need no action.
 */
export async function getPendingUpdates(
  supabase: SupabaseLike,
  today: Date = new Date(),
): Promise<PendingUpdate[]> {
  // Fetch all brands in one query to get brand names
  const { data: brands, error: brandErr } = await supabase
    .from("qb_brands")
    .select("id, code, name")
    .in("code", CADENCE_RULES.map((r) => r.brandCode));

  if (brandErr || !brands?.length) return [];

  const brandMap = new Map<string, { id: string; name: string }>(
    (brands as Array<{ id: string; code: string; name: string }>).map((b) => [b.code, { id: b.id, name: b.name }]),
  );

  // Fetch the most recent published sheet per brand per sheet_type
  const { data: sheets } = await supabase
    .from("qb_price_sheets")
    .select("brand_id, sheet_type, published_at")
    .eq("status", "published")
    .order("published_at", { ascending: false });

  // Build lookup: brandId+sheetType → most recent published_at
  type LastPublishedKey = string; // `${brandId}:${sheetType}`
  const lastPublished = new Map<LastPublishedKey, Date>();
  for (const sheet of (sheets ?? []) as Array<{ brand_id: string; sheet_type: string; published_at: string }>) {
    const key = `${sheet.brand_id}:${sheet.sheet_type}`;
    if (!lastPublished.has(key) && sheet.published_at) {
      lastPublished.set(key, new Date(sheet.published_at));
    }
  }

  const results: PendingUpdate[] = [];

  for (const rule of CADENCE_RULES) {
    const brand = brandMap.get(rule.brandCode);
    if (!brand) continue;

    const key = `${brand.id}:${rule.sheetType}`;
    const lastPub = lastPublished.get(key) ?? null;

    const urgency = computeUrgency(rule.cadence, lastPub, today);
    if (urgency === "current") continue; // no action needed

    const expectedPeriod =
      rule.cadence === "annual"
        ? annualLabel(today)
        : rule.cadence === "quarterly"
        ? quarterLabel(currentQuarterStart(today))
        : "recent";

    results.push({
      brandCode: rule.brandCode,
      brandName: brand.name,
      sheetType: rule.sheetType,
      lastPublishedAt: lastPub?.toISOString() ?? null,
      expectedPeriod,
      urgency,
      message: buildMessage(brand.name, rule.sheetType, urgency, expectedPeriod, lastPub?.toISOString() ?? null),
    });
  }

  return results;
}
