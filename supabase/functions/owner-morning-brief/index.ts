/**
 * Owner Morning Brief — Slice C of the Owner Dashboard moonshot.
 *
 * Claude Sonnet 4.6 reads:
 *   - owner_dashboard_summary()       — KPI grid payload
 *   - compute_ownership_health_score — composite + dims
 *   - owner_event_feed(24h)           — notable events
 *
 * …and returns a 3–5 sentence narrative the owner reads over coffee.
 *
 * Caching:
 *   - Checks owner_briefs for a row <60 min old and returns it unless
 *     body.refresh === true.
 *   - Writes the new brief back on success.
 *
 * Auth: admin/manager/owner via user JWT (service_role also accepted for cron).
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
const MAX_TOKENS = 512;
const TEMPERATURE = 0.3;
const ANTHROPIC_TIMEOUT_MS = 30_000;
const CACHE_MAX_AGE_MS = 60 * 60_000; // 60 min

interface RequestBody {
  refresh?: boolean;
  workspace?: string | null;
}

const SYSTEM_PROMPT = `You are the AI Chief of Staff for the owner of a heavy-equipment dealership (Quality Equipment & Parts — brands: Yanmar, Bandit, ASV, Prinoth, Barko).

Your job: write a 3–5 sentence morning brief the owner reads with coffee. Formal-but-punchy, numbers-first, action-oriented.

Hard rules:
- Lead with what changed overnight (events). Then the 1–2 things to prioritize today. Then 1 watch-out.
- Use specific numbers from the data, never round to "a few" or "some". "$180K", "3 stockouts", "12 plays worth $1,351".
- Never invent part numbers, customers, vendors, or dollar amounts not in the data.
- No bullet lists. No headers. Pure prose — 3 to 5 sentences, MAX 120 words.
- Address the owner directly ("you", "your"). No "Dear Owner", no sign-off.
- Money always as "$X" or "$X.XK/M", never with trailing cents.`;

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
    let workspaceHint: string | null = null;

    if (authHeader === `Bearer ${serviceKey}`) {
      supabase = createClient(supabaseUrl, serviceKey);
    } else {
      const auth = await requireServiceUser(authHeader, origin);
      if (!auth.ok) return auth.response;
      if (!["admin", "manager", "owner"].includes(auth.role)) {
        return safeJsonError("owner/admin/manager role required", 403, origin);
      }
      supabase = createClient(supabaseUrl, serviceKey);
      workspaceHint = null; // RPC resolves via get_my_workspace
    }

    const body = (req.method === "POST" ? await req.json() : {}) as RequestBody;
    const workspace = body.workspace ?? workspaceHint ?? "default";
    const refresh = body.refresh === true;

    // ── 1. Check cache first unless explicit refresh ─────────────
    if (!refresh) {
      const { data: cached } = await supabase
        .from("owner_briefs")
        .select("brief_text, model, generated_at, event_count")
        .eq("workspace_id", workspace)
        .maybeSingle();

      if (cached) {
        const ageMs = Date.now() - new Date(cached.generated_at).getTime();
        if (ageMs < CACHE_MAX_AGE_MS) {
          return safeJsonOk({
            brief: cached.brief_text,
            generated_at: cached.generated_at,
            cached: true,
            model: cached.model ?? CLAUDE_MODEL,
          }, origin);
        }
      }
    }

    // ── 2. Fetch live data for prompt context ────────────────────
    const [summaryRes, scoreRes, feedRes] = await Promise.all([
      supabase.rpc("owner_dashboard_summary", { p_workspace: workspace }),
      supabase.rpc("compute_ownership_health_score", { p_workspace: workspace }),
      supabase.rpc("owner_event_feed", { p_workspace: workspace, p_hours_back: 24 }),
    ]);

    if (summaryRes.error) {
      return safeJsonError(`summary failed: ${summaryRes.error.message}`, 500, origin);
    }

    const prompt = buildPrompt(summaryRes.data, scoreRes.data, feedRes.data);

    // ── 3. Call Claude ──────────────────────────────────────────
    const claudeResp = await callClaude(anthropicKey, SYSTEM_PROMPT, prompt);

    // ── 4. Write cache ──────────────────────────────────────────
    const generatedAt = new Date().toISOString();
    const eventCount = (feedRes.data as { count?: number } | null)?.count ?? 0;

    await supabase
      .from("owner_briefs")
      .upsert({
        workspace_id: workspace,
        brief_text: claudeResp.text,
        model: CLAUDE_MODEL,
        tokens_in: claudeResp.tokens_in,
        tokens_out: claudeResp.tokens_out,
        event_count: eventCount,
        generated_at: generatedAt,
      }, { onConflict: "workspace_id" });

    return safeJsonOk({
      brief: claudeResp.text,
      generated_at: generatedAt,
      cached: false,
      model: CLAUDE_MODEL,
      elapsed_ms: Date.now() - startMs,
      tokens_in: claudeResp.tokens_in,
      tokens_out: claudeResp.tokens_out,
    }, origin);
  } catch (err) {
    captureEdgeException(err, { fn: "owner-morning-brief" });
    return safeJsonError((err as Error).message, 500, origin);
  }
});

// ── Helpers ─────────────────────────────────────────────────────

function buildPrompt(summary: unknown, score: unknown, feed: unknown): string {
  const lines: string[] = [];
  lines.push("BUSINESS SNAPSHOT");
  lines.push(JSON.stringify(summary, null, 2));
  lines.push("\nHEALTH SCORE");
  lines.push(JSON.stringify(score, null, 2));
  lines.push("\nEVENTS — LAST 24 HOURS");
  lines.push(JSON.stringify(feed, null, 2));
  lines.push(
    "\nWrite the 3–5 sentence morning brief. Overnight changes first, then 1–2 priorities, then 1 watch-out. Ground every number in the data above.",
  );
  return lines.join("\n");
}

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
    throw new Error(`anthropic ${res.status}: ${text.slice(0, 200)}`);
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
