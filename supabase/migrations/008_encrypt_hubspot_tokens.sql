-- SEC-QEP-008: Encrypt HubSpot OAuth tokens at application layer
--
-- Problem (Finding #2): hubspot_connections stores access_token and refresh_token
-- as plaintext. Any database leak or service_role key exposure exposes full HubSpot
-- API access for all connected portals.
--
-- Solution: Application-layer AES-256-GCM encryption via HUBSPOT_ENCRYPTION_KEY.
-- Tokens are encrypted before INSERT/UPDATE and decrypted after SELECT in all edge
-- functions that touch hubspot_connections.
--
-- Migration action: Invalidate all existing plaintext token rows. Users must
-- re-authenticate via /admin → HubSpot Connect. New connections will store
-- encrypted tokens from this point forward.
--
-- Rollback: UPDATE public.hubspot_connections SET is_active = false (already done).
-- No schema changes — column types unchanged. Decryption is app-layer only.

-- Invalidate all existing connections.
-- Existing tokens are stored as plaintext and cannot be encrypted retroactively
-- without the application key at migration time. Affected users will see a
-- "Reconnect HubSpot" prompt in the admin panel.
UPDATE public.hubspot_connections
  SET is_active = false
  WHERE is_active = true;

-- Add a comment to document the encryption scheme for future engineers.
COMMENT ON COLUMN public.hubspot_connections.access_token IS
  'AES-256-GCM encrypted. Format: <12-byte-iv-hex>:<ciphertext-hex>. Key: HUBSPOT_ENCRYPTION_KEY env var.';

COMMENT ON COLUMN public.hubspot_connections.refresh_token IS
  'AES-256-GCM encrypted. Format: <12-byte-iv-hex>:<ciphertext-hex>. Key: HUBSPOT_ENCRYPTION_KEY env var.';
