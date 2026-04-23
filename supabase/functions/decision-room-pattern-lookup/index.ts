/**
 * decision-room-pattern-lookup
 *
 * MVP cross-deal pattern memory for the Decision Room.
 *
 * Given a current deal, find workspace-scoped closed-lost deals with the
 * same equipment class and size band, then summarize their loss reasons.
 * Returns a single `narrative` line the banner renders under Coach's
 * Read when >= 2 similar losses exist.
 *
 * Why `loss_reason IS NOT NULL` instead of `is_closed_lost`: the demo
 * workspace's stages have is_closed_lost flagged false even for a deal
 * named "Closed Lost". `loss_reason` is a stronger proxy — any deal
 * with a reason attached is, by definition, a lost deal we can learn
 * from. Works for any workspace that fills in loss reasons.
 *
 * Gateway verify_jwt = false; the function does its own access check.
 */
import { createCallerClient, createAdminClient, resolveCallerContext } from "../_shared/dge-auth.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Size band thresholds in dollars. Coarse on purpose — the question
 *  the rep is asking is "other deals shaped like this," not "other deals
 *  within $1K of this amount." Bands let the matcher tolerate a bit of
 *  amount drift between quotes without losing a match. */
const SIZE_BAND_BOUNDARIES = [
  { name: "small", max: 75_000 },
  { name: "mid", max: 300_000 },
  { name: "large", max: Infinity },
] as const;

function sizeBandFor(amount: number | null): string {
  if (amount == null || Number.isNaN(amount)) return "unknown";
  for (const band of SIZE_BAND_BOUNDARIES) {
    if (amount < band.max) return band.name;
  }
  return "large";
}

/** Equipment classes we recognize. If none match, the deal is treated as
 *  "other" — it can still match other "other" deals on size band alone. */
const EQUIPMENT_CLASSES = [
  { key: "mulcher", keywords: ["mulcher"] },
  { key: "excavator", keywords: ["excavator"] },
  { key: "skid_steer", keywords: ["skid steer", "skid-steer", "skidsteer"] },
  { key: "bulldozer", keywords: ["bulldozer", "dozer"] },
  { key: "loader", keywords: ["wheel loader", "front loader"] },
  { key: "grinder", keywords: ["grinder", "chipper"] },
  { key: "forestry", keywords: ["forestry", "logging"] },
  { key: "attachment", keywords: ["attachment", "bucket", "auger"] },
];

function equipmentClassFor(input: string | null | undefined): string {
  if (!input) return "other";
  const hay = input.toLowerCase();
  for (const cls of EQUIPMENT_CLASSES) {
    if (cls.keywords.some((kw) => hay.includes(kw))) return cls.key;
  }
  return "other";
}

/** Human-readable class label used in narrative copy. */
const CLASS_DISPLAY: Record<string, string> = {
  mulcher: "mulcher",
  excavator: "excavator",
  skid_steer: "skid steer",
  bulldozer: "dozer",
  loader: "loader",
  grinder: "grinder",
  forestry: "forestry",
  attachment: "attachment",
  other: "equipment",
};

interface SimilarDealRow {
  id: string;
  name: string | null;
  amount: number | null;
  loss_reason: string | null;
  closed_at: string | null;
}

interface LookupRequest {
  dealId: string;
}

interface LookupResponse {
  similarCount: number;
  sampleDealNames: string[];
  topLossReasons: Array<{ reason: string; count: number }>;
  narrative: string | null;
  equipmentClass: string;
  sizeBand: string;
}

function normString(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length === 0 ? null : t.slice(0, maxLen);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("method_not_allowed", 405, origin);

  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return safeJsonError("invalid_json", 400, origin);
  }

  const dealId = normString(raw.dealId, 40);
  if (!dealId || !UUID_PATTERN.test(dealId)) return safeJsonError("invalid dealId", 400, origin);

  const admin = createAdminClient();
  const caller = await resolveCallerContext(req, admin);
  if (!caller.userId || !caller.role || !caller.authHeader) {
    return safeJsonError("Unauthorized", 401, origin);
  }

  try {
    // 1. Load the current deal + its most-recent needs assessment.
    //    Use the caller client so RLS verifies the deal is accessible.
    const callerClient = createCallerClient(caller.authHeader);
    const { data: deal, error: dealErr } = await callerClient
      .from("crm_deals")
      .select("id, workspace_id, company_id, amount")
      .eq("id", dealId as string)
      .is("deleted_at", null)
      .maybeSingle();
    if (dealErr) return safeJsonError("deal_lookup_failed", 500, origin);
    if (!deal) return safeJsonError("deal not found or access denied", 404, origin);

    const { data: assessment } = await callerClient
      .from("needs_assessments")
      .select("machine_interest, current_equipment")
      .eq("deal_id", dealId as string)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const equipmentHint = assessment?.machine_interest ?? assessment?.current_equipment ?? null;
    const equipmentClass = equipmentClassFor(equipmentHint);
    const sizeBand = sizeBandFor(deal.amount as number | null);

    const empty: LookupResponse = {
      similarCount: 0,
      sampleDealNames: [],
      topLossReasons: [],
      narrative: null,
      equipmentClass,
      sizeBand,
    };

    // 2. Find similar lost deals. We over-fetch (up to 80) by workspace
    //    and filter by class + size band in JS, because PostgREST can't
    //    efficiently express the "class matches any keyword" join.
    //    80 is a hard cap to keep this under 300ms in any workspace.
    const { data: candidates, error: candErr } = await admin
      .from("crm_deals")
      .select(`
        id, name, amount, loss_reason, closed_at,
        needs_assessments(machine_interest, current_equipment)
      `)
      .eq("workspace_id", deal.workspace_id as string)
      .not("loss_reason", "is", null)
      .neq("loss_reason", "")
      .neq("id", dealId as string)
      .order("closed_at", { ascending: false })
      .limit(80);
    if (candErr) {
      captureEdgeException(candErr, { fn: "decision-room-pattern-lookup", req, extra: { stage: "candidate_query" } });
      return safeJsonOk(empty, origin);
    }

    // 3. Filter to same equipment class + size band.
    const similar: SimilarDealRow[] = [];
    for (const row of candidates ?? []) {
      const assessments = row.needs_assessments as
        | Array<{ machine_interest: string | null; current_equipment: string | null }>
        | null;
      const hint = assessments?.[0]?.machine_interest ?? assessments?.[0]?.current_equipment ?? row.name ?? null;
      const rowClass = equipmentClassFor(hint);
      const rowBand = sizeBandFor(row.amount as number | null);
      if (rowClass !== equipmentClass) continue;
      if (rowBand !== sizeBand) continue;
      similar.push({
        id: row.id as string,
        name: (row.name as string | null) ?? null,
        amount: (row.amount as number | null) ?? null,
        loss_reason: (row.loss_reason as string | null) ?? null,
        closed_at: (row.closed_at as string | null) ?? null,
      });
    }

    if (similar.length === 0) return safeJsonOk(empty, origin);

    // 4. Aggregate top loss reasons.
    const reasonCounts = new Map<string, number>();
    for (const d of similar) {
      const r = (d.loss_reason ?? "").trim();
      if (!r) continue;
      reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
    }
    const topLossReasons = [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([reason, count]) => ({ reason, count }));

    // 5. Narrative. Only fires at >= 2 similar losses — a single matching
    //    loss isn't a pattern, and surfacing it would cry wolf.
    let narrative: string | null = null;
    if (similar.length >= 2) {
      const classLabel = CLASS_DISPLAY[equipmentClass] ?? "equipment";
      const top = topLossReasons[0];
      if (top && top.count >= 2) {
        narrative = `${top.count} of your last ${similar.length} ${classLabel} deals at this size died for the same reason: ${top.reason}.`;
      } else {
        narrative = `${similar.length} recent ${classLabel} deals at this size have closed lost. Top reason: ${top?.reason ?? "unclassified"}.`;
      }
    }

    const response: LookupResponse = {
      similarCount: similar.length,
      sampleDealNames: similar.slice(0, 3).map((d) => d.name ?? "Unnamed deal"),
      topLossReasons,
      narrative,
      equipmentClass,
      sizeBand,
    };
    return safeJsonOk(response, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "decision-room-pattern-lookup", req, extra: { stage: "main" } });
    return safeJsonError("Internal error", 500, origin);
  }
});
