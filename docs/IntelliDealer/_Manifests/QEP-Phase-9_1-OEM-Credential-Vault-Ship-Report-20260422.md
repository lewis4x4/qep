# QEP Phase 9.1 OEM Portal Credential Vault Ship Report

**Date:** 2026-04-22
**Phase:** `Phase-9_Advanced-Intelligence`
**Builds on:** Phase 9 OEM Portal SSO (`cf8853d`, migration 354)
**Gap Register row:** `16` (OEM Portal SSO) — credential workflow closure
**Slice:** `codex/phase9-1-oem-credential-vault`

## Why this slice shipped

Phase 9 shipped a registry-only launch board; operators still had to keep
dealer passwords, OEM API keys, and MFA seeds in a separate vault tool, then
context-switch every time they wanted to use a portal. Operator feedback
captured in the phase 9 configuration checklist flagged the gap: *"tell me
where the shell stores passwords — it doesn't, go look in 1Password."*

This slice closes that gap with a real, server-sealed credential vault
bolted directly onto the OEM portal detail card. One click reveals the
credential for 30 seconds with a full audit trail; one more click rotates
it; a live TOTP ring generates 2FA codes server-side.

## Scope Closed

- Added `oem_portal_credentials` (ciphertext-only) and
  `oem_portal_credential_audit_events` (append-only) tables.
- Added `oem_portal_credential_meta_for_role()` SECURITY DEFINER accessor so
  the UI can read credential *metadata* without ever touching ciphertext.
- Added AES-256-GCM application-layer crypto (`OEM_VAULT_ENCRYPTION_KEY`,
  distinct from HubSpot's key for blast-radius isolation).
- Added server-side TOTP (RFC 6238, SHA-1, 30 s window, 6 digits) so the
  seed never leaves the vault.
- Added `oem-portal-vault` edge function (action-routed: `list`, `audit`,
  `create`, `update`, `rotate`, `delete`, `reveal`, `totp_code`) with role
  gating, reveal rate limiting, and explicit audit emission for
  reveal / TOTP / rate-limit events the trigger can't see.
- Added Credentials section to `/oem-portals` detail card with
  `CredentialCard`, `CredentialSheet` (create/rotate/edit), `RevealModal`
  (countdown + auto-wipe), `TotpRing` (live 30 s code), and
  `CredentialAuditSheet` (last 50 events with actor/reason).
- Default reveal gate: `admin | manager | owner`. Per-credential
  `reveal_allowed_for_reps` flag enables rep access case-by-case.

## Design Invariants Enforced

1. **Zero plaintext in Postgres.** Only ciphertext envelopes
   (`<iv_hex>:<ct_hex>`) + metadata.
2. **Browser never holds a secret longer than 30 s.** React state clears;
   `navigator.clipboard.writeText('')` is attempted on expiry.
3. **All writes and reveals are audited.** Trigger handles INSERT/UPDATE/
   DELETE; edge function writes `revealed`, `totp_generated`,
   `reveal_denied`, `rate_limited`. Audit table has no non-service
   insert/update/delete policy.
4. **Direct table access is blocked.** Authenticated roles cannot
   `select * from oem_portal_credentials` — only `service_role` can.
5. **Role-gated.** Rep access exists only via explicit opt-in on a
   credential.
6. **MFA seed stays server-side.** `generateTotp` runs inside the edge
   function; only `{code, remaining_seconds}` ever reaches the browser.

## Files Changed

New:
- `supabase/migrations/355_oem_portal_credential_vault.sql`
- `supabase/functions/oem-portal-vault/index.ts`
- `supabase/functions/oem-portal-vault/rate-limit.test.ts`
- `supabase/functions/_shared/vault-crypto.ts`
- `supabase/functions/_shared/vault-crypto.test.ts`
- `apps/web/src/features/oem-portals/lib/vault-api.ts`
- `apps/web/src/features/oem-portals/lib/vault-api.test.ts`
- `apps/web/src/features/oem-portals/components/CredentialCard.tsx`
- `apps/web/src/features/oem-portals/components/CredentialSheet.tsx`
- `apps/web/src/features/oem-portals/components/RevealModal.tsx`
- `apps/web/src/features/oem-portals/components/TotpRing.tsx`
- `apps/web/src/features/oem-portals/components/CredentialAuditSheet.tsx`

Modified:
- `apps/web/src/features/oem-portals/pages/OemPortalDashboardPage.tsx`
- `apps/web/src/features/oem-portals/pages/__tests__/OemPortalDashboardPage.integration.test.tsx`
- `supabase/config.toml` (registers `[functions.oem-portal-vault]`)
- `.env.example` (documents `OEM_VAULT_ENCRYPTION_KEY`)

## Patterns Reused

- `_shared/integration-crypto.ts` AES-256-GCM envelope shape (`iv:ct` hex).
- `_shared/service-auth.ts` `requireServiceUser()` for ES256-safe auth.
- `_shared/safe-cors.ts` for CORS / typed JSON responses.
- Migration 023 `log_integration_status_credential_change` trigger pattern
  (mirrored as `log_oem_portal_credential_change`).
- `supabase/functions/quickbooks-gl-sync/index.ts` dual-client pattern
  (user-JWT client for RLS-gated reads, service-role admin client for
  ciphertext writes).
- `apps/web/src/hooks/useBranches.ts` query + invalidate shape.

## Verification Run

- `bun run migrations:check` — 353 files, sequence 001..355 ✅
- `bun run audit:edges` — 168 functions, 82 registered, vault function
  picked up; 16 pre-existing warnings unchanged.
- `deno test supabase/functions/_shared/vault-crypto.test.ts` — 14/14 pass
  (round-trip, IV freshness, tamper rejection, wrong-key rejection, base32
  validation, otpauth parsing, RFC 6238 vectors @ T=59 and T=1111111109,
  remaining-seconds calculation).
- `deno test supabase/functions/oem-portal-vault/rate-limit.test.ts` — 3/3
  pass (quota, expiry, key isolation).
- `deno check supabase/functions/oem-portal-vault/index.ts` — clean.
- `bun test apps/web/src/features/oem-portals` — 12/12 pass (utils,
  vault-api client, extended integration test asserting Credentials
  section + Reveal buttons render).
- `bun run build` — root + `apps/web` ✅.

## Deployment Notes

1. Generate a fresh 32-byte key:
   ```
   openssl rand -hex 32
   ```
2. Set it on the Supabase project:
   Dashboard → Edge Functions → `oem-portal-vault` → Secrets →
   `OEM_VAULT_ENCRYPTION_KEY`.
3. `supabase db push` (applies migration 355).
4. `supabase functions deploy oem-portal-vault`.
5. Verify: as admin, add a test shared_login credential and reveal it —
   audit rows `created` then `revealed` should appear in
   `oem_portal_credential_audit_events`.

**Critical operational rule:** once the key is set, it MUST NOT be rotated
without re-encrypting existing rows. `encryption_version` column is in
place so a future migration can perform envelope-wrap re-encryption safely.

## Remaining Manual Acceptance

- Populate verified credentials for the 31 seeded OEMs (real launch URLs
  still need to be set separately — see phase 9 configuration checklist).
- Verify Supabase Edge Function Secrets has `OEM_VAULT_ENCRYPTION_KEY`
  before first operator attempts to add a credential.
- Confirm that production `service_role` key is NOT present in any client
  bundle (standing invariant).

## Remaining Backlog After This Slice

- Row 16 is now fully operable; close only after production credentials
  are populated in a live workspace.
- Out-of-scope (explicit):
  - SSO handoff to OEM portals (a separate slice using the stored creds)
  - Per-rep individual credentials (vs. shared) — wait for OEM signal
  - WebAuthn / hardware-key operator flows
  - Envelope-wrap ceremony for key rotation (`encryption_version` is
    prepared; migration can be written when the first rotation is needed).
