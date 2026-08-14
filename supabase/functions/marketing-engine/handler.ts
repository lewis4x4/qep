/**
 * Marketing Engine handler — workspace-scoped triggers and campaigns.
 *
 * Auth contract (verify_jwt=false on gateway; in-function auth is authoritative):
 *
 * - JWT (admin/manager/owner): always bound to profiles.active_workspace_id.
 *   Body `workspace_id` is ignored so a forged target cannot widen scope.
 * - Service role (cron): processes all active triggers when unscoped. Optional
 *   `workspace_id` in JSON body or `x-workspace-id` header may narrow to one shop.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createAdminClient, resolveCallerContext } from "../_shared/dge-auth.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import type {
  CampaignTriggerContext,
  MarketingCampaignPlan,
} from "../../../shared/qep-moonshot-contracts.ts";

export type MarketingWorkspaceScope =
  | { mode: "scoped"; workspaceId: string }
  | { mode: "unscoped" };

export type MarketingEngineAuthResult =
  | { ok: false; status: 401 | 403 }
  | { ok: true; isServiceRole: true; headerWorkspaceId: string | null }
  | {
    ok: true;
    isServiceRole: false;
    userId: string;
    role: string;
    workspaceId: string;
  };

export interface MarketingEngineBody {
  action?: string;
  campaign_id?: string;
  workspace_id?: string;
}

export interface MarketingEngineResults {
  triggers_processed: number;
  campaigns_created: number;
  content_generated: number;
  posts_scheduled: number;
}

function normalizeWorkspaceId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function resolveMarketingEngineWorkspace(params: {
  isServiceRole: boolean;
  authWorkspaceId?: string | null;
  requestedWorkspaceId?: string | null;
}): MarketingWorkspaceScope {
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

function hasAuthCredentials(req: Request): boolean {
  const authHeader = (req.headers.get("Authorization") ?? "").trim();
  const apiKey = (req.headers.get("apikey") ?? "").trim();
  return authHeader.length > 0 || apiKey.length > 0;
}

export async function authenticateMarketingEngine(
  req: Request,
  adminClient: SupabaseClient,
): Promise<MarketingEngineAuthResult> {
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

  if (!["admin", "manager", "owner"].includes(caller.role)) {
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

function applyWorkspaceFilter<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  workspaceScope: MarketingWorkspaceScope,
  column = "workspace_id",
): T {
  if (workspaceScope.mode === "scoped") {
    return query.eq(column, workspaceScope.workspaceId);
  }
  return query;
}

export async function generateCampaignContent(
  trigger: CampaignTriggerContext,
  openAiApiKey: string | undefined = Deno.env.get("OPENAI_API_KEY"),
  fetchImpl: typeof fetch = fetch,
): Promise<{ subject: string; body: string; social_copy: string }> {
  if (!openAiApiKey) {
    return {
      subject: `New from QEP: ${trigger.triggerType.replace(/_/g, " ")}`,
      body: "Check out our latest offerings at Quality Equipment Parts.",
      social_copy: "New equipment available at QEP! Contact us for details.",
    };
  }

  try {
    const res = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [{
          role: "system",
          content: `You are a marketing content generator for QEP (Quality Equipment Parts), a heavy equipment dealership. Generate compelling, professional marketing content.

Return JSON: { "subject": "email subject", "body": "email body (2-3 paragraphs)", "social_copy": "Facebook/social post (2-3 sentences)" }`,
        }, {
          role: "user",
          content: `Campaign type: ${trigger.triggerType}\nTarget: ${JSON.stringify(trigger.targetSegment)}\nEquipment: ${JSON.stringify(trigger.equipmentContext)}\nTrigger config: ${JSON.stringify(trigger.triggerConfig ?? {})}`,
        }],
        max_tokens: 500,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return { subject: "QEP Update", body: "Contact us for details.", social_copy: "New at QEP!" };

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { subject: "QEP Update", body: "Contact us.", social_copy: "New at QEP!" };

    return JSON.parse(content);
  } catch {
    return { subject: "QEP Update", body: "Contact us for details.", social_copy: "New at QEP!" };
  }
}

export interface MarketingEngineHandlerDependencies {
  createAdminClient: () => SupabaseClient;
  authenticate: (
    req: Request,
    adminClient: SupabaseClient,
  ) => Promise<MarketingEngineAuthResult>;
  generateContent: typeof generateCampaignContent;
}

const defaultDependencies: MarketingEngineHandlerDependencies = {
  createAdminClient: () => createAdminClient(),
  authenticate: authenticateMarketingEngine,
  generateContent: generateCampaignContent,
};

async function processTriggers(
  supabaseAdmin: SupabaseClient,
  workspaceScope: MarketingWorkspaceScope,
  generateContent: typeof generateCampaignContent,
): Promise<Pick<MarketingEngineResults, "triggers_processed" | "campaigns_created">> {
  const results = {
    triggers_processed: 0,
    campaigns_created: 0,
  };

  let query = supabaseAdmin
    .from("inventory_event_triggers")
    .select("*")
    .eq("is_active", true);
  query = applyWorkspaceFilter(query, workspaceScope);

  const { data: triggers } = await query;
  if (!triggers) return results;

  for (const trigger of triggers) {
    results.triggers_processed++;

    if (!trigger.auto_create_campaign) continue;

    const triggerContext: CampaignTriggerContext = {
      triggerType: trigger.event_type === "new_arrival" ? "inventory_arrival" : "custom",
      workspaceId: trigger.workspace_id,
      targetSegment: trigger.target_segment || {},
      equipmentContext: trigger.equipment_filter || null,
      triggerConfig: { trigger_id: trigger.id },
    };
    const content = await generateContent(triggerContext);
    const campaignPlan: MarketingCampaignPlan = {
      name: `Auto: ${trigger.event_type.replace(/_/g, " ")} — ${new Date().toISOString().split("T")[0]}`,
      campaignType: triggerContext.triggerType,
      targetSegment: triggerContext.targetSegment,
      contentTemplate: content,
      aiGenerated: true,
      channels: ["email"],
      status: "scheduled",
      triggerType: "inventory_event",
      triggerConfig: triggerContext.triggerConfig,
    };

    const { data: campaign } = await supabaseAdmin
      .from("marketing_campaigns")
      .insert({
        workspace_id: trigger.workspace_id,
        name: campaignPlan.name,
        campaign_type: campaignPlan.campaignType,
        target_segment: campaignPlan.targetSegment,
        content_template: campaignPlan.contentTemplate,
        ai_generated: campaignPlan.aiGenerated,
        channels: campaignPlan.channels,
        status: campaignPlan.status,
        trigger_type: campaignPlan.triggerType,
        trigger_config: campaignPlan.triggerConfig,
      })
      .select("id")
      .maybeSingle();

    if (campaign) results.campaigns_created++;

    await supabaseAdmin
      .from("inventory_event_triggers")
      .update({
        last_triggered_at: new Date().toISOString(),
        trigger_count: (trigger.trigger_count || 0) + 1,
      })
      .eq("id", trigger.id);
  }

  return results;
}

async function generateContentForCampaign(
  supabaseAdmin: SupabaseClient,
  workspaceScope: MarketingWorkspaceScope,
  campaignId: string,
  generateContent: typeof generateCampaignContent,
): Promise<{ ok: true } | { ok: false; status: 404 }> {
  let query = supabaseAdmin
    .from("marketing_campaigns")
    .select("*")
    .eq("id", campaignId);
  query = applyWorkspaceFilter(query, workspaceScope);

  const { data: campaign } = await query.maybeSingle();
  if (!campaign) {
    return { ok: false, status: 404 };
  }

  const content = await generateContent({
    triggerType: campaign.campaign_type,
    workspaceId: campaign.workspace_id,
    targetSegment: campaign.target_segment || {},
    equipmentContext: null,
  });

  await supabaseAdmin
    .from("marketing_campaigns")
    .update({
      content_template: content,
      ai_generated: true,
    })
    .eq("id", campaignId);

  return { ok: true };
}

export async function handleMarketingEngine(
  req: Request,
  overrides: Partial<MarketingEngineHandlerDependencies> = {},
): Promise<Response> {
  const { createAdminClient: createClientFn, authenticate, generateContent } = {
    ...defaultDependencies,
    ...overrides,
  };

  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return optionsResponse(origin);
  }

  if (req.method !== "POST") {
    return safeJsonError("Method not allowed", 405, origin);
  }

  const adminClient = createClientFn();
  const auth = await authenticate(req, adminClient);
  if (!auth.ok) {
    return safeJsonError(auth.status === 401 ? "Unauthorized" : "Forbidden", auth.status, origin);
  }

  let body: MarketingEngineBody = {};
  try {
    body = await req.json();
  } catch {
    // empty body ok for cron
  }

  const workspaceScope = auth.isServiceRole
    ? resolveMarketingEngineWorkspace({
      isServiceRole: true,
      authWorkspaceId: auth.headerWorkspaceId,
      requestedWorkspaceId: body.workspace_id,
    })
    : resolveMarketingEngineWorkspace({
      isServiceRole: false,
      authWorkspaceId: auth.workspaceId,
      requestedWorkspaceId: body.workspace_id,
    });

  if (workspaceScope.mode === "scoped" && !workspaceScope.workspaceId) {
    return safeJsonError("Forbidden", 403, origin);
  }

  const results: MarketingEngineResults = {
    triggers_processed: 0,
    campaigns_created: 0,
    content_generated: 0,
    posts_scheduled: 0,
  };

  if (!body.action || body.action === "process_triggers") {
    const triggerResults = await processTriggers(adminClient, workspaceScope, generateContent);
    results.triggers_processed = triggerResults.triggers_processed;
    results.campaigns_created = triggerResults.campaigns_created;
  }

  if (body.action === "generate_content" && body.campaign_id) {
    const contentResult = await generateContentForCampaign(
      adminClient,
      workspaceScope,
      body.campaign_id,
      generateContent,
    );
    if (!contentResult.ok) {
      return safeJsonError("Campaign not found", 404, origin);
    }
    results.content_generated++;
  }

  return safeJsonOk({ ok: true, results }, origin);
}
