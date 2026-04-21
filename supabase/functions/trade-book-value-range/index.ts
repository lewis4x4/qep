/**
 * Trade Book-Value Range Edge Function (Slice 20b "Point, Shoot, Trade")
 *
 * Given a make/model/year/hours, returns a multi-source book-value RANGE
 * (low / mid / high) with transparent source breakdown. This is what makes
 * Quote Builder's inline trade widget a moonshot rather than a commodity
 * single-number estimator — the rep sees *why* we think the machine is
 * worth $48k–$56k, not just the number.
 *
 * Source priority (when real data exists):
 *   1. market_valuations — cached valuations from upstream providers
 *      (Iron Solutions / Rouse when wired; otherwise manager-entered).
 *      Provides (low_estimate, high_estimate, confidence_score, source).
 *   2. auction_results   — historical auction hammer prices for the same
 *      make+model+year band. We compute p25 / p50 / p75 over the last
 *      N comps to form a range.
 *   3. competitor_listings — current active dealer listings (asking
 *      prices, not transacted). Treated as the *upper* bound signal since
 *      these are sticker, not sold. Scraped by slurry/competitor-scraper.
 *
 * Fallback (no real data yet — which is the common dev case today):
 *   synthesize three deterministic "sources" so the UX demonstrates the
 *   moonshot shape. Each source is a plausible derivation from a base
 *   value computed from make/model hash × year depreciation × hours wear.
 *   This is deterministic so the demo is reproducible; real scrapers
 *   slot in later without a UI change.
 *
 * The trade-in pricing SOP (auction × 0.92 - reconditioning) still owns
 * the FINAL preliminary_value written to trade_valuations. This function
 * is the *inputs* side — what the auction value plausibly is.
 *
 * Auth: rep/admin/manager/owner.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

// ── Types ────────────────────────────────────────────────────────────────

interface BookValueInput {
  make: string;
  model: string;
  year?: number | null;
  hours?: number | null;
}

type SourceKind =
  | "market_valuation"
  | "auction_comps"
  | "competitor_listings"
  | "synthetic_iron_planet"
  | "synthetic_ritchie_bros"
  | "synthetic_internal_history";

interface BookValueSource {
  kind: SourceKind;
  name: string;          // Human label shown in UI ("Iron Planet comp", "Auction p50 (last 12)")
  value_cents: number;   // The source's point estimate
  low_cents?: number | null;
  high_cents?: number | null;
  confidence: "high" | "medium" | "low";
  sample_size?: number | null;
  as_of?: string | null; // ISO date if derived from dated data
  detail?: string | null;
}

interface BookValueResponse {
  make: string;
  model: string;
  year: number | null;
  hours: number | null;
  low_cents: number;     // Overall range — typically p25 of source values
  mid_cents: number;     // Overall range — median of source values
  high_cents: number;    // Overall range — p75 of source values
  confidence: "high" | "medium" | "low";
  sources: BookValueSource[];
  is_synthetic: boolean; // true when no live data exists, fallback was used
  computed_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Deterministic 32-bit hash of a string; used only for synthesis. */
function strHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Pick the kth percentile of a numeric array (k in [0,1]). */
function percentile(nums: number[], k: number): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(k * (sorted.length - 1))));
  return sorted[idx]!;
}

/**
 * Baseline dollar value for a machine given make/model/year/hours, used
 * only when no real comps exist. Calibrated to the construction-fleet
 * classes QEP sells — skid steers, mini-ex, wheel loaders — so demo
 * numbers aren't absurd. Deterministic via make/model hash.
 */
function syntheticBaseCents(make: string, model: string, year: number | null, hours: number | null): number {
  const key = `${make.toLowerCase()}|${model.toLowerCase()}`;
  const h = strHash(key);
  // $18k..$85k range keyed off the hash — covers the realistic spread
  // across our construction equipment classes.
  const baseRange = 18_000 + (h % 67_001); // 18,000..85,000
  const base = baseRange * 100; // → cents

  // Depreciation: 8%/yr vs current year, clamped 20%..100%.
  const currentYear = new Date().getFullYear();
  const age = year ? Math.max(0, currentYear - year) : 6;
  const depRetention = Math.max(0.20, 1 - age * 0.08);

  // Hours wear: above 4,000 hrs, shave another 0.5%/100hr up to 25% floor.
  const hoursPenalty = hours && hours > 4_000
    ? Math.max(0.75, 1 - ((hours - 4_000) / 100) * 0.005)
    : 1;

  return Math.round(base * depRetention * hoursPenalty);
}

/** Spread a center value into a {low, mid, high} triple with ±pct band. */
function spread(center: number, pct: number): { low: number; mid: number; high: number } {
  return {
    low:  Math.round(center * (1 - pct)),
    mid:  center,
    high: Math.round(center * (1 + pct)),
  };
}

// ── Main handler ─────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("POST only", 405, origin);

  try {
    const authHeader = req.headers.get("Authorization")?.trim();
    if (!authHeader) return safeJsonError("Unauthorized", 401, origin);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return safeJsonError("Unauthorized", 401, origin);

    // Role gate — trade valuations are rep+ operations.
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    const role = (profile as { role?: string } | null)?.role;
    if (!role || !["rep", "admin", "manager", "owner"].includes(role)) {
      return safeJsonError("Insufficient permissions", 403, origin);
    }

    const body = (await req.json().catch(() => ({}))) as BookValueInput;
    if (!body.make || !body.model) {
      return safeJsonError("make and model are required", 400, origin);
    }

    const make  = body.make.trim();
    const model = body.model.trim();
    const year  = body.year  ?? null;
    const hours = body.hours ?? null;

    const sources: BookValueSource[] = [];

    // ── Source 1: market_valuations cache ──────────────────────────────
    {
      let q = supabaseAdmin
        .from("market_valuations")
        .select("estimated_fmv, low_estimate, high_estimate, confidence_score, source, source_detail, expires_at, created_at")
        .ilike("make", make)
        .ilike("model", model)
        .gte("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(3);
      if (year) q = q.eq("year", year);
      const { data: mvs } = await q;
      for (const mv of (mvs ?? []) as Array<Record<string, unknown>>) {
        const fmv = Number(mv.estimated_fmv ?? 0);
        if (!fmv) continue;
        const low  = Number(mv.low_estimate  ?? fmv * 0.9);
        const high = Number(mv.high_estimate ?? fmv * 1.1);
        const conf = Number(mv.confidence_score ?? 0.5);
        sources.push({
          kind: "market_valuation",
          name: `${String(mv.source ?? "Valuation cache")} (cached)`,
          value_cents: Math.round(fmv * 100),
          low_cents:   Math.round(low * 100),
          high_cents:  Math.round(high * 100),
          confidence: conf >= 0.75 ? "high" : conf >= 0.5 ? "medium" : "low",
          as_of: (mv.created_at as string) ?? null,
          detail: "Provider-reported FMV with low/high band.",
        });
      }
    }

    // ── Source 2: auction_results p25/p50/p75 over recent comps ────────
    {
      let q = supabaseAdmin
        .from("auction_results")
        .select("hammer_price, source, auction_date, year, hours")
        .ilike("make", make)
        .ilike("model", model)
        .order("auction_date", { ascending: false })
        .limit(20);
      // Year band ±2 keeps the comp set reasonable without being empty.
      if (year) q = q.gte("year", year - 2).lte("year", year + 2);
      const { data: auctions } = await q;
      const rows = (auctions ?? []) as Array<Record<string, unknown>>;
      if (rows.length > 0) {
        const prices = rows.map((r) => Number(r.hammer_price ?? 0)).filter((p) => p > 0);
        if (prices.length > 0) {
          const p25 = percentile(prices, 0.25);
          const p50 = percentile(prices, 0.50);
          const p75 = percentile(prices, 0.75);
          sources.push({
            kind: "auction_comps",
            name: `Auction p50 (last ${prices.length})`,
            value_cents: Math.round(p50 * 100),
            low_cents:   Math.round(p25 * 100),
            high_cents:  Math.round(p75 * 100),
            confidence: prices.length >= 5 ? "high" : prices.length >= 3 ? "medium" : "low",
            sample_size: prices.length,
            as_of: (rows[0]!.auction_date as string) ?? null,
            detail: `p25–p75 over the last ${prices.length} hammered lots.`,
          });
        }
      }
    }

    // ── Source 3: active competitor_listings average ───────────────────
    // Schema (migration 013): source, source_url, asking_price, year, hours,
    // first_seen_at, last_seen_at, is_active. No dealer_name/scraped_at —
    // an earlier revision of this file used the wrong column names and
    // silently fell through to synthetic on every call.
    {
      let q = supabaseAdmin
        .from("competitor_listings")
        .select("asking_price, source, last_seen_at, year")
        .ilike("make", make)
        .ilike("model", model)
        .eq("is_active", true)
        .order("last_seen_at", { ascending: false })
        .limit(10);
      if (year) q = q.gte("year", year - 2).lte("year", year + 2);
      const { data: listings } = await q;
      const rows = (listings ?? []) as Array<Record<string, unknown>>;
      if (rows.length > 0) {
        const prices = rows.map((r) => Number(r.asking_price ?? 0)).filter((p) => p > 0);
        if (prices.length > 0) {
          const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
          const min = Math.min(...prices);
          const max = Math.max(...prices);
          sources.push({
            kind: "competitor_listings",
            name: `Active listings (${prices.length} dealers)`,
            value_cents: Math.round(mean * 100),
            low_cents:   Math.round(min  * 100),
            high_cents:  Math.round(max  * 100),
            confidence: prices.length >= 4 ? "medium" : "low",
            sample_size: prices.length,
            as_of: (rows[0]!.last_seen_at as string) ?? null,
            // Asking price ≠ transacted — treat as upper-bound signal.
            detail: "Asking prices (not transacted). Upper-bound signal.",
          });
        }
      }
    }

    // ── Fallback: synthesize three sources when no live data ───────────
    const isSynthetic = sources.length === 0;
    if (isSynthetic) {
      const base = syntheticBaseCents(make, model, year, hours);
      // Three plausible, distinct sources the real integrations will later
      // replace. Each has a different bias so the range is meaningful.
      const ip = spread(Math.round(base * 0.96), 0.06); // Iron Planet skew slightly low
      const rb = spread(Math.round(base * 1.00), 0.05); // Ritchie Bros center-line
      const ih = spread(Math.round(base * 1.03), 0.07); // Internal fleet skew slightly high

      sources.push(
        {
          kind: "synthetic_iron_planet",
          name: "Iron Planet est. (modeled)",
          value_cents: ip.mid, low_cents: ip.low, high_cents: ip.high,
          confidence: "medium",
          detail: "Modeled from make/year/hours curve. Live Iron Planet feed pending integration.",
        },
        {
          kind: "synthetic_ritchie_bros",
          name: "Ritchie Bros est. (modeled)",
          value_cents: rb.mid, low_cents: rb.low, high_cents: rb.high,
          confidence: "medium",
          detail: "Modeled auction-channel midpoint. Live feed pending integration.",
        },
        {
          kind: "synthetic_internal_history",
          name: "Internal fleet history (modeled)",
          value_cents: ih.mid, low_cents: ih.low, high_cents: ih.high,
          confidence: "low",
          detail: "Modeled from make/model hash + fleet age curve. Replaced by real QEP auction history when available.",
        },
      );
    }

    // ── Aggregate the overall range ────────────────────────────────────
    const points = sources.map((s) => s.value_cents);
    const lows   = sources.map((s) => s.low_cents  ?? s.value_cents);
    const highs  = sources.map((s) => s.high_cents ?? s.value_cents);

    const mid = Math.round(percentile(points, 0.5));
    const low = Math.round(Math.min(percentile(lows,  0.25), mid * 0.92));
    const high = Math.round(Math.max(percentile(highs, 0.75), mid * 1.08));

    // Overall confidence = best source confidence, downgraded if all synthetic.
    const rank = { high: 3, medium: 2, low: 1 } as const;
    const bestConf = sources.reduce(
      (acc, s) => (rank[s.confidence] > rank[acc] ? s.confidence : acc),
      "low" as "high" | "medium" | "low",
    );
    const confidence: "high" | "medium" | "low" = isSynthetic
      ? (bestConf === "high" ? "medium" : "low")
      : bestConf;

    const response: BookValueResponse = {
      make, model, year, hours,
      low_cents: low,
      mid_cents: mid,
      high_cents: high,
      confidence,
      sources,
      is_synthetic: isSynthetic,
      computed_at: new Date().toISOString(),
    };

    return safeJsonOk(response, origin);
  } catch (err) {
    captureEdgeException(err);
    console.error("trade-book-value-range error:", err);
    return safeJsonError("Book-value lookup failed", 500, origin);
  }
});
