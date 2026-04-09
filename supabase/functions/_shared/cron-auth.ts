/**
 * Shared cron-caller auth helper for service-role-only edge functions.
 *
 * Returns true if the request carries valid service-role credentials via
 * EITHER:
 *
 *   1. `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}` — legacy
 *      pattern, used by all dge-style cron migrations from 059 onward
 *      and by manual `supabase functions invoke` calls.
 *
 *   2. `x-internal-service-secret: ${INTERNAL_SERVICE_SECRET}` — modern
 *      pattern, used by `flow-runner` / `analytics-*` / `morning-briefing`
 *      cron jobs (see migration 205 for the canonical example). This is
 *      the only path that survives on modern Supabase projects, where the
 *      `app.settings.supabase_url` / `app.settings.service_role_key` GUCs
 *      that the legacy migrations depend on no longer exist.
 *
 * NOTE: this file is named `cron-auth.ts` (not `service-auth.ts`) because
 * `_shared/service-auth.ts` already exists and serves a different purpose
 * — `requireServiceUser()` for JWT-based service-engine endpoints. The
 * two are unrelated despite the naming overlap; do not confuse them.
 *
 * Either env var name is accepted for the second path:
 *   - `INTERNAL_SERVICE_SECRET`     — used by flow-runner / analytics-*
 *   - `DGE_INTERNAL_SERVICE_SECRET` — used by dge-auth.ts
 *
 * This mirrors the morning-briefing fallback (see
 * supabase/functions/morning-briefing/index.ts:233-251) so the publishers
 * never have to care which env var name happens to be set in their
 * runtime.
 *
 * Returns true on first successful match. Order is irrelevant — both
 * checks run cheaply against headers the request already carries.
 *
 * Empty env vars: if SERVICE_ROLE_KEY is empty (or unset) AND both
 * INTERNAL_SECRET vars are empty (or unset), the function returns false
 * even when the request claims to have matching credentials. This
 * defensively prevents an empty-string side-channel from elevating an
 * unauthenticated request.
 */
export function isServiceRoleCaller(req: Request): boolean {
  const authHeader = req.headers.get("Authorization") ?? "";
  const internalSecretHeader = req.headers.get("x-internal-service-secret") ?? "";

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const internalServiceSecret =
    Deno.env.get("INTERNAL_SERVICE_SECRET") ??
    Deno.env.get("DGE_INTERNAL_SERVICE_SECRET") ??
    "";

  // Path 1: legacy Bearer service_role_key
  if (serviceRoleKey.length > 0 && authHeader === `Bearer ${serviceRoleKey}`) {
    return true;
  }

  // Path 2: modern x-internal-service-secret
  if (
    internalServiceSecret.length > 0 &&
    internalSecretHeader.length > 0 &&
    internalSecretHeader === internalServiceSecret
  ) {
    return true;
  }

  return false;
}
