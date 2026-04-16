/**
 * Owner Predictive Interventions — Slice E of the Owner Dashboard moonshot.
 *
 * Claude Sonnet 4.6 looks at the current business state and projects 3-4
 * forward-looking scenarios ("what happens if"), each with:
 *   - title
 *   - projection (1 sentence: the trajectory)
 *   - rationale (1 sentence: why, grounded in numbers)
 *   - impact_usd (estimated dollar impact if unmanaged)
 *   - horizon_days
 *   - severity (high/medium/low)
 *   - action { label, route }  — click-through into the right deep page
 *
 * Read sources: owner_dashboard_summary, compute_ownership_health_score,
 * v_branch_stack_ranking, predicted_parts_plays (open), qrm_deals (stalled).
 *
 * Cached for 30 min in a lightweight Postgres table.
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

const CLAUDE_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1536;
const TEMPERATURE = 0.3;
const ANTHROPIC_TIMEOUT_MS = 35_000;
const CACHE_MAX_AGE_MS = 30 * 60_000;

interface RequestBody {
  refresh?: boolean;
  workspace?: string | null;
}

interface Intervention {
  title: string;
  projection: string;
  rationale: string;
  impact_usd?: number;
  horizon_days?: number;
  severity: "high" | "medium" | "low";
  action: { label: string; route: string };
}

const ALLOWED_ROUTES = [
  "/owner",
  "/executive",
  "/qrm",
  "/qrm/deals",
  "/qrm/companies",
  "/qrm/exceptions",
  "/qrm/command/approvals",
  "/qrm/command/blockers",
  "/parts/companion/intelligence",
  "/parts/companion/replenish",
  "/parts/companion/predictive",
  "/parts/companion/pricing-rules",
  "/service",
  "/rentals",
];

const SYSTEM_PROMPT = `You are the AI strategic advisor for the owner of Quality Equipment & Parts (QEP), a multi-branch equipment dealership.

Given a business snapshot, you project 3-4 forward-looking scenarios. Each is something that WILL happen if the owner does nothing, grounded in the current data.

Output STRICT JSON only (no markdown, no prose):
{
  "interventions": [
    {
      "title": "short noun phrase, 3-6 words",
      "projection": "ONE sentence: the trajectory with a concrete number + timeframe",
      "rationale": "ONE sentence: why, citing the driving signal from the data",
      "impact_usd": <integer dollar impact, or 0 if non-monetary>,
      "horizon_days": <integer: when the trajectory crosses the line>,
      "severity": "high" | "medium" | "low",
      "action": { "label": "verb phrase, max 3 words", "route": "/one/of/the/allowed/routes" }
    }
  ]
}

Allowed routes (action.route MUST be one of these EXACT strings):
${ALLOWED_ROUTES.map((r) => `  ${r}`).join("\n")}

Rules:
- 3-4 interventions. Mix severities — at least one high, at least one medium.
- Every number must come from the snapshot data. Don't invent amounts.
- projection always includes a specific number and a timeframe ("crosses $100K in 6 weeks", "delays 14 service jobs within 10 days").
- rationale points at the evidence ("12 SKUs drive 60% of the buildup", "4 deals haven't moved in 12+ days").
- Severity calibration: high = revenue impact >$50K OR operational breakdown; medium = $10-50K OR accumulating risk; low = watch-list.
- action.label is imperative ("Run clearance", "Review queue", "Open deal board").
- No duplicate titles. No two interventions with the same route unless the drivers are genuinely different.
- Output ONLY the JSON object. No code fences. No other text.`;

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  const startMs = Date.now();

  try {
    const authHeader = req.headers.get("Authorization")?.trim() ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!supabaseUrl || !serviceKey) {
      return safeJsonError("Missing SUPABASE_URL / SERVICE_ROLE_KEY", 500, origin);
    }
    if (!anthropicKey) {
      return safeJsonError("ANTHROPIC_API_KEY not configured", 500, origin);
    }

    let supabase: SupabaseClient;

    if (authHeader === `Bearer ${serviceKey}`) {
      supabase = createClient(supabaseUrl, serviceKey);
    } else {
      const auth = await requireServiceUser(authHeader, origin);
      if (!auth.ok) return auth.response;
      if (!["admin", "manager", "owner"].includes(auth.role)) {
        return safeJsonError("owner/admin/manager role required", 403, origin);
      }
      supabase = createClient(supabaseUrl, serviceKey);
    }

    const body = (req.method === "POST" ? await req.json() : {}) as RequestBody;
    const workspace = body.workspace ?? "default";
    const refresh = body.refresh === true;

    // Cache check
    if (!refresh) {
      const { data: cached } = await supabase
        .from("owner_predictive_interventions_cache")
        .select("payload, generated_at, model")
        .eq("workspace_id", workspace)
        .maybeSingle();
      if (cached) {
        const ageMs = Date.now() - new Date(cached.generated_at).getTime();
        if (ageMs < CACHE_MAX_AGE_MS) {
          return safeJsonOk({
            ...cached.payload,
            cached: true,
            generated_at: cached.generated_at,
            model: cached.model ?? CLAUDE_MODEL,
          }, origin);
        }
      }
    }

    // Gather snapshot data in parallel
    const [summaryRes, scoreRes, branchRes, playsRes, stalledRes] = await Promise.all([
      supabase.rpc("owner_dashboard_summary", { p_workspace: workspace }),
      supabase.rpc("compute_ownership_health_score", { p_workspace: workspace }),
      supabase.from("v_branch_stack_ranking").select("*"),
      supabase
        .from("predicted_parts_plays")
        .select("part_number, part_description, projection_window, projected_revenue, recommended_order_qty, probability")
        .eq("status", "open")
        .order("projected_revenue", { ascending: false })
        .limit(10),
      // qrm_deals uses stage_id (FK to qrm_deal_stages) + closed_at, not status.
      // "Stalled" = not closed AND not updated in 14+ days.
      supabase
        .from("qrm_deals")
        .select(
          `id, name, amount, updated_at, closed_at,
           qrm_deal_stages ( name, is_closed_won, is_closed_lost )`,
        )
        .is("deleted_at", null)
        .is("closed_at", null)
        .lt("updated_at", new Date(Date.now() - 14 * 86400_000).toISOString())
        .order("amount", { ascending: false })
        .limit(10),
    ]);

    const snapshot = {
      summary: summaryRes.data ?? null,
      health_score: scoreRes.data ?? null,
      branches: branchRes.data ?? [],
      top_open_predictive_plays: playsRes.data ?? [],
      stalled_deals: stalledRes.data ?? [],
    };

    const prompt =
      "BUSINESS SNAPSHOT\n" + JSON.stringify(snapshot, null, 2) +
      "\n\nReturn 3-4 predictive interventions as STRICT JSON per the schema. Ground every number.";

    const claudeResp = await callClaude(anthropicKey, SYSTEM_PROMPT, prompt);
    const parsed = parseInterventions(claudeResp.text);

    // Cache write
    const generatedAt = new Date().toISOString();
    const payload = { interventions: parsed, generated_at: generatedAt };

    await supabase
      .from("owner_predictive_interventions_cache")
      .upsert({
        workspace_id: workspace,
        payload,
        model: CLAUDE_MODEL,
        tokens_in: claudeResp.tokens_in,
        tokens_out: claudeResp.tokens_out,
        generated_at: generatedAt,
      }, { onConflict: "workspace_id" });

    return safeJsonOk({
      ...payload,
      cached: false,
      model: CLAUDE_MODEL,
      elapsed_ms: Date.now() - startMs,
      tokens_in: claudeResp.tokens_in,
      tokens_out: claudeResp.tokens_out,
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "owner-predictive-interventions" });
    return safeJsonError((err as Error).message, 500, origin);
  }
});

async function callClaude(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
): Promise<{ text: string; tokens_in: number; tokens_out: number }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
    signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`anthropic ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = ((data?.content?.[0]?.text as string) ?? "").trim();
  const usage = (data?.usage ?? {}) as Record<string, unknown>;
  return {
    text,
    tokens_in: Number(usage.input_tokens ?? 0),
    tokens_out: Number(usage.output_tokens ?? 0),
  };
}

function parseInterventions(raw: string): Intervention[] {
  let s = raw.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  const parsed = JSON.parse(s);
  if (!parsed || !Array.isArray(parsed.interventions)) {
    throw new Error("interventions array missing");
  }
  const allowed = new Set(ALLOWED_ROUTES);
  return (parsed.interventions as Intervention[])
    .filter((i) => i && i.title && i.projection && i.action?.route)
    .map((i) => ({
      ...i,
      severity: (["high", "medium", "low"].includes(i.severity) ? i.severity : "medium") as Intervention["severity"],
      action: {
        label: i.action.label?.slice(0, 24) || "Open",
        // Fall back to /owner for any route the model invented
        route: allowed.has(i.action.route) ? i.action.route : "/owner",
      },
    }))
    .slice(0, 4);
}
