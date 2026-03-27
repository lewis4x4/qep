-- SEC-QEP-001 remediation: rename misleading _encrypted columns in onedrive_sync_state
-- Columns were labeled "encrypted" but stored plaintext tokens.
-- Renaming removes the false security claim. Actual encryption (pgp_sym_encrypt or
-- Supabase Vault) should be implemented before storing live production tokens.

alter table public.onedrive_sync_state
  rename column access_token_encrypted to access_token;

alter table public.onedrive_sync_state
  rename column refresh_token_encrypted to refresh_token;

comment on column public.onedrive_sync_state.access_token is
  'OneDrive OAuth access token. TODO: encrypt at rest using pgp_sym_encrypt or Supabase Vault before production use.';

comment on column public.onedrive_sync_state.refresh_token is
  'OneDrive OAuth refresh token. TODO: encrypt at rest using pgp_sym_encrypt or Supabase Vault before production use.';

-- Rollback:
-- alter table public.onedrive_sync_state rename column access_token to access_token_encrypted;
-- alter table public.onedrive_sync_state rename column refresh_token to refresh_token_encrypted;
