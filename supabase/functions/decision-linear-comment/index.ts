import { createClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  buildRecommendationComment,
  identifierFromLinearUrl,
  parseOwnerMentionMap,
  resolveLinearIssueFromPacket,
  type DecisionRow,
  type LinearIssueRef,
} from "./logic.ts";

type AdminClient = any;

type RequestBody = {
  decision_id?: string;
  decision_code?: string;
  dry_run?: boolean;
};

type RoadmapIssueRow = {
  task_id: string;
  linear_issue_id: string | null;
  linear_issue_identifier: string | null;
  linear_url: string | null;
};

const LINEAR_API_URL = "https://api.linear.app/graphql";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("POST only", 405, origin);

  try {
    const serviceCaller = isServiceRoleCaller(req);
    if (!serviceCaller) {
      const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
      if (!auth.ok) return auth.response;
      if (!["admin", "manager", "owner"].includes(auth.role)) {
        return safeJsonError("Forbidden", 403, origin);
      }
    }

    const linearApiKey = Deno.env.get("LINEAR_API_KEY")?.trim();
    if (!linearApiKey) return safeJsonError("LINEAR_API_KEY is not configured", 500, origin);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
    if (!supabaseUrl || !serviceKey) return safeJsonError("Server misconfiguration", 500, origin);

    const body = await req.json().catch(() => ({})) as RequestBody;
    const admin: AdminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const decision = await loadDecision(admin, body);
    if (!decision) return safeJsonError("Decision not found", 404, origin);

    const issueRef = await resolveIssueRef(admin, linearApiKey, decision);
    if (!issueRef.issueId) {
      return safeJsonError(
        `Linear issue mapping not found for decision ${decision.code}. Provide linear_issue_id on the linked roadmap task or in ai_prep_packet.`,
        400,
        origin,
      );
    }

    const ownerMentionMap = parseOwnerMentionMap(Deno.env.get("LINEAR_OWNER_MENTION_MAP_JSON"));
    const ownerMention = ownerMentionMap[decision.owner_role.toLowerCase()] ?? null;
    const commentBody = buildRecommendationComment({
      decision,
      ownerMention,
      issueRef,
    });

    if (body.dry_run === true) {
      return safeJsonOk({
        ok: true,
        dry_run: true,
        decision_id: decision.id,
        decision_code: decision.code,
        linear_issue_id: issueRef.issueId,
        linear_issue_identifier: issueRef.issueIdentifier,
        linear_issue_url: issueRef.issueUrl,
        owner_mention: ownerMention,
        comment_body: commentBody,
      }, origin);
    }

    await postLinearComment(linearApiKey, issueRef.issueId, commentBody);

    return safeJsonOk({
      ok: true,
      dry_run: false,
      decision_id: decision.id,
      decision_code: decision.code,
      linear_issue_id: issueRef.issueId,
      linear_issue_identifier: issueRef.issueIdentifier,
      linear_issue_url: issueRef.issueUrl,
      owner_mention: ownerMention,
    }, origin);
  } catch (error) {
    captureEdgeException(error, { fn: "decision-linear-comment", req });
    return safeJsonError(error instanceof Error ? error.message : "Internal error", 500, origin);
  }
});

async function loadDecision(admin: AdminClient, body: RequestBody): Promise<(DecisionRow & { ai_prep_packet: unknown }) | null> {
  let query = admin
    .from("qep_decisions")
    .select("id, code, question_plain, owner_role, recommended_option, recommended_rationale, ai_prep_packet")
    .eq("status", "open")
    .limit(1);

  if (body.decision_id?.trim()) query = query.eq("id", body.decision_id.trim());
  else if (body.decision_code?.trim()) query = query.eq("code", body.decision_code.trim());
  else throw new Error("decision_id or decision_code is required");

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Failed to load decision: ${error.message}`);
  return (data as (DecisionRow & { ai_prep_packet: unknown }) | null) ?? null;
}

async function resolveIssueRef(
  admin: AdminClient,
  linearApiKey: string,
  decision: DecisionRow & { ai_prep_packet: unknown },
): Promise<LinearIssueRef> {
  const fromPacket = resolveLinearIssueFromPacket(decision.ai_prep_packet);
  if (fromPacket.issueId) {
    return { ...fromPacket, source: "decision_packet" };
  }

  const { data, error } = await admin
    .from("qep_roadmap_tasks")
    .select("task_id, linear_issue_id, linear_issue_identifier, linear_url")
    .eq("blocking_decision", decision.code)
    .not("linear_issue_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to load roadmap task mapping: ${error.message}`);

  const taskRow = (data as RoadmapIssueRow | null);
  const fromTask = {
    issueId: taskRow?.linear_issue_id ?? null,
    issueIdentifier: taskRow?.linear_issue_identifier ?? null,
    issueUrl: taskRow?.linear_url ?? null,
  };

  const issueIdentifier = fromPacket.issueIdentifier ?? fromTask.issueIdentifier ?? identifierFromLinearUrl(fromPacket.issueUrl) ??
    identifierFromLinearUrl(fromTask.issueUrl);

  let issueId = fromTask.issueId;
  let issueUrl = fromPacket.issueUrl ?? fromTask.issueUrl;

  if (!issueId && issueIdentifier) {
    const resolved = await resolveLinearIssueByIdentifier(linearApiKey, issueIdentifier);
    issueId = resolved?.id ?? null;
    issueUrl = issueUrl ?? resolved?.url ?? null;
  }

  return {
    issueId,
    issueIdentifier,
    issueUrl,
    source: "roadmap_task",
    taskId: taskRow?.task_id ?? null,
  };
}

async function resolveLinearIssueByIdentifier(
  linearApiKey: string,
  identifier: string,
): Promise<{ id: string; url: string | null } | null> {
  const data = await linearGql(linearApiKey, `
    query ResolveIssueByIdentifier($identifier: String!) {
      issues(filter: { identifier: { eq: $identifier } }, first: 1) {
        nodes { id identifier url }
      }
    }
  `, { identifier });

  const issue = data?.issues?.nodes?.[0];
  if (!issue?.id) return null;
  return { id: String(issue.id), url: typeof issue.url === "string" ? issue.url : null };
}

async function postLinearComment(linearApiKey: string, issueId: string, body: string): Promise<void> {
  await linearGql(linearApiKey, `
    mutation PostRecommendationComment($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
      }
    }
  `, {
    input: {
      issueId,
      body,
    },
  });
}

async function linearGql(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<any> {
  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Linear HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  const payload = await response.json();
  if (payload.errors) {
    throw new Error(`Linear GraphQL error: ${JSON.stringify(payload.errors).slice(0, 500)}`);
  }
  return payload.data;
}
