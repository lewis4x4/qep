/**
 * Owner Morning Brief — Slice C of the Owner Dashboard moonshot.
 *
 * Auth contract (verify_jwt=false on gateway; in-function auth is authoritative):
 *
 * - JWT (admin/manager/owner): always uses profiles.active_workspace_id.
 *   Body `workspace` / `workspace_id` is ignored so a forged target cannot
 *   retarget the brief. Missing active workspace fails closed (403).
 * - Service role (cron / internal): requires an explicit workspace via
 *   `x-workspace-id` header and/or body `workspace` / `workspace_id`.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type CallerContext,
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";

export const CLAUDE_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 512;
const TEMPERATURE = 0.3;
const ANTHROPIC_TIMEOUT_MS = 30_000;
export const CACHE_MAX_AGE_MS = 60 * 60_000;

export interface OwnerMorningBriefBody {
  refresh?: boolean;
  workspace?: unknown;
  workspace_id?: unknown;
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

export function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function resolveOwnerMorningBriefWorkspace(params: {
  isServiceRole: boolean;
  callerWorkspaceId: string | null;
  requestedWorkspaceId: string | null;
}):
  | { ok: true; workspaceId: string }
  | { ok: false; status: 400 | 403; message: string } {
  const callerWorkspaceId = cleanString(params.callerWorkspaceId);
  const requestedWorkspaceId = cleanString(params.requestedWorkspaceId);

  if (!params.isServiceRole) {
    if (!callerWorkspaceId) {
      return {
        ok: false,
        status: 403,
        message: "The authenticated user has no active workspace",
      };
    }
    // Body workspace hints are ignored for JWT callers so a forged target
    // cannot retarget the brief; active_workspace_id is authoritative.
    return { ok: true, workspaceId: callerWorkspaceId };
  }

  if (
    callerWorkspaceId && requestedWorkspaceId &&
    callerWorkspaceId !== requestedWorkspaceId
  ) {
    return {
      ok: false,
      status: 403,
      message: "The requested workspace conflicts with the service target",
    };
  }

  const workspaceId = callerWorkspaceId ?? requestedWorkspaceId;
  if (!workspaceId) {
    return {
      ok: false,
      status: 400,
      message: "Service callers must provide an explicit workspace target",
    };
  }
  return { ok: true, workspaceId };
}

export function buildPrompt(summary: unknown, score: unknown, feed: unknown): string {
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

export async function callClaude(
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

async function readBody(req: Request): Promise<OwnerMorningBriefBody> {
  if (req.method !== "POST") return {};
  const raw = await req.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Request body must be a JSON object.");
  }
  return parsed as OwnerMorningBriefBody;
}

export interface OwnerMorningBriefDependencies {
  createAdminClient: typeof createAdminClient;
  resolveCallerContext: typeof resolveCallerContext;
  callClaude: typeof callClaude;
  getAnthropicApiKey: () => string | undefined;
}

const defaultDependencies: OwnerMorningBriefDependencies = {
  createAdminClient,
  resolveCallerContext,
  callClaude,
  getAnthropicApiKey: () => Deno.env.get("ANTHROPIC_API_KEY"),
};

export async function handleOwnerMorningBrief(
  req: Request,
  overrides: Partial<OwnerMorningBriefDependencies> = {},
): Promise<Response> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  const startMs = Date.now();

  try {
    const anthropicKey = dependencies.getAnthropicApiKey();
    if (!anthropicKey) {
      return safeJsonError("ANTHROPIC_API_KEY not configured", 500, origin);
    }

    const admin = dependencies.createAdminClient();
    const caller = await dependencies.resolveCallerContext(req, admin);

    if (!caller.isServiceRole) {
      if (!caller.userId || !caller.role) {
        return safeJsonError("Unauthorized", 401, origin);
      }
      if (!["admin", "manager", "owner"].includes(caller.role)) {
        return safeJsonError("owner/admin/manager role required", 403, origin);
      }
    }

    const body = await readBody(req);
    const requestedWorkspaceId = cleanString(body.workspace) ??
      cleanString(body.workspace_id);
    const workspaceSelection = resolveOwnerMorningBriefWorkspace({
      isServiceRole: caller.isServiceRole,
      callerWorkspaceId: caller.workspaceId,
      requestedWorkspaceId,
    });
    if (!workspaceSelection.ok) {
      return safeJsonError(
        workspaceSelection.message,
        workspaceSelection.status,
        origin,
      );
    }
    const workspace = workspaceSelection.workspaceId;
    const refresh = body.refresh === true;

    if (!refresh) {
      const { data: cached } = await admin
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

    const [summaryRes, scoreRes, feedRes] = await Promise.all([
      admin.rpc("owner_dashboard_summary", { p_workspace: workspace }),
      admin.rpc("compute_ownership_health_score", { p_workspace: workspace }),
      admin.rpc("owner_event_feed", { p_workspace: workspace, p_hours_back: 24 }),
    ]);

    if (summaryRes.error) {
      return safeJsonError(
        `summary failed: ${summaryRes.error.message}`,
        500,
        origin,
      );
    }

    const prompt = buildPrompt(summaryRes.data, scoreRes.data, feedRes.data);
    const claudeResp = await dependencies.callClaude(
      anthropicKey,
      SYSTEM_PROMPT,
      prompt,
    );

    const generatedAt = new Date().toISOString();
    const eventCount = (feedRes.data as { count?: number } | null)?.count ?? 0;

    await admin
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
    if (err instanceof SyntaxError) {
      return safeJsonError("Request body must be valid JSON", 400, origin);
    }
    captureEdgeException(err, { fn: "owner-morning-brief" });
    return safeJsonError((err as Error).message, 500, origin);
  }
}
