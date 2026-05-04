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
 * ────────────────────────────────────────────────────────────────────────
 * CRITICAL OPS NOTE — Functions Gateway verify_jwt flag
 * ────────────────────────────────────────────────────────────────────────
 * Every edge function that is cron-invoked via path #2 MUST be deployed
 * with `verify_jwt = false` on the function gateway. The gateway's JWT
 * verification only accepts anon-key / user-JWT / service-role-key in
 * the `Authorization: Bearer` header — it does NOT inspect the
 * `x-internal-service-secret` header. A cron request using path #2 with
 * verify_jwt=true hits the gateway's `{"code":"UNAUTHORIZED_NO_AUTH_HEADER"}`
 * reject before reaching our code. Deploy with
 * `supabase functions deploy <name> --no-verify-jwt`, or pass
 * `verify_jwt: false` to the deploy_edge_function MCP tool. This file's
 * auth check is the authoritative gate at that point.
 *
 * Audited 2026-04-20: 13 cron-targeted fns had verify_jwt=true and every
 * single cron tick was 401ing. Flipping them to false restored the
 * entire scheduled pipeline. If you add a new cron-invoked fn and it
 * silently starts 401ing in edge-function logs, this is the first thing
 * to check.
 * ────────────────────────────────────────────────────────────────────────
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
  const authHeader = (req.headers.get("Authorization") ?? "").trim();
  const internalSecretHeader = (req.headers.get("x-internal-service-secret") ?? "").trim();

  const serviceRoleKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const internalServiceSecret =
    (Deno.env.get("INTERNAL_SERVICE_SECRET") ??
      Deno.env.get("DGE_INTERNAL_SERVICE_SECRET") ??
      "").trim();

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
