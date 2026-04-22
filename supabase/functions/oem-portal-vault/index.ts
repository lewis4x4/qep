/**
 * oem-portal-vault — Credential vault RPC for the OEM Portal dashboard (Phase 9.1).
 *
 * Single endpoint, action-routed JSON:
 *   POST { action: 'list' | 'create' | 'update' | 'rotate' | 'reveal' |
 *         'totp_code' | 'delete' | 'audit', ... }
 *
 * Auth: user JWT via requireServiceUser (ES256-safe).
 * DB IO: uses a separate service-role client because the ciphertext table
 * is locked via RLS to service_role only.
 * Audit: INSERT/UPDATE/DELETE is trigger-logged. Reveal / TOTP / rate-limit
 * events are inserted explicitly by this function.
 */
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { requireServiceUser } from "../_shared/service-auth.ts";
import {
  optionsResponse,
  safeJsonError,
  safeJsonOk,
} from "../_shared/safe-cors.ts";
import {
  decryptVaultSecret,
  encryptVaultSecret,
  generateTotp,
  parseTotpInput,
  VaultCryptoError,
} from "../_shared/vault-crypto.ts";

type Role = "rep" | "admin" | "manager" | "owner";
type CredentialKind = "shared_login" | "api_key" | "oauth_client" | "totp_seed";
const CREDENTIAL_KINDS: readonly CredentialKind[] = [
  "shared_login", "api_key", "oauth_client", "totp_seed",
];

const ELEVATED: readonly Role[] = ["admin", "manager", "owner"];

const REVEAL_RATE_LIMIT = 5;           // reveals per credential per window
const REVEAL_RATE_WINDOW_MS = 60_000;  // 60s
const TOTP_RATE_WINDOW_MS = 5_000;     // 5s per credential

// Process-local rate limiter. Acceptable: cold starts reset the window, single
// edge-function instance per region handles the traffic. If a reset coincides
// with an attack, the audit trail still catches it.
const revealHits = new Map<string, number[]>();
const totpHits = new Map<string, number>();

interface AdminContext {
  admin: SupabaseClient;
  actorUser: string;
  actorRole: Role;
  workspaceId: string;
  userAgent: string | null;
  ipAddress: string | null;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") {
    return safeJsonError("POST required", 405, origin);
  }

  try {
    const auth = await requireServiceUser(req.headers.get("Authorization"), origin);
    if (!auth.ok) return auth.response;

    const role = auth.role as Role;
    if (!["rep", "admin", "manager", "owner"].includes(role)) {
      return safeJsonError("Forbidden", 403, origin);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const ctx: AdminContext = {
      admin,
      actorUser: auth.userId,
      actorRole: role,
      workspaceId: auth.workspaceId,
      userAgent: req.headers.get("user-agent"),
      ipAddress:
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        req.headers.get("cf-connecting-ip") ??
        null,
    };

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? "");

    switch (action) {
      case "list":
        return await handleList(auth.supabase, ctx, body, origin);
      case "audit":
        return await handleAudit(auth.supabase, ctx, body, origin);
      case "create":
        return requireElevated(ctx, origin) ?? await handleCreate(ctx, body, origin);
      case "update":
        return requireElevated(ctx, origin) ?? await handleUpdate(ctx, body, origin);
      case "rotate":
        return requireElevated(ctx, origin) ?? await handleRotate(ctx, body, origin);
      case "delete":
        return requireElevated(ctx, origin) ?? await handleDelete(ctx, body, origin);
      case "reveal":
        return await handleReveal(ctx, body, origin);
      case "totp_code":
        return await handleTotpCode(ctx, body, origin);
      default:
        return safeJsonError(`Unknown action: ${action}`, 400, origin);
    }
  } catch (err) {
    console.error("oem-portal-vault error:", err);
    if (err instanceof SyntaxError) {
      return safeJsonError("Invalid JSON body", 400, origin);
    }
    if (err instanceof ValidationError) {
      return safeJsonError(err.message, 400, origin);
    }
    if (err instanceof VaultCryptoError) {
      return safeJsonError(`Vault crypto error: ${err.code}`, 500, origin);
    }
    return safeJsonError("Internal server error", 500, origin);
  }
});

function requireElevated(ctx: AdminContext, origin: string | null): Response | null {
  if (!ELEVATED.includes(ctx.actorRole)) {
    return safeJsonError("Forbidden — elevated role required", 403, origin);
  }
  return null;
}

// ── list ────────────────────────────────────────────────────────────────────
async function handleList(
  userClient: SupabaseClient,
  ctx: AdminContext,
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const portalId = typeof body.portal_id === "string" ? body.portal_id : null;
  const { data, error } = await userClient.rpc("oem_portal_credential_meta_for_role");
  if (error) {
    console.error("oem-portal-vault list rpc error:", error);
    return safeJsonError("Failed to list credentials", 500, origin);
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const filtered = portalId ? rows.filter((r) => r.oem_portal_profile_id === portalId) : rows;
  return safeJsonOk({ credentials: filtered }, origin);
}

// ── audit ───────────────────────────────────────────────────────────────────
async function handleAudit(
  userClient: SupabaseClient,
  ctx: AdminContext,
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  if (!ELEVATED.includes(ctx.actorRole)) {
    return safeJsonError("Forbidden — elevated role required", 403, origin);
  }
  const portalId = typeof body.portal_id === "string" ? body.portal_id : null;
  if (!portalId) return safeJsonError("portal_id required", 400, origin);

  const { data, error } = await userClient
    .from("oem_portal_credential_audit_events")
    .select(
      "id, event_type, actor_user_id, actor_role, reason, changed_fields, metadata, request_id, ip, user_agent, occurred_at, credential_id",
    )
    .eq("oem_portal_profile_id", portalId)
    .order("occurred_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("oem-portal-vault audit select error:", error);
    return safeJsonError("Failed to load audit events", 500, origin);
  }
  return safeJsonOk({ events: data ?? [] }, origin);
}

// ── create ──────────────────────────────────────────────────────────────────
async function handleCreate(
  ctx: AdminContext,
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const portalId = requireString(body.portal_id, "portal_id");
  const kind = requireKind(body.kind);
  const label = requireString(body.label, "label").slice(0, 120);

  // Enforce portal belongs to the caller's workspace.
  const portal = await loadPortalForWorkspace(ctx, portalId);
  if (!portal.ok) return safeJsonError(portal.error, portal.status, origin);

  const username = typeof body.username === "string" ? body.username : null;
  const secret = typeof body.secret === "string" ? body.secret : null;
  const totpInput = typeof body.totp_uri_or_seed === "string" ? body.totp_uri_or_seed : null;

  let usernameCipher: string | null = null;
  let secretCipher: string | null = null;
  let totpCipher: string | null = null;
  let totpIssuer: string | null = null;
  let totpAccount: string | null = null;

  if (username) usernameCipher = await encryptVaultSecret(username);
  if (secret) secretCipher = await encryptVaultSecret(secret);
  if (totpInput) {
    const parsed = parseTotpInput(totpInput);
    totpCipher = await encryptVaultSecret(parsed.seed);
    totpIssuer = parsed.issuer;
    totpAccount = parsed.account;
  }

  // Kind-specific validation.
  if (kind === "shared_login" && !usernameCipher && !secretCipher) {
    return safeJsonError("shared_login requires username or secret", 400, origin);
  }
  if (kind === "api_key" && !secretCipher) {
    return safeJsonError("api_key requires secret", 400, origin);
  }
  if (kind === "oauth_client" && !secretCipher) {
    return safeJsonError("oauth_client requires secret (client_secret)", 400, origin);
  }
  if (kind === "totp_seed" && !totpCipher) {
    return safeJsonError("totp_seed requires totp_uri_or_seed", 400, origin);
  }

  const insertRow = {
    workspace_id: ctx.workspaceId,
    oem_portal_profile_id: portalId,
    kind,
    label,
    username_cipher: usernameCipher,
    secret_cipher: secretCipher,
    totp_seed_cipher: totpCipher,
    totp_issuer: totpIssuer,
    totp_account: totpAccount,
    reveal_allowed_for_reps:
      typeof body.reveal_allowed_for_reps === "boolean" ? body.reveal_allowed_for_reps : false,
    expires_at: typeof body.expires_at === "string" ? body.expires_at : null,
    rotation_interval_days:
      typeof body.rotation_interval_days === "number" ? body.rotation_interval_days : null,
    notes: typeof body.notes === "string" ? body.notes.slice(0, 2000) : null,
    created_by: ctx.actorUser,
  };

  const { data, error } = await ctx.admin
    .from("oem_portal_credentials")
    .insert(insertRow)
    .select("id")
    .single();

  if (error) {
    console.error("oem-portal-vault create error:", error);
    return safeJsonError(`Failed to create credential: ${error.message}`, 400, origin);
  }
  return safeJsonOk({ credential_id: data.id }, origin, 201);
}

// ── update (metadata only) ──────────────────────────────────────────────────
async function handleUpdate(
  ctx: AdminContext,
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const id = requireString(body.credential_id, "credential_id");
  const existing = await loadCredential(ctx, id);
  if (!existing.ok) return safeJsonError(existing.error, existing.status, origin);

  const patch: Record<string, unknown> = {};
  if (typeof body.label === "string") patch.label = body.label.slice(0, 120);
  if (typeof body.notes === "string") patch.notes = body.notes.slice(0, 2000);
  if (typeof body.reveal_allowed_for_reps === "boolean") {
    patch.reveal_allowed_for_reps = body.reveal_allowed_for_reps;
  }
  if (typeof body.expires_at === "string" || body.expires_at === null) {
    patch.expires_at = body.expires_at;
  }
  if (typeof body.rotation_interval_days === "number" || body.rotation_interval_days === null) {
    patch.rotation_interval_days = body.rotation_interval_days;
  }

  if (Object.keys(patch).length === 0) {
    return safeJsonError("No supported fields in update payload", 400, origin);
  }

  const { error } = await ctx.admin
    .from("oem_portal_credentials")
    .update(patch)
    .eq("id", id)
    .eq("workspace_id", ctx.workspaceId);

  if (error) return safeJsonError(`Failed to update: ${error.message}`, 400, origin);
  return safeJsonOk({ ok: true }, origin);
}

// ── rotate (writes new ciphertext) ─────────────────────────────────────────
async function handleRotate(
  ctx: AdminContext,
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const id = requireString(body.credential_id, "credential_id");
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 400) : null;
  const existing = await loadCredential(ctx, id);
  if (!existing.ok) return safeJsonError(existing.error, existing.status, origin);

  const patch: Record<string, unknown> = {
    last_rotated_at: new Date().toISOString(),
    last_rotated_by: ctx.actorUser,
  };

  if (typeof body.new_username === "string") {
    patch.username_cipher = await encryptVaultSecret(body.new_username);
  }
  if (typeof body.new_secret === "string") {
    patch.secret_cipher = await encryptVaultSecret(body.new_secret);
  }
  if (typeof body.new_totp_uri_or_seed === "string") {
    const parsed = parseTotpInput(body.new_totp_uri_or_seed);
    patch.totp_seed_cipher = await encryptVaultSecret(parsed.seed);
    patch.totp_issuer = parsed.issuer;
    patch.totp_account = parsed.account;
  }

  if (
    patch.username_cipher === undefined &&
    patch.secret_cipher === undefined &&
    patch.totp_seed_cipher === undefined
  ) {
    return safeJsonError("rotate requires at least one new secret", 400, origin);
  }

  const { error } = await ctx.admin
    .from("oem_portal_credentials")
    .update(patch)
    .eq("id", id)
    .eq("workspace_id", ctx.workspaceId);

  if (error) return safeJsonError(`Failed to rotate: ${error.message}`, 400, origin);

  // Trigger records 'rotated' on the UPDATE. Augment with reason via explicit
  // insert so the UI can surface the actor's justification.
  if (reason) {
    await writeAuditEvent(ctx, existing.value, "rotated", { reason, metadata: { via: "rotate" } });
  }
  return safeJsonOk({ ok: true }, origin);
}

// ── delete (soft) ──────────────────────────────────────────────────────────
async function handleDelete(
  ctx: AdminContext,
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const id = requireString(body.credential_id, "credential_id");
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 400) : null;
  const existing = await loadCredential(ctx, id);
  if (!existing.ok) return safeJsonError(existing.error, existing.status, origin);

  const { error } = await ctx.admin
    .from("oem_portal_credentials")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", ctx.workspaceId);
  if (error) return safeJsonError(`Failed to delete: ${error.message}`, 400, origin);

  if (reason) {
    await writeAuditEvent(ctx, existing.value, "deleted", { reason });
  }
  return safeJsonOk({ ok: true }, origin);
}

// ── reveal ─────────────────────────────────────────────────────────────────
async function handleReveal(
  ctx: AdminContext,
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const id = requireString(body.credential_id, "credential_id");
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 400) : null;
  const row = await loadCredential(ctx, id);
  if (!row.ok) return safeJsonError(row.error, row.status, origin);

  // Rep may only reveal when explicitly allowed on the row.
  if (!ELEVATED.includes(ctx.actorRole) && row.value.reveal_allowed_for_reps !== true) {
    await writeAuditEvent(ctx, row.value, "reveal_denied", {
      reason,
      metadata: { cause: "rep_not_allowed" },
    });
    return safeJsonError("Forbidden — reveal not allowed for this role", 403, origin);
  }

  if (!checkAndRecordHit(revealHits, id, REVEAL_RATE_WINDOW_MS, REVEAL_RATE_LIMIT)) {
    await writeAuditEvent(ctx, row.value, "rate_limited", { metadata: { action: "reveal" } });
    return safeJsonError("Rate limited — too many reveals", 429, origin);
  }

  const payload: { username?: string; secret?: string; expires_in_ms: number } = {
    expires_in_ms: 30_000,
  };
  try {
    if (row.value.username_cipher) {
      payload.username = await decryptVaultSecret(row.value.username_cipher);
    }
    if (row.value.secret_cipher) {
      payload.secret = await decryptVaultSecret(row.value.secret_cipher);
    }
  } catch (err) {
    console.error("oem-portal-vault decrypt error:", err);
    return safeJsonError("Failed to decrypt credential", 500, origin);
  }

  await ctx.admin
    .from("oem_portal_credentials")
    .update({
      last_revealed_at: new Date().toISOString(),
      last_revealed_by: ctx.actorUser,
      reveal_count: (row.value.reveal_count ?? 0) + 1,
    })
    .eq("id", id)
    .eq("workspace_id", ctx.workspaceId);

  await writeAuditEvent(ctx, row.value, "revealed", { reason });
  return safeJsonOk(payload, origin);
}

// ── totp_code ───────────────────────────────────────────────────────────────
async function handleTotpCode(
  ctx: AdminContext,
  body: Record<string, unknown>,
  origin: string | null,
): Promise<Response> {
  const id = requireString(body.credential_id, "credential_id");
  const row = await loadCredential(ctx, id);
  if (!row.ok) return safeJsonError(row.error, row.status, origin);
  if (!row.value.totp_seed_cipher) {
    return safeJsonError("Credential has no TOTP seed", 400, origin);
  }

  // Rep gating same as reveal.
  if (!ELEVATED.includes(ctx.actorRole) && row.value.reveal_allowed_for_reps !== true) {
    await writeAuditEvent(ctx, row.value, "reveal_denied", {
      metadata: { cause: "rep_not_allowed", action: "totp_code" },
    });
    return safeJsonError("Forbidden — TOTP not allowed for this role", 403, origin);
  }

  // Soft throttle: at most one audited totp fetch per 5s per credential.
  const last = totpHits.get(id) ?? 0;
  const now = Date.now();
  const audited = now - last >= TOTP_RATE_WINDOW_MS;

  let seed: string;
  try {
    seed = await decryptVaultSecret(row.value.totp_seed_cipher);
  } catch (err) {
    console.error("oem-portal-vault totp decrypt error:", err);
    return safeJsonError("Failed to decrypt TOTP seed", 500, origin);
  }
  const { code, remainingSeconds, periodSeconds } = await generateTotp(seed);

  if (audited) {
    totpHits.set(id, now);
    await writeAuditEvent(ctx, row.value, "totp_generated", {
      metadata: { period_seconds: periodSeconds },
    });
  }

  return safeJsonOk(
    {
      code,
      remaining_seconds: remainingSeconds,
      period_seconds: periodSeconds,
      issuer: row.value.totp_issuer ?? null,
      account: row.value.totp_account ?? null,
    },
    origin,
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${name} is required`);
  }
  return value.trim();
}

function requireKind(value: unknown): CredentialKind {
  if (typeof value !== "string" || !(CREDENTIAL_KINDS as readonly string[]).includes(value)) {
    throw new ValidationError("kind must be one of shared_login|api_key|oauth_client|totp_seed");
  }
  return value as CredentialKind;
}

class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ValidationError"; }
}

interface LoadResult<T> {
  ok: true;
  value: T;
}
interface LoadError {
  ok: false;
  error: string;
  status: number;
}

async function loadPortalForWorkspace(
  ctx: AdminContext,
  portalId: string,
): Promise<LoadResult<{ id: string; workspace_id: string }> | LoadError> {
  const { data, error } = await ctx.admin
    .from("oem_portal_profiles")
    .select("id, workspace_id")
    .eq("id", portalId)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (error) return { ok: false, error: `Failed to load portal: ${error.message}`, status: 500 };
  if (!data) return { ok: false, error: "Portal not found in this workspace", status: 404 };
  return { ok: true, value: data };
}

interface CredentialRow {
  id: string;
  workspace_id: string;
  oem_portal_profile_id: string;
  kind: CredentialKind;
  label: string;
  username_cipher: string | null;
  secret_cipher: string | null;
  totp_seed_cipher: string | null;
  totp_issuer: string | null;
  totp_account: string | null;
  reveal_count: number;
  reveal_allowed_for_reps: boolean;
}

async function loadCredential(
  ctx: AdminContext,
  id: string,
): Promise<LoadResult<CredentialRow> | LoadError> {
  const { data, error } = await ctx.admin
    .from("oem_portal_credentials")
    .select(
      "id, workspace_id, oem_portal_profile_id, kind, label, username_cipher, secret_cipher, totp_seed_cipher, totp_issuer, totp_account, reveal_count, reveal_allowed_for_reps, deleted_at",
    )
    .eq("id", id)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (error) return { ok: false, error: `Failed to load credential: ${error.message}`, status: 500 };
  if (!data || data.deleted_at) return { ok: false, error: "Credential not found", status: 404 };
  return { ok: true, value: data as unknown as CredentialRow };
}

function checkAndRecordHit(
  bucket: Map<string, number[]>,
  key: string,
  windowMs: number,
  limit: number,
): boolean {
  const now = Date.now();
  const hits = (bucket.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    bucket.set(key, hits);
    return false;
  }
  hits.push(now);
  bucket.set(key, hits);
  return true;
}

async function writeAuditEvent(
  ctx: AdminContext,
  row: { id: string; oem_portal_profile_id: string },
  eventType: string,
  opts: { reason?: string | null; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  const { error } = await ctx.admin.from("oem_portal_credential_audit_events").insert({
    workspace_id: ctx.workspaceId,
    oem_portal_profile_id: row.oem_portal_profile_id,
    credential_id: row.id,
    event_type: eventType,
    actor_user_id: ctx.actorUser,
    actor_role: ctx.actorRole,
    reason: opts.reason ?? null,
    ip: ctx.ipAddress,
    user_agent: ctx.userAgent,
    metadata: opts.metadata ?? {},
  });
  if (error) {
    console.error("oem-portal-vault audit insert error:", error);
  }
}
