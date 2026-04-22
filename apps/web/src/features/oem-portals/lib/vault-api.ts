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

async function call<T = unknown>(action: string, body: object = {}): Promise<T> {
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
  return data as T;
}

export const vaultApi = {
  async list(portalId: string): Promise<CredentialMeta[]> {
    const res = await call<{ credentials: CredentialMeta[] }>("list", { portal_id: portalId });
    return res.credentials ?? [];
  },
  async audit(portalId: string): Promise<CredentialAuditEvent[]> {
    const res = await call<{ events: CredentialAuditEvent[] }>("audit", { portal_id: portalId });
    return res.events ?? [];
  },
  async create(payload: CreatePayload): Promise<{ credential_id: string }> {
    return await call<{ credential_id: string }>("create", payload);
  },
  async update(payload: UpdatePayload): Promise<{ ok: true }> {
    return await call<{ ok: true }>("update", payload);
  },
  async rotate(payload: RotatePayload): Promise<{ ok: true }> {
    return await call<{ ok: true }>("rotate", payload);
  },
  async remove(credentialId: string, reason: string): Promise<{ ok: true }> {
    return await call<{ ok: true }>("delete", { credential_id: credentialId, reason });
  },
  async reveal(credentialId: string, reason: string | null): Promise<RevealPayload> {
    return await call<RevealPayload>("reveal", {
      credential_id: credentialId,
      reason: reason ?? undefined,
    });
  },
  async totpCode(credentialId: string): Promise<TotpPayload> {
    return await call<TotpPayload>("totp_code", { credential_id: credentialId });
  },
};

export const oemVaultQueryKeys = {
  list: (portalId: string) => ["oem-portal-credentials", portalId] as const,
  audit: (portalId: string) => ["oem-portal-credential-audit", portalId] as const,
  totp: (credentialId: string) => ["oem-portal-totp", credentialId] as const,
};
