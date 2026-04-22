-- ============================================================================
-- Migration 358: OEM Portal Credential Vault (Phase 9.1)
--
-- Extends migration 354 (oem_portal_profiles) with server-sealed credential
-- storage. Secrets are encrypted at the application layer with AES-256-GCM
-- (see supabase/functions/_shared/vault-crypto.ts); this schema stores only
-- ciphertext + metadata and enforces append-only audit.
--
-- Access model:
--   - authenticated roles CANNOT select/insert/update/delete oem_portal_credentials
--     directly. All operator IO goes through the oem-portal-vault edge function
--     using the service role key.
--   - admin|manager|owner CAN select oem_portal_credentials_safe (metadata only)
--     for their workspace so the UI can render credential cards.
--   - audit events are readable by admin|manager|owner; no one except
--     service_role can write them. The audit rows are trigger-generated.
--
-- Rollback notes (reverse order):
--   1. drop trigger log_oem_portal_credentials_change_trg on oem_portal_credentials.
--   2. drop function log_oem_portal_credential_change().
--   3. drop trigger set_oem_portal_credentials_updated_at on oem_portal_credentials.
--   4. drop policies on oem_portal_credential_audit_events, oem_portal_credentials.
--   5. drop view oem_portal_credentials_safe.
--   6. drop indexes.
--   7. drop table oem_portal_credential_audit_events, oem_portal_credentials.
-- ============================================================================

-- ── Table: oem_portal_credentials (ciphertext + metadata) ──────────────────
create table public.oem_portal_credentials (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  oem_portal_profile_id uuid not null
    references public.oem_portal_profiles(id)
    on delete cascade,
  kind text not null check (
    kind in ('shared_login', 'api_key', 'oauth_client', 'totp_seed')
  ),
  label text not null,
  username_cipher text,              -- AES-256-GCM "<iv_hex>:<ciphertext_hex>"
  secret_cipher text,                -- AES-256-GCM
  totp_seed_cipher text,             -- AES-256-GCM of base32-normalized seed
  totp_issuer text,                  -- display-only otpauth issuer
  totp_account text,                 -- display-only otpauth account label
  encryption_version smallint not null default 1,
  expires_at timestamptz,
  rotation_interval_days integer,
  last_rotated_at timestamptz,
  last_rotated_by uuid references public.profiles(id) on delete set null,
  last_revealed_at timestamptz,
  last_revealed_by uuid references public.profiles(id) on delete set null,
  reveal_count integer not null default 0,
  reveal_allowed_for_reps boolean not null default false,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.oem_portal_credentials is
  'Server-sealed credential vault for oem_portal_profiles. Ciphertext only; plaintext never enters Postgres. All access via oem-portal-vault edge function.';

create unique index idx_oem_portal_credentials_unique_label_active
  on public.oem_portal_credentials(oem_portal_profile_id, kind, label)
  where deleted_at is null;

create index idx_oem_portal_credentials_workspace_portal
  on public.oem_portal_credentials(workspace_id, oem_portal_profile_id, kind, created_at desc)
  where deleted_at is null;

alter table public.oem_portal_credentials enable row level security;

-- Service role is the only writer/reader of ciphertext. All operator IO
-- goes through the edge function using the service key.
create policy "oem_portal_credentials_service_all"
  on public.oem_portal_credentials for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_oem_portal_credentials_updated_at
  before update on public.oem_portal_credentials
  for each row execute function public.set_updated_at();

-- ── View: oem_portal_credentials_safe (metadata only, no ciphertext) ──────
create or replace view public.oem_portal_credentials_safe as
select
  c.id,
  c.workspace_id,
  c.oem_portal_profile_id,
  c.kind,
  c.label,
  (c.username_cipher is not null) as has_username,
  (c.secret_cipher is not null) as has_secret,
  (c.totp_seed_cipher is not null) as has_totp,
  c.totp_issuer,
  c.totp_account,
  c.encryption_version,
  c.expires_at,
  c.rotation_interval_days,
  c.last_rotated_at,
  c.last_rotated_by,
  c.last_revealed_at,
  c.last_revealed_by,
  c.reveal_count,
  c.reveal_allowed_for_reps,
  c.notes,
  c.created_by,
  c.created_at,
  c.updated_at
from public.oem_portal_credentials c
where c.deleted_at is null;

comment on view public.oem_portal_credentials_safe is
  'Operator-safe projection of oem_portal_credentials — metadata only, no ciphertext columns.';

-- Views in Postgres inherit RLS from their base tables when declared with
-- security_invoker. Since the base table locks non-service roles out, we
-- expose a dedicated policy via a SECURITY DEFINER function so admins and
-- (optionally) reps can read metadata without seeing ciphertext.
create or replace function public.oem_portal_credential_meta_for_role()
returns table (
  id uuid,
  workspace_id text,
  oem_portal_profile_id uuid,
  kind text,
  label text,
  has_username boolean,
  has_secret boolean,
  has_totp boolean,
  totp_issuer text,
  totp_account text,
  encryption_version smallint,
  expires_at timestamptz,
  rotation_interval_days integer,
  last_rotated_at timestamptz,
  last_rotated_by uuid,
  last_revealed_at timestamptz,
  last_revealed_by uuid,
  reveal_count integer,
  reveal_allowed_for_reps boolean,
  notes text,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    c.id, c.workspace_id, c.oem_portal_profile_id, c.kind, c.label,
    (c.username_cipher is not null), (c.secret_cipher is not null),
    (c.totp_seed_cipher is not null),
    c.totp_issuer, c.totp_account, c.encryption_version,
    c.expires_at, c.rotation_interval_days,
    c.last_rotated_at, c.last_rotated_by,
    c.last_revealed_at, c.last_revealed_by,
    c.reveal_count, c.reveal_allowed_for_reps,
    c.notes, c.created_by, c.created_at, c.updated_at
  from public.oem_portal_credentials c
  where c.deleted_at is null
    and c.workspace_id = public.get_my_workspace()
    and (
      public.get_my_role() in ('admin', 'manager', 'owner')
      or (public.get_my_role() = 'rep' and c.reveal_allowed_for_reps = true)
    );
$$;

revoke execute on function public.oem_portal_credential_meta_for_role() from public;
grant execute on function public.oem_portal_credential_meta_for_role() to authenticated;

comment on function public.oem_portal_credential_meta_for_role() is
  'Role-gated metadata accessor. Admin|manager|owner see all workspace credentials; rep sees only rows flagged reveal_allowed_for_reps.';

-- ── Table: oem_portal_credential_audit_events (append-only) ────────────────
create table public.oem_portal_credential_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  oem_portal_profile_id uuid
    references public.oem_portal_profiles(id) on delete set null,
  credential_id uuid
    references public.oem_portal_credentials(id) on delete set null,
  event_type text not null check (
    event_type in (
      'created','updated','rotated','revealed','totp_generated',
      'deleted','reveal_denied','rate_limited'
    )
  ),
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_role text,
  reason text,
  request_id text,
  ip inet,
  user_agent text,
  changed_fields text[] not null default array[]::text[],
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

comment on table public.oem_portal_credential_audit_events is
  'Append-only audit trail for oem_portal_credentials. Never written by UI; only by the log_oem_portal_credential_change trigger and the oem-portal-vault edge function for reveal/totp/rate-limit events.';

create index idx_oem_portal_credential_audit_portal_occurred
  on public.oem_portal_credential_audit_events(workspace_id, oem_portal_profile_id, occurred_at desc);

create index idx_oem_portal_credential_audit_credential_occurred
  on public.oem_portal_credential_audit_events(credential_id, occurred_at desc);

create index idx_oem_portal_credential_audit_actor_occurred
  on public.oem_portal_credential_audit_events(actor_user_id, occurred_at desc);

create index idx_oem_portal_credential_audit_event_type
  on public.oem_portal_credential_audit_events(event_type, occurred_at desc);

alter table public.oem_portal_credential_audit_events enable row level security;

create policy "oem_portal_credential_audit_select_elevated"
  on public.oem_portal_credential_audit_events for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "oem_portal_credential_audit_service_all"
  on public.oem_portal_credential_audit_events for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── Trigger: log_oem_portal_credential_change ─────────────────────────────
-- Mirrors migration 023's log_integration_status_credential_change pattern.
-- Fires on INSERT/UPDATE/DELETE of oem_portal_credentials and records a
-- cryptographically-blind audit row (no plaintext, no ciphertext).
create or replace function public.log_oem_portal_credential_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  evt text;
  fields text[] := array[]::text[];
  actor text;
  req_id text;
begin
  if (tg_op = 'INSERT') then
    evt := 'created';
    if new.username_cipher is not null then fields := array_append(fields, 'username'); end if;
    if new.secret_cipher is not null then fields := array_append(fields, 'secret'); end if;
    if new.totp_seed_cipher is not null then fields := array_append(fields, 'totp_seed'); end if;
  elsif (tg_op = 'UPDATE') then
    -- soft-delete wins
    if old.deleted_at is null and new.deleted_at is not null then
      evt := 'deleted';
    elsif
      (old.username_cipher is distinct from new.username_cipher)
      or (old.secret_cipher is distinct from new.secret_cipher)
      or (old.totp_seed_cipher is distinct from new.totp_seed_cipher)
    then
      evt := 'rotated';
      if old.username_cipher is distinct from new.username_cipher then
        fields := array_append(fields, 'username');
      end if;
      if old.secret_cipher is distinct from new.secret_cipher then
        fields := array_append(fields, 'secret');
      end if;
      if old.totp_seed_cipher is distinct from new.totp_seed_cipher then
        fields := array_append(fields, 'totp_seed');
      end if;
    else
      evt := 'updated';
      if old.label is distinct from new.label then fields := array_append(fields, 'label'); end if;
      if old.notes is distinct from new.notes then fields := array_append(fields, 'notes'); end if;
      if old.reveal_allowed_for_reps is distinct from new.reveal_allowed_for_reps then
        fields := array_append(fields, 'reveal_allowed_for_reps');
      end if;
      if old.expires_at is distinct from new.expires_at then fields := array_append(fields, 'expires_at'); end if;
      if old.rotation_interval_days is distinct from new.rotation_interval_days then
        fields := array_append(fields, 'rotation_interval_days');
      end if;
      -- if nothing material changed, skip audit entirely
      if array_length(fields, 1) is null then
        return new;
      end if;
    end if;
  else  -- DELETE (hard delete; soft delete is handled above)
    evt := 'deleted';
  end if;

  actor := case
    when auth.role() = 'service_role' then 'service_role'
    else coalesce(public.get_my_role()::text, 'unknown')
  end;

  req_id := nullif(current_setting('request.header.x-request-id', true), '');

  insert into public.oem_portal_credential_audit_events (
    workspace_id, oem_portal_profile_id, credential_id, event_type,
    actor_user_id, actor_role, changed_fields, request_id, metadata
  )
  values (
    coalesce(new.workspace_id, old.workspace_id),
    coalesce(new.oem_portal_profile_id, old.oem_portal_profile_id),
    coalesce(new.id, old.id),
    evt,
    auth.uid(),
    actor,
    fields,
    req_id,
    jsonb_build_object(
      'kind', coalesce(new.kind, old.kind),
      'label', coalesce(new.label, old.label)
    )
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists log_oem_portal_credentials_change_trg on public.oem_portal_credentials;

create trigger log_oem_portal_credentials_change_trg
  after insert or update or delete on public.oem_portal_credentials
  for each row execute function public.log_oem_portal_credential_change();

-- ── Rollback (manual, reverse order) ───────────────────────────────────────
-- drop trigger if exists log_oem_portal_credentials_change_trg on public.oem_portal_credentials;
-- drop function if exists public.log_oem_portal_credential_change();
-- drop function if exists public.oem_portal_credential_meta_for_role();
-- drop policy if exists "oem_portal_credential_audit_service_all" on public.oem_portal_credential_audit_events;
-- drop policy if exists "oem_portal_credential_audit_select_elevated" on public.oem_portal_credential_audit_events;
-- drop table if exists public.oem_portal_credential_audit_events;
-- drop policy if exists "oem_portal_credentials_service_all" on public.oem_portal_credentials;
-- drop view if exists public.oem_portal_credentials_safe;
-- drop trigger if exists set_oem_portal_credentials_updated_at on public.oem_portal_credentials;
-- drop index if exists idx_oem_portal_credentials_workspace_portal;
-- drop index if exists idx_oem_portal_credentials_unique_label_active;
-- drop table if exists public.oem_portal_credentials;
