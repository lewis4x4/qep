/**
 * Inbound-Email Signal Adapter (Slice 3)
 *
 * Accepts a minimal, provider-agnostic email-arrival payload and turns it
 * into an `inbound_email` signal on the normalized feed. The recommender
 * (`recommend-moves`) picks it up on the next tick and converts it into a
 * Today-surface move (usually `call_now`).
 *
 * This function is deliberately NOT a Gmail/SendGrid/HubSpot webhook shim —
 * the existing webhook handlers parse their respective payloads and deliver
 * here with a stable shape. That keeps the signal adapter reusable across
 * providers (and across future MCP-style email sources) without reimagining
 * HMAC schemes per-provider.
 *
 * Callable by:
 *   1. Internal adapters (hubspot-webhook, sendgrid-webhook, future gmail
 *      push) via `x-internal-service-secret`.
 *   2. Admin/manager/owner users with a JWT, for manual triage backfills.
 *
 * Idempotency:
 *   Every upstream email has a stable message-id. We use `email:{messageId}`
 *   as the signal's dedupe_key, so a webhook re-delivery is a no-op.
 *
 * Contact linking:
 *   We resolve `from_email` against `crm_contacts` by email (case-insensitive,
 *   workspace-scoped) to stamp entity_type="contact" / entity_id on the
 *   signal. If no match, we still ingest with entity_type=null — the
 *   recommender handles both shapes, and a future "unknown sender triage"
 *   rule can pick up the null-entity case.
 *
 * Response:
 *   { ok, signal, matchedContactId }
 */

import { createAdminClient, resolveCallerContext } from "../_shared/dge-auth.ts";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { ingestSignal, type SignalSeverity } from "../_shared/qrm-signals.ts";
import type { RouterCtx } from "../_shared/crm-router-service.ts";

const ALLOWED_ORIGINS = [
  "https://qualityequipmentparts.netlify.app",
  "https://qep.blackrockai.co",
  "http://localhost:5173",
];

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : "",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-internal-service-secret",
    "Vary": "Origin",
  };
}

interface EmailSignalPayload {
  /** Workspace the email belongs to. Required — the canonical dispatcher
   *  loop is expected to know which workspace owns each inbox. */
  workspaceId: string;
  /** Stable upstream message id; used as the signal dedupe_key. */
  messageId: string;
  /** Envelope/header From address. */
  fromEmail: string;
  /** Optional display name from header. */
  fromName?: string | null;
  /** Envelope/header To address (the dealership's inbox). */
  toEmail?: string | null;
  subject: string;
  /** First ~500 chars of the body; avoids bloating the signal row. */
  bodyPreview?: string | null;
  /** RFC-2822 date in the header, if present. Falls back to now(). */
  receivedAt?: string | null;
  /** Provider tag: "gmail" | "hubspot" | "sendgrid" | "imap" | etc. */
  source?: string | null;
  /** Pre-classified severity; defaults to "medium" in ingestSignal. */
  severity?: SignalSeverity;
}

function bad(status: number, code: string, message: string, ch: Record<string, string>): Response {
  return new Response(JSON.stringify({ ok: false, error: code, message }), {
    status,
    headers: { ...ch, "Content-Type": "application/json" },
  });
}

function validatePayload(body: Partial<EmailSignalPayload>): EmailSignalPayload {
  if (!body.workspaceId || typeof body.workspaceId !== "string") {
    throw new Error("VALIDATION_ERROR:workspaceId");
  }
  if (!body.messageId || typeof body.messageId !== "string") {
    throw new Error("VALIDATION_ERROR:messageId");
  }
  if (!body.fromEmail || typeof body.fromEmail !== "string" || !body.fromEmail.includes("@")) {
    throw new Error("VALIDATION_ERROR:fromEmail");
  }
  if (!body.subject || typeof body.subject !== "string") {
    throw new Error("VALIDATION_ERROR:subject");
  }
  return body as EmailSignalPayload;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const ch = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }
  if (req.method !== "POST") {
    return bad(405, "METHOD_NOT_ALLOWED", "POST required.", ch);
  }

  const admin = createAdminClient();

  const isServiceRole = isServiceRoleCaller(req);
  let callerUserId: string | null = null;
  let callerWorkspaceId: string | null = null;
  if (!isServiceRole) {
    const caller = await resolveCallerContext(req, admin);
    if (!caller.role || !["admin", "manager", "owner"].includes(caller.role)) {
      return bad(403, "FORBIDDEN", "Elevated role required.", ch);
    }
    callerUserId = caller.userId ?? null;
    callerWorkspaceId = caller.workspaceId ?? null;
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return bad(400, "INVALID_JSON", "Request body must be valid JSON.", ch);
  }

  let payload: EmailSignalPayload;
  try {
    payload = validatePayload(raw as Partial<EmailSignalPayload>);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "validation";
    return bad(400, "VALIDATION_ERROR", msg, ch);
  }

  // Workspace isolation: an elevated (admin/manager/owner) caller can only
  // inject signals into their own workspace. Service-role callers (cron,
  // inbound mail gateways) keep the explicit workspaceId from the payload
  // because they legitimately target any tenant. Without this guard, an
  // admin in tenant A could POST {workspaceId: "B", ...} and cross-inject
  // into tenant B. CLAUDE.md § Non-Negotiables requires workspace
  // enforcement in both API logic and DB policy — RLS would not stop this
  // because the caller holds a valid JWT for their own tenant.
  if (!isServiceRole) {
    if (!callerWorkspaceId) {
      return bad(
        403,
        "FORBIDDEN",
        "Caller has no resolvable workspace.",
        ch,
      );
    }
    if (payload.workspaceId !== callerWorkspaceId) {
      return bad(
        403,
        "WORKSPACE_MISMATCH",
        "workspaceId in payload does not match caller.",
        ch,
      );
    }
  }

  try {
    // Resolve contact by email (workspace-scoped, case-insensitive). This is
    // a best-effort stamp — no match still produces a signal.
    const emailNeedle = payload.fromEmail.trim();
    const { data: contact } = await admin
      .from("crm_contacts")
      .select("id")
      .eq("workspace_id", payload.workspaceId)
      .ilike("email", emailNeedle)
      .limit(1)
      .maybeSingle();

    const matchedContactId = (contact as { id?: string } | null)?.id ?? null;

    // Minimal RouterCtx stub — ingestSignal only reads `admin`, `workspaceId`,
    // and optionally the payload.workspaceId override. Everything else on the
    // ctx is irrelevant for the service-role write path.
    const ctx = {
      admin,
      callerDb: admin,
      caller: {
        authHeader: null,
        userId: callerUserId,
        role: isServiceRole ? null : "admin",
        isServiceRole,
        workspaceId: payload.workspaceId,
      },
      workspaceId: payload.workspaceId,
      requestId: crypto.randomUUID(),
      route: "/inbound-email-signal",
      method: "POST",
      ipInet: null,
      userAgent: null,
    } as unknown as RouterCtx;

    const subjectSummary = payload.subject.length > 140
      ? payload.subject.slice(0, 137) + "…"
      : payload.subject;

    const fromTag = payload.fromName
      ? `${payload.fromName} <${payload.fromEmail}>`
      : payload.fromEmail;

    const signal = await ingestSignal(ctx, {
      workspaceId: payload.workspaceId,
      kind: "inbound_email",
      severity: payload.severity ?? "medium",
      source: payload.source ?? "email",
      title: `Email from ${fromTag}: ${subjectSummary}`,
      description: payload.bodyPreview?.slice(0, 500) ?? null,
      entityType: matchedContactId ? "contact" : null,
      entityId: matchedContactId,
      dedupeKey: `email:${payload.messageId}`,
      occurredAt: payload.receivedAt ?? new Date().toISOString(),
      payload: {
        message_id: payload.messageId,
        from_email: payload.fromEmail,
        from_name: payload.fromName ?? null,
        to_email: payload.toEmail ?? null,
        subject: payload.subject,
        body_preview: payload.bodyPreview ?? null,
      },
    });

    return new Response(
      JSON.stringify({ ok: true, signal, matchedContactId }),
      { status: 201, headers: { ...ch, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[inbound-email-signal] error:", err);
    return bad(
      500,
      "UNEXPECTED_ERROR",
      err instanceof Error ? err.message : "Unexpected error.",
      ch,
    );
  }
});
