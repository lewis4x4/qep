import { createClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { resolveDecisionMagicLinkSecret, verifyDecisionMagicToken } from "../_shared/decision-magic-link.ts";
import { buildDecisionMagicActionPatch } from "./logic.ts";

type AdminClient = any;

type DecisionRow = {
  id: string;
  code: string;
  owner_role: string;
  status: string;
  recommended_option: string | null;
  ai_prep_packet: Record<string, unknown> | null;
};

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (!["GET", "POST"].includes(req.method)) return safeJsonError("GET or POST only", 405, origin);

  try {
    const token = await resolveToken(req);
    if (!token) return safeJsonError("Missing token", 400, origin);

    const secret = resolveDecisionMagicLinkSecret();
    const payload = await verifyDecisionMagicToken(token, secret);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return safeJsonError("Server misconfiguration", 500, origin);
    const admin: AdminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let query = admin
      .from("qep_decisions")
      .select("id, code, owner_role, status, recommended_option, ai_prep_packet")
      .limit(1);

    if (payload.decision_id) query = query.eq("id", payload.decision_id);
    else query = query.eq("code", payload.decision_code);

    const { data: decision, error } = await query.maybeSingle();
    if (error) return safeJsonError(`Failed to load decision: ${error.message}`, 500, origin);
    if (!decision) return safeJsonError("Decision not found", 404, origin);

    const row = decision as DecisionRow;
    if (payload.decision_code && payload.decision_code !== row.code) {
      return safeJsonError("Decision token mismatch", 400, origin);
    }
    if (payload.owner_role !== row.owner_role) {
      return safeJsonError("Decision owner mismatch", 400, origin);
    }

    const patch = buildDecisionMagicActionPatch({
      action: payload.action,
      ownerRole: payload.owner_role,
      recommendedOption: row.recommended_option,
      existingPacket: row.ai_prep_packet,
    });

    const { error: updateError } = await admin
      .from("qep_decisions")
      .update(patch)
      .eq("id", row.id);

    if (updateError) {
      return safeJsonError(`Failed to apply decision action: ${updateError.message}`, 500, origin);
    }

    if (req.method === "GET") {
      return new Response(renderHtml(row.code, payload.action), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return safeJsonOk({
      ok: true,
      decision_id: row.id,
      decision_code: row.code,
      action: payload.action,
      status: patch.status,
    }, origin);
  } catch (error) {
    captureEdgeException(error, { fn: "decision-magic-link", req });
    return safeJsonError(error instanceof Error ? error.message : "Internal error", 400, origin);
  }
});

async function resolveToken(req: Request): Promise<string | null> {
  const url = new URL(req.url);
  const queryToken = url.searchParams.get("token")?.trim();
  if (queryToken) return queryToken;

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({})) as { token?: string };
    if (typeof body.token === "string" && body.token.trim()) return body.token.trim();
  }

  return null;
}

function renderHtml(code: string, action: string): string {
  const safeCode = escapeHtml(code);
  const safeAction = escapeHtml(action);
  return `<!doctype html>
<html>
  <body style="font-family: Arial, sans-serif; padding: 20px; color: #111;">
    <h2>Decision action applied</h2>
    <p><strong>${safeAction}</strong> has been recorded for decision <strong>${safeCode}</strong>.</p>
    <p>You can now return to QEP.</p>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
