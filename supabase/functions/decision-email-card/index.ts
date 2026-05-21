import { createClient } from "jsr:@supabase/supabase-js@2";
import { optionsResponse, safeJsonError, safeJsonOk } from "../_shared/safe-cors.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { requireServiceUser } from "../_shared/service-auth.ts";
import { captureEdgeException } from "../_shared/sentry.ts";
import { decryptOneDriveToken } from "../_shared/integration-crypto.ts";
import {
  buildSignedDecisionActionLink,
  resolveDecisionMagicLinkSecret,
  type DecisionMagicAction,
} from "../_shared/decision-magic-link.ts";

type AdminClient = any;

type RequestBody = {
  decision_id?: string;
  decision_code?: string;
  recipient_email?: string;
  sender_user_id?: string;
  sync_state_id?: string;
  dry_run?: boolean;
  action_base_url?: string;
};

type DecisionRow = {
  id: string;
  code: string;
  question_plain: string;
  lane: string;
  owner_role: string;
  recommended_option: string | null;
  recommended_rationale: string | null;
  citations: unknown;
};

type SyncStateRow = {
  id: string;
  user_id: string | null;
  access_token: string | null;
  token_expires_at: string | null;
};

const GRAPH_SEND_MAIL_URL = "https://graph.microsoft.com/v1.0/me/sendMail";

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return safeJsonError("Server misconfiguration", 500, origin);

    const body = await req.json().catch(() => ({})) as RequestBody;
    const recipientEmail = body.recipient_email?.trim();
    if (!recipientEmail) return safeJsonError("recipient_email is required", 400, origin);

    const actionBaseUrl = body.action_base_url?.trim() ?? Deno.env.get("DECISION_MAGIC_LINK_BASE_URL")?.trim() ?? "";
    if (!actionBaseUrl) return safeJsonError("action_base_url (or DECISION_MAGIC_LINK_BASE_URL) is required", 400, origin);

    const admin: AdminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const decision = await loadDecision(admin, body);
    if (!decision) return safeJsonError("Decision not found", 404, origin);

    const secret = resolveDecisionMagicLinkSecret();
    const links = await buildActionLinks(actionBaseUrl, decision, secret);

    const card = buildDecisionCardHtml(decision, links);
    if (body.dry_run === true) {
      return safeJsonOk({
        ok: true,
        dry_run: true,
        recipient_email: recipientEmail,
        decision_id: decision.id,
        decision_code: decision.code,
        links,
        html: card,
      }, origin);
    }

    const syncState = await resolveSyncState(admin, body);
    if (!syncState || !syncState.access_token) {
      return safeJsonError("No usable onedrive_sync_state token found", 400, origin);
    }
    if (syncState.token_expires_at && Date.parse(syncState.token_expires_at) <= Date.now()) {
      return safeJsonError("Selected M365 access token is expired", 400, origin);
    }

    const accessToken = await decryptOneDriveToken(syncState.access_token);
    await sendGraphMail(accessToken, recipientEmail, decision, card);

    return safeJsonOk({
      ok: true,
      dry_run: false,
      decision_id: decision.id,
      decision_code: decision.code,
      recipient_email: recipientEmail,
      sync_state_id: syncState.id,
      links,
    }, origin);
  } catch (error) {
    captureEdgeException(error, { fn: "decision-email-card", req });
    return safeJsonError(error instanceof Error ? error.message : "Internal error", 500, origin);
  }
});

async function loadDecision(admin: AdminClient, body: RequestBody): Promise<DecisionRow | null> {
  let query = admin
    .from("qep_decisions")
    .select("id, code, question_plain, lane, owner_role, recommended_option, recommended_rationale, citations")
    .limit(1);

  if (body.decision_id) query = query.eq("id", body.decision_id);
  else if (body.decision_code) query = query.eq("code", body.decision_code);
  else throw new Error("decision_id or decision_code is required");

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Failed to load decision: ${error.message}`);
  return (data as DecisionRow | null) ?? null;
}

async function resolveSyncState(admin: AdminClient, body: RequestBody): Promise<SyncStateRow | null> {
  let query = admin
    .from("onedrive_sync_state")
    .select("id, user_id, access_token, token_expires_at")
    .not("access_token", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (body.sync_state_id) query = query.eq("id", body.sync_state_id);
  else if (body.sender_user_id) query = query.eq("user_id", body.sender_user_id);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Failed to load onedrive_sync_state: ${error.message}`);
  return (data as SyncStateRow | null) ?? null;
}

async function buildActionLinks(
  actionBaseUrl: string,
  decision: DecisionRow,
  secret: string,
): Promise<Record<DecisionMagicAction, { url: string; token: string; exp: number }>> {
  const build = (action: DecisionMagicAction) => buildSignedDecisionActionLink(
    actionBaseUrl,
    {
      decision_id: decision.id,
      decision_code: decision.code,
      action,
      owner_role: decision.owner_role,
      nonce: crypto.randomUUID(),
    },
    secret,
    60 * 60 * 24,
  );

  const [approve, block, need_info] = await Promise.all([
    build("approve"),
    build("block"),
    build("need_info"),
  ]);
  return { approve, block, need_info };
}

function buildDecisionCardHtml(
  decision: DecisionRow,
  links: Record<DecisionMagicAction, { url: string; token: string; exp: number }>,
): string {
  const citations = normalizeCitations(decision.citations);
  const citationList = citations.length
    ? `<ul>${citations.map((c) => `<li><strong>${escapeHtml(c.source)}</strong>: ${escapeHtml(c.excerpt)}</li>`).join("")}</ul>`
    : "<p>No citations provided.</p>";

  return `<!doctype html>
<html>
  <body style="font-family: Arial, sans-serif; color: #111;">
    <div style="max-width: 680px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px;">
      <h2 style="margin-top: 0;">Decision Needed: ${escapeHtml(decision.code)}</h2>
      <p>${escapeHtml(decision.question_plain)}</p>
      <p><strong>Lane:</strong> ${escapeHtml(decision.lane)}<br/>
      <strong>Owner:</strong> ${escapeHtml(decision.owner_role)}</p>
      <p><strong>Recommendation:</strong> ${escapeHtml(decision.recommended_option ?? "n/a")}</p>
      <p><strong>Rationale:</strong> ${escapeHtml(decision.recommended_rationale ?? "n/a")}</p>
      <h3>Citations</h3>
      ${citationList}
      <div style="display: flex; gap: 10px; margin-top: 18px;">
        ${buttonHtml("Approve", links.approve.url, "#15803d")}
        ${buttonHtml("Block", links.block.url, "#b91c1c")}
        ${buttonHtml("Need info", links.need_info.url, "#1d4ed8")}
      </div>
    </div>
  </body>
</html>`;
}

function buttonHtml(label: string, href: string, color: string): string {
  return `<a href="${escapeHtml(href)}" style="background:${color};color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;font-weight:600;">${escapeHtml(label)}</a>`;
}

function normalizeCitations(value: unknown): Array<{ source: string; excerpt: string }> {
  if (!Array.isArray(value)) return [];
  const rows: Array<{ source: string; excerpt: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const source = typeof record.source === "string" ? record.source : "citation";
    const excerpt = typeof record.excerpt === "string" ? record.excerpt : JSON.stringify(record);
    rows.push({ source, excerpt });
  }
  return rows;
}

async function sendGraphMail(
  accessToken: string,
  recipientEmail: string,
  decision: DecisionRow,
  cardHtml: string,
): Promise<void> {
  const response = await fetch(GRAPH_SEND_MAIL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject: `QEP Decision Required: ${decision.code}`,
        body: {
          contentType: "HTML",
          content: cardHtml,
        },
        toRecipients: [{ emailAddress: { address: recipientEmail } }],
      },
      saveToSentItems: true,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = String((payload as Record<string, any>)?.error?.message ?? "unknown error");
    throw new Error(`Microsoft Graph sendMail failed (${response.status}): ${message.slice(0, 500)}`);
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
