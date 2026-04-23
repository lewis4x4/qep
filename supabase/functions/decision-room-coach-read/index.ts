/**
 * decision-room-coach-read
 *
 * Single paragraph executive "read" of a live decision room. Runs once per
 * (dealId, snapshot) — the frontend caches aggressively — so cost stays low
 * even on a hot deal. The read is the page's opening voice: it tells the
 * rep what this room is, what's unique, and the single move the coach
 * would make today.
 *
 * Auth: same pattern as decision-room-seat-chat. Gateway verify_jwt must
 * be false; this function verifies user + deal access itself.
 */
import { createCallerClient, createAdminClient, resolveCallerContext } from "../_shared/dge-auth.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { enforceRateLimitWithFallback } from "../_shared/rate-limit-fallback.ts";

const MODEL = "gpt-5.4-mini";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SEATS = 30;
const MAX_EVIDENCE_PER_SEAT = 6;

interface SeatSummary {
  status: "named" | "ghost";
  archetype: string;
  archetypeLabel: string;
  name: string | null;
  title: string | null;
  stance: "champion" | "neutral" | "skeptical" | "blocker" | "unknown";
  powerWeight: number;
  vetoWeight: number;
  evidence: string[];
}

interface ScoreSummary {
  decisionVelocity: { days: number | null; confidence: string };
  coverage: { value: number; filled: number; expected: number; missingArchetypes: string[] };
  consensusRisk: { level: string };
  latentVeto: { level: string; topGhostArchetype: string | null };
}

interface ReadRequest {
  dealId: string;
  dealName: string | null;
  companyName: string | null;
  seats: SeatSummary[];
  scores: ScoreSummary;
}

function normString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length === 0 ? null : t.slice(0, max);
}

function sanitizeSeats(raw: unknown): SeatSummary[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_SEATS)
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const s = item as Record<string, unknown>;
      return {
        status: s.status === "ghost" ? "ghost" : "named",
        archetype: typeof s.archetype === "string" ? s.archetype.slice(0, 40) : "champion",
        archetypeLabel: normString(s.archetypeLabel, 80) ?? "Seat",
        name: normString(s.name, 120),
        title: normString(s.title, 120),
        stance: typeof s.stance === "string" &&
          ["champion", "neutral", "skeptical", "blocker", "unknown"].includes(s.stance)
          ? (s.stance as SeatSummary["stance"])
          : "unknown",
        powerWeight: typeof s.powerWeight === "number" ? Math.max(0, Math.min(1, s.powerWeight)) : 0,
        vetoWeight: typeof s.vetoWeight === "number" ? Math.max(0, Math.min(1, s.vetoWeight)) : 0,
        evidence: Array.isArray(s.evidence)
          ? s.evidence
              .slice(0, MAX_EVIDENCE_PER_SEAT)
              .map((e: unknown) => (typeof e === "string" ? e.slice(0, 400) : ""))
              .filter(Boolean)
          : [],
      } satisfies SeatSummary;
    })
    .filter((x): x is SeatSummary => x != null);
}

function sanitizeScores(raw: unknown): ScoreSummary {
  const fallback: ScoreSummary = {
    decisionVelocity: { days: null, confidence: "low" },
    coverage: { value: 0, filled: 0, expected: 0, missingArchetypes: [] },
    consensusRisk: { level: "low" },
    latentVeto: { level: "low", topGhostArchetype: null },
  };
  if (!raw || typeof raw !== "object") return fallback;
  const s = raw as Record<string, unknown>;
  const dv = (s.decisionVelocity ?? {}) as Record<string, unknown>;
  const cv = (s.coverage ?? {}) as Record<string, unknown>;
  const cr = (s.consensusRisk ?? {}) as Record<string, unknown>;
  const lv = (s.latentVeto ?? {}) as Record<string, unknown>;
  return {
    decisionVelocity: {
      days: typeof dv.days === "number" ? dv.days : null,
      confidence: typeof dv.confidence === "string" ? dv.confidence : "low",
    },
    coverage: {
      value: typeof cv.value === "number" ? cv.value : 0,
      filled: typeof cv.filled === "number" ? cv.filled : 0,
      expected: typeof cv.expected === "number" ? cv.expected : 0,
      missingArchetypes: Array.isArray(cv.missingArchetypes)
        ? cv.missingArchetypes.filter((x): x is string => typeof x === "string").slice(0, 10)
        : [],
    },
    consensusRisk: {
      level: typeof cr.level === "string" ? cr.level : "low",
    },
    latentVeto: {
      level: typeof lv.level === "string" ? lv.level : "low",
      topGhostArchetype: typeof lv.topGhostArchetype === "string" ? lv.topGhostArchetype : null,
    },
  };
}

function summarizeSeats(seats: SeatSummary[]): string {
  const named = seats.filter((s) => s.status === "named");
  const ghosts = seats.filter((s) => s.status === "ghost");
  const named_lines = named.map(
    (s) =>
      `- ${s.name ?? "(unnamed)"}${s.title ? ` (${s.title})` : ""} — ${s.archetypeLabel}, stance: ${s.stance}, power ${(s.powerWeight * 100).toFixed(0)}%`,
  );
  const ghost_lines = ghosts.map(
    (s) =>
      `- ${s.name ? s.name : `probable ${s.archetypeLabel}`} — ghost, veto ${(s.vetoWeight * 100).toFixed(0)}%`,
  );
  return [
    "NAMED SEATS:",
    named_lines.length > 0 ? named_lines.join("\n") : "(none)",
    "",
    "GHOST SEATS:",
    ghost_lines.length > 0 ? ghost_lines.join("\n") : "(none)",
  ].join("\n");
}

function buildPrompt(req: ReadRequest): string {
  const { scores } = req;
  const velocity = scores.decisionVelocity.days == null
    ? "no predicted close date yet"
    : `${scores.decisionVelocity.days}d predicted to close`;
  const coverage = `${scores.coverage.filled}/${scores.coverage.expected} expected seats named`;
  const missing = scores.coverage.missingArchetypes.length > 0
    ? `missing archetypes: ${scores.coverage.missingArchetypes.join(", ")}`
    : "no missing archetypes";
  const consensus = `consensus risk: ${scores.consensusRisk.level}`;
  const veto = `latent veto: ${scores.latentVeto.level}${scores.latentVeto.topGhostArchetype ? ` (${scores.latentVeto.topGhostArchetype} ghost)` : ""}`;

  return [
    `Deal: ${req.dealName ?? "untitled equipment deal"} at ${req.companyName ?? "the buyer's company"}.`,
    "",
    "ROOM SUMMARY:",
    summarizeSeats(req.seats),
    "",
    "SCORES:",
    `- Decision Velocity: ${velocity}, confidence ${scores.decisionVelocity.confidence}`,
    `- Coverage: ${coverage}, ${missing}`,
    `- ${consensus}`,
    `- ${veto}`,
    "",
    "Write a single tight paragraph (max 110 words) as a senior equipment-sales coach reading this room for the rep. Structure:",
    "1. One sentence on what's distinctive about THIS room right now (named stakeholders, shape, risk).",
    "2. One sentence naming the single biggest risk or opportunity the rep isn't seeing.",
    "3. One sentence on the highest-leverage move for THIS WEEK.",
    "",
    "Hard rules:",
    "- Reference facts only from the ROOM SUMMARY and SCORES blocks above.",
    "- Do not invent names, dollar amounts, dates, or policies.",
    "- Be direct, operator-minded, and avoid filler.",
    "- Write in the voice of a coach, not a chatbot. No 'Hi', no 'Based on the data above'.",
  ].join("\n");
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
  if (!dealId || !UUID_PATTERN.test(dealId)) {
    return safeJsonError("invalid dealId", 400, origin);
  }

  const body: ReadRequest = {
    dealId,
    dealName: normString(raw.dealName, 200),
    companyName: normString(raw.companyName, 200),
    seats: sanitizeSeats(raw.seats),
    scores: sanitizeScores(raw.scores),
  };

  const admin = createAdminClient();
  const caller = await resolveCallerContext(req, admin);
  if (!caller.userId || !caller.role || !caller.authHeader) {
    return safeJsonError("Unauthorized", 401, origin);
  }

  const rateOk = await enforceRateLimitWithFallback(admin, {
    userId: caller.userId,
    endpoint: "decision-room-coach-read",
    maxRequests: 10,
    windowSeconds: 60,
  });
  if (!rateOk) {
    return safeJsonError("Rate limit exceeded — try again in a moment.", 429, origin);
  }

  const callerClient = createCallerClient(caller.authHeader);
  const { data: dealRow, error: dealErr } = await callerClient
    .from("crm_deals")
    .select("id")
    .eq("id", body.dealId)
    .is("deleted_at", null)
    .maybeSingle();
  if (dealErr) {
    console.error("[decision-room-coach-read] deal lookup failed", dealErr);
    return safeJsonError("deal_lookup_failed", 500, origin);
  }
  if (!dealRow) {
    return safeJsonError("deal not found or access denied", 404, origin);
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return safeJsonError("OPENAI_API_KEY not configured", 500, origin);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a senior equipment-sales coach reading live decision rooms. Every read stays grounded in the supplied summary — no invention.",
          },
          { role: "user", content: buildPrompt(body) },
        ],
        max_completion_tokens: 300,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      console.error("[decision-room-coach-read] OpenAI error", {
        status: response.status,
        code: payload?.error?.code,
      });
      return safeJsonError(
        `read model error: ${payload?.error?.message ?? response.status}`,
        502,
        origin,
      );
    }

    const read = payload.choices?.[0]?.message?.content?.trim() ?? "";
    if (!read) return safeJsonError("empty read", 502, origin);

    return safeJsonOk({ read, generatedAt: new Date().toISOString() }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "decision-room-coach-read", req });
    console.error("[decision-room-coach-read] unexpected error", err);
    return safeJsonError(err instanceof Error ? err.message : "read_failed", 500, origin);
  }
});
