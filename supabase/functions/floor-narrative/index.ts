/**
 * floor-narrative — one-sentence cached narrative for The Floor.
 *
 * Auth: valid user JWT via requireServiceUser. All staff roles allowed.
 * Cache: public.floor_narratives, 15-minute TTL per workspace+Iron role.
 * Failure mode: deterministic role copy is persisted and returned. The Floor
 * never blocks on Claude or an upstream snapshot query.
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";

const VALID_IRON_ROLES = new Set([
  "iron_manager",
  "iron_advisor",
  "iron_woman",
  "iron_man",
  "iron_owner",
  "iron_parts_counter",
  "iron_parts_manager",
]);

const MODEL = Deno.env.get("FLOOR_NARRATIVE_MODEL") ?? "claude-sonnet-4-6";
const MAX_TOKENS = 120;
const TEMPERATURE = 0.2;
const CACHE_TTL_MS = 15 * 60_000;
const ANTHROPIC_TIMEOUT_MS = 12_000;

interface RequestBody {
  iron_role?: string;
  refresh?: boolean;
}

interface NarrativeRow {
  narrative_text: string;
  generated_at: string;
  expires_at: string;
  model: string | null;
  error_snapshot_json: unknown | null;
}

const SYSTEM_PROMPT = `You write the single sentence at the top of "The Floor" for Quality Equipment & Parts, a heavy-equipment dealership.

Voice: direct, operational, shop-floor useful. No hype. No AI language. No bullet list. No greeting.

Rules:
- Exactly one sentence, maximum 28 words.
- Ground the sentence in the snapshot. If the snapshot is thin, say what queue or signal is ready instead of inventing facts.
- Use QEP's wording: approvals, stale deals, parts orders, service tickets, inventory, supplier health.
- Never mention "dashboard", "preview", "Claude", "AI", or "data unavailable".`;

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return safeJsonError("Missing SUPABASE_URL / SERVICE_ROLE_KEY", 500, origin);
    }

    const body = await readBody(req);
    const ironRole = await resolveIronRole(auth.supabase, auth.userId, body.iron_role);
    if (!VALID_IRON_ROLES.has(ironRole)) {
      return safeJsonError("Invalid iron_role", 400, origin);
    }

    const workspaceId = auth.workspaceId ?? "default";
    const service = createClient(supabaseUrl, serviceKey);
    const refresh = body.refresh === true;

    if (!refresh) {
      const cached = await loadFreshCache(service, workspaceId, ironRole);
      if (cached) {
        return safeJsonOk({
          narrative_text: cached.narrative_text,
          generated_at: cached.generated_at,
          expires_at: cached.expires_at,
          cached: true,
          fallback: cached.error_snapshot_json != null,
          model: cached.model,
        }, origin);
      }
    }

    const snapshot = await buildSnapshot(service, workspaceId, ironRole);
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    const generatedAt = new Date();
    const expiresAt = new Date(generatedAt.getTime() + CACHE_TTL_MS);

    let text = deterministicNarrative(ironRole, snapshot);
    let fallback = true;
    let errorSnapshot: Record<string, unknown> | null = null;
    let model: string | null = null;

    if (anthropicKey) {
      try {
        const generated = await callClaude(anthropicKey, ironRole, snapshot);
        if (generated) {
          text = generated;
          fallback = false;
          model = MODEL;
        }
      } catch (error) {
        errorSnapshot = {
          message: error instanceof Error ? error.message : "Claude generation failed",
          at: generatedAt.toISOString(),
        };
      }
    } else {
      errorSnapshot = {
        message: "ANTHROPIC_API_KEY not configured",
        at: generatedAt.toISOString(),
      };
    }

    await service
      .from("floor_narratives")
      .upsert({
        workspace_id: workspaceId,
        iron_role: ironRole,
        narrative_text: text,
        source_snapshot_json: snapshot,
        generated_at: generatedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        model,
        error_snapshot_json: errorSnapshot,
      }, { onConflict: "workspace_id,iron_role" });

    return safeJsonOk({
      narrative_text: text,
      generated_at: generatedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      cached: false,
      fallback,
      model,
    }, origin);
  } catch (error) {
    captureEdgeException(error, { fn: "floor-narrative" });
    return safeJsonError(error instanceof Error ? error.message : "floor-narrative failed", 500, origin);
  }
});

async function readBody(req: Request): Promise<RequestBody> {
  if (req.method !== "POST") return {};
  try {
    return (await req.json()) as RequestBody;
  } catch {
    return {};
  }
}

async function resolveIronRole(
  supabase: SupabaseClient,
  userId: string,
  requestedRole: string | undefined,
): Promise<string> {
  if (requestedRole && VALID_IRON_ROLES.has(requestedRole)) return requestedRole;
  const { data } = await supabase
    .from("profiles")
    .select("iron_role")
    .eq("id", userId)
    .maybeSingle();
  const role = (data as { iron_role?: string | null } | null)?.iron_role;
  return role && VALID_IRON_ROLES.has(role) ? role : "iron_advisor";
}

async function loadFreshCache(
  supabase: SupabaseClient,
  workspaceId: string,
  ironRole: string,
): Promise<NarrativeRow | null> {
  const { data, error } = await supabase
    .from("floor_narratives")
    .select("narrative_text, generated_at, expires_at, model, error_snapshot_json")
    .eq("workspace_id", workspaceId)
    .eq("iron_role", ironRole)
    .maybeSingle();

  if (error || !data) return null;
  if (new Date((data as NarrativeRow).expires_at).getTime() <= Date.now()) return null;
  return data as NarrativeRow;
}

async function buildSnapshot(
  supabase: SupabaseClient,
  workspaceId: string,
  ironRole: string,
): Promise<Record<string, unknown>> {
  const [summary, events, invoices, serviceJobs, partsOrders] = await Promise.allSettled([
    supabase.rpc("owner_dashboard_summary", { p_workspace: workspaceId }),
    supabase.rpc("owner_event_feed", { p_workspace: workspaceId, p_hours_back: 24 }),
    supabase
      .from("customer_invoices")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .in("status", ["pending", "sent", "overdue", "approved", "draft"]),
    supabase
      .from("service_jobs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .is("closed_at", null)
      .is("deleted_at", null),
    supabase
      .from("parts_orders")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .not("status", "in", "(delivered,cancelled,canceled)"),
  ]);

  return {
    workspace_id: workspaceId,
    iron_role: ironRole,
    generated_at: new Date().toISOString(),
    owner_summary: settledData(summary),
    events_24h: settledData(events),
    pending_invoice_count: settledCount(invoices),
    open_service_ticket_count: settledCount(serviceJobs),
    open_parts_order_count: settledCount(partsOrders),
  };
}

function settledData(result: PromiseSettledResult<{ data: unknown; error: unknown }>): unknown {
  if (result.status === "rejected") return { error: String(result.reason) };
  if (result.value.error) return { error: String((result.value.error as { message?: string }).message ?? result.value.error) };
  return result.value.data;
}

function settledCount(result: PromiseSettledResult<{ count: number | null; error: unknown }>): number | null {
  if (result.status === "rejected" || result.value.error) return null;
  return result.value.count ?? 0;
}

function deterministicNarrative(ironRole: string, snapshot: Record<string, unknown>): string {
  const eventCount = Number((snapshot.events_24h as { count?: number } | null)?.count ?? 0);
  const partsOrders = snapshot.open_parts_order_count as number | null;
  const serviceTickets = snapshot.open_service_ticket_count as number | null;
  const invoices = snapshot.pending_invoice_count as number | null;

  switch (ironRole) {
    case "iron_owner":
      return eventCount > 0
        ? `${eventCount} overnight business signals are ready, with revenue pace and risk queues surfaced below.`
        : "Revenue pace, at-risk customers, and operating queues are ready for a clean first pass.";
    case "iron_manager":
      return `${invoices ?? 0} invoice blockers, ${serviceTickets ?? 0} open service tickets, and stale deal pressure are staged for review.`;
    case "iron_advisor":
      return "Your active deals, follow-ups, and quote signals are staged by urgency so the first useful move is visible.";
    case "iron_woman":
      return `${invoices ?? 0} invoice rows and the office blockers behind open deals are ready to clear.`;
    case "iron_man":
      return `${serviceTickets ?? 0} open service tickets are on the Floor, with parts and blocker context one click away.`;
    case "iron_parts_counter":
      return `${partsOrders ?? 0} open parts orders are visible; start with serial lookup, quote drafts, or today's counter work.`;
    case "iron_parts_manager":
      return `${partsOrders ?? 0} open parts orders are visible with demand, inventory, and supplier health below.`;
    default:
      return "The work that needs attention is staged below by role, with the next action surfaced first.";
  }
}

async function callClaude(
  apiKey: string,
  ironRole: string,
  snapshot: Record<string, unknown>,
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Iron role: ${ironRole}\nSnapshot:\n${JSON.stringify(snapshot, null, 2)}\n\nWrite the one sentence.`,
        },
      ],
    }),
    signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`anthropic ${res.status}: ${body.slice(0, 240)}`);
  }

  const data = await res.json();
  const text = String(data?.content?.[0]?.text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) throw new Error("anthropic returned empty narrative");
  return text.split(/\n/)[0].slice(0, 220);
}
