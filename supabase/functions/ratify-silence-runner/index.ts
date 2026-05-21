import { createClient } from "jsr:@supabase/supabase-js@2";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  buildRatifySilenceRationale,
  isRatifySilenceEligible,
  resolveSilenceThresholdDays,
  stampRatifySilencePacket,
  type DecisionCandidate,
  type NotificationAttempt,
} from "./logic.ts";

type RequestBody = {
  dry_run?: boolean;
  limit?: number;
  actor?: string;
  now?: string;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DECISION_OWNER_EMAIL_MAP_JSON = Deno.env.get("DECISION_OWNER_EMAIL_MAP_JSON") ?? "";

const DEFAULT_ACTOR = "ratify-silence-runner";
const DEFAULT_LIMIT = 100;

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return safeJsonError("POST only", 405, origin);

  if (!isServiceRoleCaller(req)) {
    return safeJsonError("Forbidden", 403, origin);
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return safeJsonError("Server misconfiguration", 500, origin);
    }

    const body = await req.json().catch(() => ({})) as RequestBody;
    const dryRun = body.dry_run === true;
    const limit = Math.max(1, Math.min(500, Math.floor(body.limit ?? DEFAULT_LIMIT)));
    const actor = body.actor?.trim() || DEFAULT_ACTOR;
    const now = body.now ? new Date(body.now) : new Date();

    if (Number.isNaN(now.getTime())) {
      return safeJsonError("Invalid now timestamp", 400, origin);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await admin
      .from("qep_decisions")
      .select("id, code, lane, status, owner_role, created_at, silence_threshold_days, recommended_option, ai_prep_packet")
      .in("status", ["open", "escalated"])
      .eq("lane", "ratify")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) throw new Error(`Failed to load RATIFY decisions: ${error.message}`);

    const candidates = ((data ?? []) as DecisionCandidate[])
      .filter((decision) => isRatifySilenceEligible({ decision, now }));

    const ownerEmailMap = parseOwnerEmailMap(DECISION_OWNER_EMAIL_MAP_JSON);
    const results: Array<Record<string, unknown>> = [];

    for (const decision of candidates) {
      const thresholdDays = resolveSilenceThresholdDays(decision.silence_threshold_days);
      const notificationAttempts = await attemptNotifications({
        decisionId: decision.id,
        decisionCode: decision.code,
        ownerRole: decision.owner_role,
        ownerEmailMap,
        dryRun,
      });

      const aiPrepPacket = stampRatifySilencePacket(decision.ai_prep_packet, {
        ran_at: now.toISOString(),
        actor,
        threshold_days: thresholdDays,
        notification_attempts: notificationAttempts,
      });

      if (!dryRun) {
        const { data: updatedDecision, error: updateError } = await admin
          .from("qep_decisions")
          .update({
            status: "shadow_ship",
            answered_by: actor,
            answered_at: now.toISOString(),
            answered_option: decision.recommended_option,
            answered_rationale: buildRatifySilenceRationale({
              decisionCode: decision.code,
              thresholdDays,
              actor,
            }),
            ai_prep_packet: aiPrepPacket,
          })
          .eq("id", decision.id)
          .eq("lane", "ratify")
          .in("status", ["open", "escalated"])
          .select("id, status")
          .maybeSingle();

        if (updateError) {
          results.push({
            decision_id: decision.id,
            decision_code: decision.code,
            promoted: false,
            reason: `update_failed:${updateError.message}`,
            notification_attempts: notificationAttempts,
          });
          continue;
        }

        if (!updatedDecision) {
          results.push({
            decision_id: decision.id,
            decision_code: decision.code,
            promoted: false,
            reason: "not_persisted",
            notification_attempts: notificationAttempts,
          });
          continue;
        }
      }

      results.push({
        decision_id: decision.id,
        decision_code: decision.code,
        promoted: !dryRun,
        would_promote: dryRun,
        threshold_days: thresholdDays,
        notification_attempts: notificationAttempts,
      });
    }

    return safeJsonOk(
      {
        ok: true,
        dry_run: dryRun,
        actor,
        now: now.toISOString(),
        scanned: (data ?? []).length,
        eligible: candidates.length,
        promoted_count: dryRun ? 0 : results.filter((row) => row.promoted === true).length,
        results,
      },
      origin,
    );
  } catch (error) {
    captureEdgeException(error, { fn: "ratify-silence-runner", req });
    return safeJsonError(error instanceof Error ? error.message : "Internal error", 500, origin);
  }
});

function parseOwnerEmailMap(raw: string): Record<string, string> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "string") continue;
      const ownerRole = key.trim().toLowerCase();
      const email = value.trim();
      if (ownerRole && email) out[ownerRole] = email;
    }
    return out;
  } catch {
    return {};
  }
}

async function attemptNotifications(input: {
  decisionId: string;
  decisionCode: string;
  ownerRole: string;
  ownerEmailMap: Record<string, string>;
  dryRun: boolean;
}): Promise<NotificationAttempt[]> {
  const attempts: NotificationAttempt[] = [];

  attempts.push(await invokeFunction("decision-linear-comment", {
    decision_id: input.decisionId,
    dry_run: input.dryRun,
  }, "linear_comment"));

  const ownerEmail = input.ownerEmailMap[input.ownerRole.toLowerCase()] ?? "";
  if (!ownerEmail) {
    attempts.push({
      kind: "email_card",
      attempted: false,
      ok: false,
      detail: "owner_email_missing",
    });
    return attempts;
  }

  attempts.push(await invokeFunction("decision-email-card", {
    decision_id: input.decisionId,
    recipient_email: ownerEmail,
    dry_run: input.dryRun,
  }, "email_card"));

  return attempts;
}

async function invokeFunction(
  functionName: string,
  payload: Record<string, unknown>,
  kind: NotificationAttempt["kind"],
): Promise<NotificationAttempt> {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        kind,
        attempted: true,
        ok: false,
        detail: `http_${response.status}:${detail.slice(0, 300)}`,
      };
    }

    return { kind, attempted: true, ok: true };
  } catch (error) {
    return {
      kind,
      attempted: true,
      ok: false,
      detail: error instanceof Error ? error.message : "request_failed",
    };
  }
}
