-- ============================================================================
-- Migration 297: QB Notifications — updated_at column + secure mark-read RPC
--
-- Fixes:
--   F8: qb_notifications was missing updated_at timestamptz (violates CLAUDE.md
--       convention that all new tables must have created_at + updated_at).
--       Adds the column + attaches the existing set_updated_at() trigger.
--
--   F7: The "qb_notifications mark read" UPDATE policy allowed users to mutate
--       ALL columns on their own notification rows (type, title, body, metadata)
--       not just read_at. This drops that open UPDATE policy and replaces it
--       with a SECURITY DEFINER RPC that updates ONLY read_at + updated_at.
--       Authenticated users call mark_notification_read(notification_id) instead
--       of issuing a raw UPDATE.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + DROP POLICY IF EXISTS + CREATE OR REPLACE.
-- ============================================================================

-- ── F8: Add updated_at column ────────────────────────────────────────────────

alter table public.qb_notifications
  add column if not exists updated_at timestamptz not null default now();

-- Attach trigger so any UPDATE keeps updated_at current
create trigger qb_notifications_updated_at
  before update on public.qb_notifications
  for each row execute function public.set_updated_at();

-- ── F7: Drop the open UPDATE policy ─────────────────────────────────────────

do $$ begin
  if exists (
    select 1 from pg_policies
    where tablename = 'qb_notifications'
      and policyname = 'qb_notifications mark read'
  ) then
    execute 'drop policy "qb_notifications mark read" on public.qb_notifications';
  end if;
end $$;

-- ── F7: Create SECURITY DEFINER RPC that updates ONLY read_at ────────────────

create or replace function public.mark_notification_read(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.qb_notifications
     set read_at    = now(),
         updated_at = now()
   where id      = p_notification_id
     and user_id = auth.uid();
  -- Silently no-ops if the notification doesn't belong to the calling user.
end;
$$;

grant execute on function public.mark_notification_read(uuid) to authenticated;

comment on function public.mark_notification_read(uuid) is
  'Marks a notification as read for the calling user. '
  'SECURITY DEFINER ensures only read_at and updated_at are mutated — '
  'callers cannot overwrite type/title/body/metadata via this path.';
