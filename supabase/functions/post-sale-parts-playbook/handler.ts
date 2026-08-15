/**
 * Post-Sale Parts Playbook handler — workspace-bound JWT + cron/service-role paths.
 *
 * JWT (rep/admin/manager/owner): always uses profiles.active_workspace_id.
 * Forged body.workspace / body.workspace_id cannot retarget generation.
 * Missing active workspace fails closed (403).
 *
 * Service role / cron: unscoped batch uses p_workspace=null (RPC → default shop).
 * Optional x-workspace-id / body workspace hints narrow to one shop.
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  createAdminClient,
  resolveCallerContext,
} from "../_shared/dge-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import { embedText, formatVectorLiteral } from "../_shared/openai-embeddings.ts";

export const CLAUDE_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 2048;
const TEMPERATURE = 0.3;
const ANTHROPIC_TIMEOUT_MS = 45_000;
const GROUNDING_MIN_HYBRID = 0.35;
const GROUNDING_MIN_COSINE = 0.45;

export const PLAYBOOK_ALLOWED_ROLES = [
  "rep",
  "admin",
  "manager",
  "owner",
] as const;

export interface SingleRequest {
  deal_id: string;
  equipment_id: string;
  refresh?: boolean;
  batch?: false;
  workspace?: string | null;
  workspace_id?: string | null;
}

export interface BatchRequest {
  batch: true;
  limit?: number;
  workspace?: string | null;
  workspace_id?: string | null;
}

export type RequestBody = SingleRequest | BatchRequest;

interface ClaudePart {
  description: string;
  qty: number;
  probability: number;
  reason: string;
}

interface ClaudeWindow {
  window: "30d" | "60d" | "90d";
  narrative: string;
  service_description: string;
  parts: ClaudePart[];
}

interface ClaudePlaybook {
  windows: ClaudeWindow[];
  assumptions: Record<string, unknown>;
}

export type PlaybookWorkspaceScope =
  | { mode: "scoped"; workspaceId: string }
  | { mode: "unscoped" };

export type PlaybookAuthResult =
  | { ok: false; status: 401 | 403 }
  | {
    ok: true;
    isServiceRole: true;
    headerWorkspaceId: string | null;
  }
  | {
    ok: true;
    isServiceRole: false;
    userId: string;
    role: string;
    workspaceId: string;
  };

export const SYSTEM_PROMPT = `You are the parts-sales AI for QEP, a heavy-equipment dealership (Yanmar, Bandit, ASV, Prinoth, Barko, Peterson).

A customer just closed on a used or new machine. The owner (you) wants to ship them a 30/60/90-day parts maintenance plan that earns the rep follow-up calls AND genuinely helps the customer keep the machine running.

You will output STRICT JSON only — no prose, no markdown:
{
  "windows": [
    { "window": "30d", "narrative": "…", "service_description": "…",
      "parts": [ { "description": "…", "qty": 1, "probability": 0.9, "reason": "…" } ] },
    { "window": "60d", "narrative": "…", "service_description": "…", "parts": [ … ] },
    { "window": "90d", "narrative": "…", "service_description": "…", "parts": [ … ] }
  ],
  "assumptions": { "hours_per_day": 6, "environment": "forestry|landscaping|construction|mixed" }
}

Hard rules:
- description is a SHORT part description in plain language (not a SKU, not a catalog number). Our system will cross-reference via semantic search. Example good: "hydraulic oil filter", "primary fuel filter", "PTO shaft grease". Example bad: "129150-35170" or "filter part number 129150".
- Every window must have at least 1 part, max 6.
- probability is 0.60-0.95. 0.90+ for scheduled-interval parts (filters at 250hrs), 0.70 for wear-pattern items, 0.60 for environmental hunches.
- narrative is ONE sentence the rep reads before calling the customer.
- service_description names the milestone: "30-hr break-in service", "250-hr first service", "seasonal filter change", "end-of-mowing-season inspection", etc.
- Skip bulk fluids (oil, grease, antifreeze) unless a specific OEM-branded kit is the typical dealer upsell.
- If the machine profile has nothing meaningful (no maintenance_schedule, no common_wear_parts), return windows with 1 generic line each ("operator inspection", "safety check") at low probability so the rep isn't fed junk.

Output ONLY the JSON object. No code fences. No explanatory text.`;

function normalizeWorkspaceId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readRequestedWorkspace(body: RequestBody): string | null {
  return normalizeWorkspaceId(body.workspace) ??
    normalizeWorkspaceId(body.workspace_id);
}

function hasAuthCredentials(req: Request): boolean {
  const authHeader = (req.headers.get("Authorization") ?? "").trim();
  const apiKey = (req.headers.get("apikey") ?? "").trim();
  const internalSecret = (req.headers.get("x-internal-service-secret") ?? "").trim();
  return authHeader.length > 0 || apiKey.length > 0 || internalSecret.length > 0;
}

export function resolvePlaybookWorkspace(params: {
  isServiceRole: boolean;
  authWorkspaceId?: string | null;
  requestedWorkspaceId?: string | null;
}): PlaybookWorkspaceScope {
  if (params.isServiceRole) {
    const explicit = normalizeWorkspaceId(params.requestedWorkspaceId) ??
      normalizeWorkspaceId(params.authWorkspaceId);
    if (explicit) {
      return { mode: "scoped", workspaceId: explicit };
    }
    return { mode: "unscoped" };
  }

  const workspaceId = normalizeWorkspaceId(params.authWorkspaceId);
  if (!workspaceId) {
    return { mode: "scoped", workspaceId: "" };
  }
  return { mode: "scoped", workspaceId };
}

/** RPC p_workspace: JWT always passes caller shop; cron unscoped passes null → default. */
export function eligibleDealsRpcWorkspace(scope: PlaybookWorkspaceScope): string | null {
  return scope.mode === "scoped" ? scope.workspaceId : null;
}

/** JWT callers scope parts grounding to their shop; cron/service-role stays unscoped. */
export function partsHybridRpcWorkspace(
  callerWorkspace: string | null,
  callerRole: string | null,
): string | null {
  return callerWorkspace !== null && callerRole !== null ? callerWorkspace : null;
}

export async function authenticatePostSalePlaybook(
  req: Request,
  adminClient: SupabaseClient,
): Promise<PlaybookAuthResult> {
  const caller = await resolveCallerContext(req, adminClient);

  if (caller.isServiceRole) {
    return {
      ok: true,
      isServiceRole: true,
      headerWorkspaceId: caller.workspaceId,
    };
  }

  if (!hasAuthCredentials(req)) {
    return { ok: false, status: 401 };
  }

  if (!caller.userId || !caller.role) {
    return { ok: false, status: 401 };
  }

  if (!PLAYBOOK_ALLOWED_ROLES.includes(caller.role)) {
    return { ok: false, status: 403 };
  }

  if (!caller.workspaceId) {
    return { ok: false, status: 403 };
  }

  return {
    ok: true,
    isServiceRole: false,
    userId: caller.userId,
    role: caller.role,
    workspaceId: caller.workspaceId,
  };
}

async function readRequestBody(req: Request): Promise<RequestBody> {
  const raw = await req.text();
  if (!raw.trim()) {
    throw new SyntaxError("Request body required");
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Request body must be a JSON object");
  }
  return parsed as RequestBody;
}

export interface PlaybookHandlerDependencies {
  createAdminClient: () => SupabaseClient;
  createServiceClient: (supabaseUrl: string, serviceKey: string) => SupabaseClient;
  authenticate: (
    req: Request,
    adminClient: SupabaseClient,
  ) => Promise<PlaybookAuthResult>;
}

const defaultDependencies: PlaybookHandlerDependencies = {
  createAdminClient: createAdminClient,
  createServiceClient: (supabaseUrl, serviceKey) => createClient(supabaseUrl, serviceKey),
  authenticate: authenticatePostSalePlaybook,
};

export async function handlePostSalePartsPlaybook(
  req: Request,
  overrides: Partial<PlaybookHandlerDependencies> = {},
): Promise<Response> {
  const {
    createAdminClient: createClientFn,
    createServiceClient,
    authenticate,
  } = {
    ...defaultDependencies,
    ...overrides,
  };

  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);

  const startMs = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!supabaseUrl || !serviceKey) {
    return safeJsonError("Missing SUPABASE_URL / SERVICE_ROLE_KEY", 500, origin);
  }
  if (!anthropicKey) {
    return safeJsonError("ANTHROPIC_API_KEY not configured", 500, origin);
  }

  const adminClient = createClientFn();

  try {
    const auth = await authenticate(req, adminClient);
    if (!auth.ok) {
      return safeJsonError(
        auth.status === 401 ? "Missing authorization" : "Forbidden",
        auth.status,
        origin,
      );
    }

    const body = await readRequestBody(req);
    const batchId = `playbook-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;

    const requestedWorkspace = readRequestedWorkspace(body);
    const workspaceScope = resolvePlaybookWorkspace({
      isServiceRole: auth.isServiceRole,
      authWorkspaceId: auth.isServiceRole
        ? auth.headerWorkspaceId
        : auth.workspaceId,
      requestedWorkspaceId: requestedWorkspace,
    });

    if (!auth.isServiceRole && workspaceScope.mode === "scoped" && !workspaceScope.workspaceId) {
      return safeJsonError("Forbidden", 403, origin);
    }

    const supabase = createServiceClient(supabaseUrl, serviceKey);

    const jwtCaller = !auth.isServiceRole
      ? {
        userId: auth.userId,
        role: auth.role,
        workspaceId: auth.workspaceId,
      }
      : null;

    // ── Batch path ───────────────────────────────────────────
    if ("batch" in body && body.batch) {
      const limit = Math.min(10, Math.max(1, body.limit ?? 5));
      const rpcWorkspace = eligibleDealsRpcWorkspace(workspaceScope);

      const { data: eligible, error: eErr } = await supabase.rpc(
        "eligible_deals_for_playbook",
        { p_workspace: rpcWorkspace, p_limit: limit },
      );
      if (eErr) throw eErr;

      const results: unknown[] = [];
      for (const row of (eligible ?? []) as Array<{
        deal_id: string;
        equipment_id: string;
      }>) {
        try {
          const gateWorkspace = jwtCaller?.workspaceId ?? null;
          const gateRole = jwtCaller?.role ?? null;
          results.push(await generateOne(
            supabase,
            anthropicKey,
            row.deal_id,
            row.equipment_id,
            batchId,
            jwtCaller?.userId ?? null,
            false,
            gateWorkspace,
            gateRole,
          ));
        } catch (err) {
          results.push({ deal_id: row.deal_id, error: (err as Error).message });
        }
      }

      return safeJsonOk({
        ok: true,
        batch_id: batchId,
        processed: results.length,
        results,
        elapsed_ms: Date.now() - startMs,
      }, origin);
    }

    // ── Single path ──────────────────────────────────────────
    const single = body as SingleRequest;
    if (!single.deal_id || !single.equipment_id) {
      return safeJsonError("deal_id and equipment_id required", 400, origin);
    }

    const gateWorkspace = jwtCaller?.workspaceId ?? null;
    const gateRole = jwtCaller?.role ?? null;

    const result = await generateOne(
      supabase,
      anthropicKey,
      single.deal_id,
      single.equipment_id,
      batchId,
      jwtCaller?.userId ?? null,
      single.refresh === true,
      gateWorkspace,
      gateRole,
    );

    return safeJsonOk({
      ok: true,
      ...result,
      elapsed_ms: Date.now() - startMs,
    }, origin);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return safeJsonError(err.message, 400, origin);
    }
    captureEdgeException(err, { fn: "post-sale-parts-playbook" });
    return safeJsonError((err as Error).message, 500, origin);
  }
}

// ── Core generator ─────────────────────────────────────────

export async function generateOne(
  supabase: SupabaseClient,
  anthropicKey: string,
  dealId: string,
  equipmentId: string,
  batchId: string,
  callerId: string | null,
  refresh: boolean,
  callerWorkspace: string | null,
  callerRole: string | null,
): Promise<Record<string, unknown>> {
  const { data: existing } = await supabase
    .from("post_sale_parts_playbooks")
    .select("id, status, payload, total_revenue, created_at, workspace_id, assigned_rep_id")
    .eq("deal_id", dealId)
    .eq("equipment_id", equipmentId)
    .is("deleted_at", null)
    .maybeSingle();

  const jwtScoped = callerWorkspace !== null && callerRole !== null;

  let equipmentQuery = supabase.from("qrm_equipment")
    .select("id, make, model, year, category, engine_hours, condition, workspace_id")
    .eq("id", equipmentId);
  if (jwtScoped) {
    equipmentQuery = equipmentQuery.eq("workspace_id", callerWorkspace);
  }

  const [dealRes, eqRes] = await Promise.all([
    supabase.from("qrm_deals")
      .select("id, name, workspace_id, company_id, assigned_rep_id, closed_at, amount")
      .eq("id", dealId).maybeSingle(),
    equipmentQuery.maybeSingle(),
  ]);
  if (dealRes.error || !dealRes.data) throw new Error("deal not found");
  if (eqRes.error || !eqRes.data) throw new Error("equipment not found");
  const deal = dealRes.data as Record<string, unknown>;
  const eq = eqRes.data as Record<string, unknown>;

  if (jwtScoped) {
    const dealWs = (deal.workspace_id as string | null) ?? "default";
    if (dealWs !== callerWorkspace) {
      throw new Error("forbidden: deal belongs to another workspace");
    }
    const eqWs = (eq.workspace_id as string | null) ?? "default";
    if (eqWs !== callerWorkspace) {
      throw new Error("equipment not found");
    }
    if (callerRole === "rep" && callerId) {
      const dealRep = (deal.assigned_rep_id as string | null) ?? null;
      if (dealRep !== callerId) {
        throw new Error("forbidden: rep can only generate playbooks for their own deals");
      }
    }
  }

  if (existing && !refresh) {
    return { playbook_id: existing.id, cached: true, status: existing.status };
  }

  const { data: companyRow } = await supabase
    .from("qrm_companies")
    .select("name, industry")
    .eq("id", deal.company_id as string)
    .maybeSingle();

  let machineProfile: Record<string, unknown> | null = null;
  if (eq.make && eq.model) {
    const { data: profiles } = await supabase
      .from("machine_profiles")
      .select("id, manufacturer, model, model_family, category, maintenance_schedule, common_wear_parts, fluid_capacities")
      .ilike("manufacturer", eq.make as string)
      .ilike("model", `%${eq.model as string}%`)
      .is("deleted_at", null)
      .limit(1);
    machineProfile = profiles?.[0] ?? null;
  }

  const userMessage = buildPrompt(deal, eq, companyRow, machineProfile);
  const claudeResp = await callClaude(anthropicKey, SYSTEM_PROMPT, userMessage);
  const parsed = parseClaudeJson(claudeResp.text);

  const groundedWindows: Array<Record<string, unknown>> = [];
  let grandTotal = 0;
  const partsWorkspace = partsHybridRpcWorkspace(callerWorkspace, callerRole);
  for (const w of parsed.windows) {
    const hints = w.parts.map((p) => ({
      part: p,
      hint: `${eq.make ?? ""} ${eq.model ?? ""} ${p.description}`.trim(),
    }));

    const settled = await Promise.all(
      hints.map(async ({ part, hint }) => {
        try {
          const embedding = await embedText(hint);
          const vectorLiteral = formatVectorLiteral(embedding);
          const { data } = await supabase.rpc("match_parts_hybrid", {
            p_query_embedding: vectorLiteral,
            p_query_text: hint,
            p_workspace: partsWorkspace,
            p_manufacturer: (eq.make as string) ?? null,
            p_category: null,
            p_alpha: 0.6,
            p_match_count: 1,
          });
          const top = data?.[0];
          if (!top) return null;
          const cosine = Number(top.cosine_similarity) || 0;
          const hybrid = Number(top.hybrid_score) || 0;
          if (hybrid < GROUNDING_MIN_HYBRID && cosine < GROUNDING_MIN_COSINE) return null;

          const unitPrice = Number(top.list_price ?? top.pricing_level_1 ?? 0);
          const qty = Math.max(1, Math.min(10, part.qty));
          const total = unitPrice * qty;
          return {
            part_number: top.part_number,
            description: top.description ?? part.description,
            qty,
            unit_price: unitPrice,
            total,
            on_hand: top.on_hand ?? 0,
            probability: Math.max(0, Math.min(1, part.probability)),
            reason: part.reason,
            match_score: cosine,
          };
        } catch (err) {
          console.warn(`[post-sale-playbook] grounding failed for "${hint}":`, err);
          return null;
        }
      }),
    );

    const grounded = settled.filter((r) => r != null) as Array<Record<string, unknown>>;
    const winTotal = grounded.reduce(
      (sum, r) => sum + (Number(r.total) || 0),
      0,
    );
    groundedWindows.push({
      window: w.window,
      narrative: w.narrative,
      service_description: w.service_description,
      parts: grounded,
      total_revenue: Number(winTotal.toFixed(2)),
    });
    grandTotal += winTotal;
  }

  const payload = {
    windows: groundedWindows,
    grand_total_revenue: Number(grandTotal.toFixed(2)),
    assumptions: parsed.assumptions,
    generated_at: new Date().toISOString(),
    machine_profile_id: machineProfile?.id ?? null,
    model_family: machineProfile?.model_family ?? null,
    customer_name: companyRow?.name ?? null,
  };

  const { data: upserted, error: upErr } = await supabase
    .from("post_sale_parts_playbooks")
    .upsert({
      workspace_id: deal.workspace_id,
      deal_id: dealId,
      equipment_id: equipmentId,
      machine_profile_id: (machineProfile?.id as string | undefined) ?? null,
      company_id: (deal.company_id as string | undefined) ?? null,
      assigned_rep_id: (deal.assigned_rep_id as string | undefined) ?? null,
      payload,
      status: "draft",
      generated_by: CLAUDE_MODEL,
      generation_batch_id: batchId,
      tokens_in: claudeResp.tokens_in,
      tokens_out: claudeResp.tokens_out,
    }, { onConflict: "deal_id,equipment_id" })
    .select("id, status, total_revenue")
    .single();

  if (upErr) throw upErr;

  return {
    playbook_id: upserted.id,
    status: upserted.status,
    total_revenue: upserted.total_revenue,
    window_count: groundedWindows.length,
    parts_count: groundedWindows.reduce(
      (s, w) => s + ((w.parts as unknown[])?.length ?? 0), 0),
    cached: false,
  };
}

function buildPrompt(
  deal: Record<string, unknown>,
  eq: Record<string, unknown>,
  company: Record<string, unknown> | null | undefined,
  profile: Record<string, unknown> | null,
): string {
  const lines: string[] = [];
  lines.push("DEAL JUST CLOSED:");
  lines.push(`  Name: ${deal.name ?? "(unnamed)"}`);
  lines.push(`  Amount: $${deal.amount ?? "?"}`);
  if (deal.closed_at) lines.push(`  Closed: ${deal.closed_at}`);

  lines.push("\nEQUIPMENT SOLD:");
  lines.push(`  ${eq.year ?? "?"} ${eq.make ?? "?"} ${eq.model ?? "?"}`);
  if (eq.category) lines.push(`  Category: ${eq.category}`);
  if (eq.condition) lines.push(`  Condition: ${eq.condition}`);
  if (eq.engine_hours != null) lines.push(`  Engine hours at sale: ${eq.engine_hours}`);

  lines.push("\nCUSTOMER:");
  lines.push(`  ${company?.name ?? "(name unknown)"}`);
  if (company?.industry) lines.push(`  Industry: ${company.industry}`);

  if (profile) {
    lines.push("\nMACHINE PROFILE:");
    if (profile.maintenance_schedule) {
      lines.push("  Maintenance schedule:");
      lines.push(`    ${JSON.stringify(profile.maintenance_schedule).slice(0, 1500)}`);
    }
    if (profile.common_wear_parts) {
      lines.push("  Common wear parts:");
      lines.push(`    ${JSON.stringify(profile.common_wear_parts).slice(0, 1000)}`);
    }
  } else {
    lines.push("\nMACHINE PROFILE: none on file.");
  }

  lines.push(
    "\nDraft a 30/60/90-day parts maintenance plan. STRICT JSON per the schema above.",
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

function parseClaudeJson(raw: string): ClaudePlaybook {
  let s = raw.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  const parsed = JSON.parse(s);
  if (!parsed || !Array.isArray(parsed.windows)) throw new Error("windows array missing");
  return parsed as ClaudePlaybook;
}
