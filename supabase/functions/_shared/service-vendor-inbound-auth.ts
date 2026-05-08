import { isLocalSupabaseUrl } from "./dge-auth.ts";
import { timingSafeEqualString } from "./timing-safe.ts";

export type VendorInboundAccessResult =
  | { ok: false; status: 401 | 503; message: string }
  | { ok: true; strictInbound: boolean };

/**
 * Fail-closed auth for `service-vendor-inbound`:
 * - Hosted Supabase (`SUPABASE_URL` not localhost): `VENDOR_INBOUND_WEBHOOK_SECRET` must be set
 *   and `x-webhook-secret` must match (constant-time).
 * - Local CLI: secret may be omitted for dev; if set, header must match.
 * `strictInbound` (strong ids required) is true whenever a secret is configured or the project is not local-only.
 */
export function resolveVendorInboundAccess(input: {
  supabaseUrl: string;
  secretEnv: string | undefined;
  webhookHeader: string | null;
}): VendorInboundAccessResult {
  const local = isLocalSupabaseUrl(input.supabaseUrl);
  const secret = (input.secretEnv ?? "").trim();

  if (!local && secret.length === 0) {
    return {
      ok: false,
      status: 503,
      message:
        "Server misconfigured: VENDOR_INBOUND_WEBHOOK_SECRET is required for hosted Supabase (Dashboard → Edge Functions → Secrets).",
    };
  }

  if (secret.length > 0) {
    const presented = (input.webhookHeader ?? "").trim();
    if (!timingSafeEqualString(secret, presented)) {
      return { ok: false, status: 401, message: "Unauthorized" };
    }
  }

  const strictInbound = secret.length > 0 || !local;
  return { ok: true, strictInbound };
}
