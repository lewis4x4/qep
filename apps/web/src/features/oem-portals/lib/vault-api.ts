import { supabase } from "@/lib/supabase";

export type CredentialKind = "shared_login" | "api_key" | "oauth_client" | "totp_seed";

export interface CredentialMeta {
  id: string;
  workspace_id: string;
  oem_portal_profile_id: string;
  kind: CredentialKind;
  label: string;
  has_username: boolean;
  has_secret: boolean;
  has_totp: boolean;
  totp_issuer: string | null;
  totp_account: string | null;
  encryption_version: number;
  expires_at: string | null;
  rotation_interval_days: number | null;
  last_rotated_at: string | null;
  last_rotated_by: string | null;
  last_revealed_at: string | null;
  last_revealed_by: string | null;
  reveal_count: number;
  reveal_allowed_for_reps: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CredentialAuditEvent {
  id: string;
  event_type:
    | "created" | "updated" | "rotated" | "revealed"
    | "totp_generated" | "deleted" | "reveal_denied" | "rate_limited";
  actor_user_id: string | null;
  actor_role: string | null;
  reason: string | null;
  changed_fields: string[] | null;
  metadata: Record<string, unknown> | null;
  request_id: string | null;
  ip: string | null;
  user_agent: string | null;
  occurred_at: string;
  credential_id: string | null;
}

export interface RevealPayload {
  username?: string;
  secret?: string;
  expires_in_ms: number;
}

export interface TotpPayload {
  code: string;
  remaining_seconds: number;
  period_seconds: number;
  issuer: string | null;
  account: string | null;
}

interface CreatePayload {
  portal_id: string;
  kind: CredentialKind;
  label: string;
  username?: string;
  secret?: string;
  totp_uri_or_seed?: string;
  reveal_allowed_for_reps?: boolean;
  expires_at?: string | null;
  rotation_interval_days?: number | null;
  notes?: string;
}

interface UpdatePayload {
  credential_id: string;
  label?: string;
  notes?: string;
  reveal_allowed_for_reps?: boolean;
  expires_at?: string | null;
  rotation_interval_days?: number | null;
}

interface RotatePayload {
  credential_id: string;
  new_username?: string;
  new_secret?: string;
  new_totp_uri_or_seed?: string;
  reason?: string;
}

const CREDENTIAL_KINDS = new Set<CredentialKind>([
  "shared_login",
  "api_key",
  "oauth_client",
  "totp_seed",
]);

const AUDIT_EVENT_TYPES = new Set<CredentialAuditEvent["event_type"]>([
  "created",
  "updated",
  "rotated",
  "revealed",
  "totp_generated",
  "deleted",
  "reveal_denied",
  "rate_limited",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function finiteNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function finiteNumberOrDefault(value: unknown, fallback = 0): number {
  return finiteNumberOrNull(value) ?? fallback;
}

function validDateStringOrNull(value: unknown): string | null {
  const text = stringOrNull(value);
  return text && Number.isFinite(new Date(text).getTime()) ? text : null;
}

function stringArrayOrNull(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeCredentialMetaRows(rows: unknown): CredentialMeta[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = stringOrNull(row.id);
    const workspaceId = stringOrNull(row.workspace_id);
    const portalId = stringOrNull(row.oem_portal_profile_id);
    const kind = stringOrNull(row.kind);
    const label = stringOrNull(row.label);
    const createdAt = validDateStringOrNull(row.created_at);
    const updatedAt = validDateStringOrNull(row.updated_at);
    if (!id || !workspaceId || !portalId || !kind || !CREDENTIAL_KINDS.has(kind as CredentialKind) || !label || !createdAt || !updatedAt) {
      return [];
    }

    return [{
      id,
      workspace_id: workspaceId,
      oem_portal_profile_id: portalId,
      kind: kind as CredentialKind,
      label,
      has_username: row.has_username === true,
      has_secret: row.has_secret === true,
      has_totp: row.has_totp === true,
      totp_issuer: stringOrNull(row.totp_issuer),
      totp_account: stringOrNull(row.totp_account),
      encryption_version: finiteNumberOrDefault(row.encryption_version, 1),
      expires_at: validDateStringOrNull(row.expires_at),
      rotation_interval_days: finiteNumberOrNull(row.rotation_interval_days),
      last_rotated_at: validDateStringOrNull(row.last_rotated_at),
      last_rotated_by: stringOrNull(row.last_rotated_by),
      last_revealed_at: validDateStringOrNull(row.last_revealed_at),
      last_revealed_by: stringOrNull(row.last_revealed_by),
      reveal_count: finiteNumberOrDefault(row.reveal_count),
      reveal_allowed_for_reps: row.reveal_allowed_for_reps === true,
      notes: stringOrNull(row.notes),
      created_by: stringOrNull(row.created_by),
      created_at: createdAt,
      updated_at: updatedAt,
    }];
  });
}

function normalizeCredentialAuditRows(rows: unknown): CredentialAuditEvent[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const id = stringOrNull(row.id);
    const eventType = stringOrNull(row.event_type);
    const occurredAt = validDateStringOrNull(row.occurred_at);
    if (!id || !eventType || !AUDIT_EVENT_TYPES.has(eventType as CredentialAuditEvent["event_type"]) || !occurredAt) return [];

    return [{
      id,
      event_type: eventType as CredentialAuditEvent["event_type"],
      actor_user_id: stringOrNull(row.actor_user_id),
      actor_role: stringOrNull(row.actor_role),
      reason: stringOrNull(row.reason),
      changed_fields: stringArrayOrNull(row.changed_fields),
      metadata: isRecord(row.metadata) ? row.metadata : null,
      request_id: stringOrNull(row.request_id),
      ip: stringOrNull(row.ip),
      user_agent: stringOrNull(row.user_agent),
      occurred_at: occurredAt,
      credential_id: stringOrNull(row.credential_id),
    }];
  });
}

function normalizeCredentialIdResponse(payload: unknown): { credential_id: string } {
  if (!isRecord(payload)) throw new Error("Malformed vault response");
  const credentialId = stringOrNull(payload.credential_id);
  if (!credentialId) throw new Error("Malformed vault response");
  return { credential_id: credentialId };
}

function normalizeOkResponse(payload: unknown): { ok: true } {
  if (!isRecord(payload) || payload.ok !== true) throw new Error("Malformed vault response");
  return { ok: true };
}

function normalizeRevealPayload(payload: unknown): RevealPayload {
  if (!isRecord(payload)) throw new Error("Malformed reveal response");
  const expiresInMs = finiteNumberOrNull(payload.expires_in_ms);
  if (expiresInMs == null) throw new Error("Malformed reveal response");
  return {
    username: stringOrNull(payload.username) ?? undefined,
    secret: stringOrNull(payload.secret) ?? undefined,
    expires_in_ms: expiresInMs,
  };
}

function normalizeTotpPayload(payload: unknown): TotpPayload {
  if (!isRecord(payload)) throw new Error("Malformed TOTP response");
  const code = stringOrNull(payload.code);
  const remainingSeconds = finiteNumberOrNull(payload.remaining_seconds);
  const periodSeconds = finiteNumberOrNull(payload.period_seconds);
  if (!code || remainingSeconds == null || periodSeconds == null || periodSeconds <= 0) {
    throw new Error("Malformed TOTP response");
  }
  return {
    code,
    remaining_seconds: remainingSeconds,
    period_seconds: periodSeconds,
    issuer: stringOrNull(payload.issuer),
    account: stringOrNull(payload.account),
  };
}

async function call(action: string, body: object = {}): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("oem-portal-vault", {
    body: { action, ...body },
  });
  if (error) {
    // supabase-js returns FunctionsHttpError for non-2xx; message is generic.
    // The body often holds the server's {error: ...}.
    const serverMsg =
      typeof (data as { error?: string } | null)?.error === "string"
        ? (data as { error: string }).error
        : null;
    throw new Error(serverMsg ?? error.message ?? "Vault request failed");
  }
  return data;
}

export const vaultApi = {
  async list(portalId: string): Promise<CredentialMeta[]> {
    const res = await call("list", { portal_id: portalId });
    return normalizeCredentialMetaRows(isRecord(res) ? res.credentials : null);
  },
  async audit(portalId: string): Promise<CredentialAuditEvent[]> {
    const res = await call("audit", { portal_id: portalId });
    return normalizeCredentialAuditRows(isRecord(res) ? res.events : null);
  },
  async create(payload: CreatePayload): Promise<{ credential_id: string }> {
    return normalizeCredentialIdResponse(await call("create", payload));
  },
  async update(payload: UpdatePayload): Promise<{ ok: true }> {
    return normalizeOkResponse(await call("update", payload));
  },
  async rotate(payload: RotatePayload): Promise<{ ok: true }> {
    return normalizeOkResponse(await call("rotate", payload));
  },
  async remove(credentialId: string, reason: string): Promise<{ ok: true }> {
    return normalizeOkResponse(await call("delete", { credential_id: credentialId, reason }));
  },
  async reveal(credentialId: string, reason: string | null): Promise<RevealPayload> {
    return normalizeRevealPayload(await call("reveal", {
      credential_id: credentialId,
      reason: reason ?? undefined,
    }));
  },
  async totpCode(credentialId: string): Promise<TotpPayload> {
    return normalizeTotpPayload(await call("totp_code", { credential_id: credentialId }));
  },
};

export const oemVaultQueryKeys = {
  list: (portalId: string) => ["oem-portal-credentials", portalId] as const,
  audit: (portalId: string) => ["oem-portal-credential-audit", portalId] as const,
  totp: (credentialId: string) => ["oem-portal-totp", credentialId] as const,
};
