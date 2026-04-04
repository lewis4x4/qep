-- ============================================================================
-- Migration 065: Pre-Build RLS Hardening
--
-- Fixes two RLS recursion risks identified in the pre-build audit:
-- 1. chat_messages policy queries chat_conversations (which has RLS enabled)
-- 2. onedrive_sync_state uses legacy profiles subselect instead of get_my_role()
--
-- Also adds a token format validation function for hubspot_connections to
-- prevent accidental plaintext token storage.
-- ============================================================================

-- ── Fix 1: chat_messages RLS recursion ──────────────────────────────────────

-- Create SECURITY DEFINER helper to check conversation ownership
-- without triggering chat_conversations RLS evaluation.
create or replace function public.user_owns_conversation(p_conversation_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.chat_conversations c
    where c.id = p_conversation_id
    and c.user_id = auth.uid()
  );
$$;

revoke execute on function public.user_owns_conversation(uuid) from public;
grant execute on function public.user_owns_conversation(uuid) to authenticated;

-- Drop and recreate chat_messages policies using the helper
drop policy if exists "chat_messages_own" on public.chat_messages;
create policy "chat_messages_own" on public.chat_messages
  for all using (public.user_owns_conversation(conversation_id))
  with check (public.user_owns_conversation(conversation_id));

-- Elevated access policy stays as-is (it uses get_my_role() already)

-- ── Fix 2: onedrive_sync_state RLS ──────────────────────────────────────────

-- Replace legacy profiles subselect with get_my_role()
drop policy if exists "onedrive_sync_owner" on public.onedrive_sync_state;
create policy "onedrive_sync_owner" on public.onedrive_sync_state
  for all using (
    user_id = auth.uid()
    or public.get_my_role() = 'owner'
  );

-- ── Fix 3: HubSpot token format validation ──────────────────────────────────

-- Validation function to ensure tokens are stored in encrypted format (iv:ciphertext)
-- The encrypted format always contains a colon separator between the hex IV and hex ciphertext.
-- A plaintext OAuth token will never contain this pattern (they are base64url without colons).
create or replace function public.validate_hubspot_token_format()
returns trigger
language plpgsql
as $$
begin
  -- Only validate non-null tokens
  if NEW.access_token is not null and NEW.access_token !~ '^[0-9a-f]+:[0-9a-f]+$' then
    raise exception 'access_token must be in encrypted format (hex:hex). Plaintext tokens are not allowed.';
  end if;
  if NEW.refresh_token is not null and NEW.refresh_token !~ '^[0-9a-f]+:[0-9a-f]+$' then
    raise exception 'refresh_token must be in encrypted format (hex:hex). Plaintext tokens are not allowed.';
  end if;
  return NEW;
end;
$$;

-- Apply trigger on insert and update
drop trigger if exists enforce_hubspot_token_encryption on public.hubspot_connections;
create trigger enforce_hubspot_token_encryption
  before insert or update of access_token, refresh_token
  on public.hubspot_connections
  for each row
  execute function public.validate_hubspot_token_format();
