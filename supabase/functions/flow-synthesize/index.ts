/**
 * QEP Flow Engine — flow-synthesize edge function (Slice 5)
 *
 * Takes a natural-language brief from an admin and produces a draft
 * `FlowWorkflowDefinition` JSON via Anthropic. The draft is INSERTED
 * into `flow_workflow_definitions` with `enabled=false` so the admin
 * can review + enable it from /admin/flow.
 *
 * Owner-only auth. The brief is constrained by including the action
 * registry catalog + event taxonomy in the system prompt so the model
 * only references actions/events that actually exist.
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const ACTION_CATALOG = [
  "create_task", "create_note", "send_email_draft", "send_in_app_notification",
  "update_deal_stage", "tag_account", "create_exception", "recompute_health_score",
  "notify_service_recipient", "escalate_parts_vendor", "create_audit_event",
  "request_approval",
];

const EVENT_TAXONOMY = [
  "deal.created", "deal.stage.changed", "deal.closed_won",
  "voice.capture.created", "voice.capture.parsed",
  "quote.created", "quote.sent", "quote.expiring_soon", "quote.expired",
  "service.job.created", "service.job.delayed", "service.job.completed",
  "parts.item.received", "parts.order.status.changed",
  "rental.nearing_end", "rental.created",
  "invoice.aged_past_threshold", "ar.block.created",
  "equipment.hours_crossed_interval",
  "price_file.imported",
];

const SYSTEM_PROMPT = `You are a workflow architect for the QEP Flow Engine. You translate natural-language briefs into typed FlowWorkflowDefinition JSON.

Rules:
- Only use actions from this catalog: ${ACTION_CATALOG.join(", ")}
- Only use trigger_event_pattern from this taxonomy: ${EVENT_TAXONOMY.join(", ")}
- Conditions are an array (implicit AND). Each condition is one of:
  { op: "eq"|"neq"|"gt"|"gte"|"lt"|"lte", field: "...", value: ... }
  { op: "in"|"nin", field: "...", values: [...] }
  { op: "exists", field: "..." }
  { op: "within", field: "...", hours: N }
  { op: "no_recent_run", workflow_slug: "...", hours: N }
- Field paths walk against {event, context, payload}: e.g. "event.payload.deal_id", "context.customer_tier".
- Each action has params; values may use \${event.payload.X} placeholders that the runner resolves at execution time.
- on_failure for an action is "continue" or "abort" (default abort).
- owner_role is one of: ceo, cfo, coo, sales, service, parts, rental, accounting, shared.

Output STRICT JSON matching FlowWorkflowDefinition. No prose. No markdown fences. If the brief references an action or event that is not in the catalog, include it in a "missing" array at the top level alongside the workflow JSON, like:
{ "workflow": {...}, "missing": ["action:foo", "event:bar.baz"] }
`;

interface RequestBody {
  brief: string;
  source_module?: string;
}

async function authorizeOwner(req: Request, admin: SupabaseClient): Promise<{ ok: boolean; userId?: string; workspace?: string }> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return { ok: false };
  try {
    const { data: userRes } = await admin.auth.getUser(auth.slice(7));
    const userId = userRes?.user?.id;
    if (!userId) return { ok: false };
    const { data: profile } = await admin.from("profiles").select("role, workspace_id").eq("id", userId).maybeSingle();
    if (profile?.role !== "owner") return { ok: false };
    return { ok: true, userId, workspace: profile.workspace_id };
  } catch {
    return { ok: false };
  }
}

async function callAnthropic(brief: string): Promise<{ workflow: Record<string, unknown>; missing: string[] }> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: brief }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`anthropic ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.content?.[0]?.text ?? "";
  try {
    const parsed = JSON.parse(text);
    if (parsed.workflow) {
      return { workflow: parsed.workflow, missing: parsed.missing ?? [] };
    }
    // Bare workflow without wrapper
    return { workflow: parsed, missing: [] };
  } catch (err) {
    throw new Error(`failed to parse model output as JSON: ${(err as Error).message}. Output was: ${text.slice(0, 500)}`);
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const auth = await authorizeOwner(req, admin);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  let body: RequestBody;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  if (!body.brief || body.brief.length < 10) {
    return new Response(JSON.stringify({ error: "brief_too_short" }), {
      status: 400,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  try {
    const { workflow, missing } = await callAnthropic(body.brief);

    // Validate the action references
    const actions = Array.isArray(workflow.actions) ? workflow.actions : [];
    for (const a of actions as Array<{ action_key?: string }>) {
      if (a.action_key && !ACTION_CATALOG.includes(a.action_key)) {
        missing.push(`action:${a.action_key}`);
      }
    }

    // Insert as draft (enabled=false)
    const slug = (workflow.slug as string) ?? `synthesized-${Date.now()}`;
    const { data: inserted, error: insErr } = await admin.from("flow_workflow_definitions").insert({
      workspace_id: auth.workspace ?? "default",
      slug,
      name: workflow.name ?? "Synthesized workflow",
      description: workflow.description ?? body.brief.slice(0, 200),
      owner_role: workflow.owner_role ?? "shared",
      trigger_event_pattern: workflow.trigger_event_pattern ?? "*",
      condition_dsl: workflow.conditions ?? [],
      action_chain: workflow.actions ?? [],
      affects_modules: workflow.affects_modules ?? [],
      enabled: false, // safety: admin must explicitly enable
      dry_run: true,
      definition_hash: `synth-${Date.now()}`,
    }).select("id").maybeSingle();

    if (insErr) throw new Error(`insert: ${insErr.message}`);

    return new Response(JSON.stringify({
      ok: true,
      definition_id: inserted?.id ?? null,
      workflow,
      missing,
      brief: body.brief,
    }), {
      status: 200,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[flow-synthesize] error:", err);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }
});
