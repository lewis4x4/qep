-- ============================================================================
-- 550_quote_availability_governance_hardening.sql
--
-- Hotfixes review blockers in the quote availability ops workflow:
-- - reps cannot directly update sensitive availability request fields
-- - audit timeline is append-only outside service_role
-- - child rows must match parent request workspace
-- - rep-owned request reads have a supporting index
-- ============================================================================

-- Reps can create requests through RLS, but operational state changes must flow
-- through quote-builder-v2 so status, override, and event writes stay coherent.
drop policy if exists "qar_rep_update_own_pending" on public.quote_availability_requests;

-- Keep manager/admin/owner request management, but direct event mutation must not
-- be available because quote_availability_events is the audit trail.
drop policy if exists "qae_manage" on public.quote_availability_events;

-- Defense in depth: even if a future policy accidentally grants update/delete,
-- reject audit event mutation for non-service execution paths.
create or replace function public.prevent_quote_availability_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'quote_availability_events is append-only';
end;
$$;

drop trigger if exists trg_quote_availability_events_append_only on public.quote_availability_events;
create trigger trg_quote_availability_events_append_only
  before update or delete on public.quote_availability_events
  for each row execute function public.prevent_quote_availability_event_mutation();

-- Enforce child/parent workspace consistency. FKs remain UUID-based for existing
-- references; these triggers prevent mismatched workspace_id rows.
create or replace function public.enforce_quote_availability_candidate_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.quote_availability_requests request
    where request.id = new.request_id
      and request.workspace_id = new.workspace_id
  ) then
    raise exception 'quote availability candidate workspace must match parent request';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_quote_availability_candidates_workspace on public.quote_availability_candidates;
create trigger trg_quote_availability_candidates_workspace
  before insert or update of request_id, workspace_id on public.quote_availability_candidates
  for each row execute function public.enforce_quote_availability_candidate_workspace();

create or replace function public.enforce_quote_availability_event_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.quote_availability_requests request
    where request.id = new.request_id
      and request.workspace_id = new.workspace_id
  ) then
    raise exception 'quote availability event workspace must match parent request';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_quote_availability_events_workspace on public.quote_availability_events;
create trigger trg_quote_availability_events_workspace
  before insert on public.quote_availability_events
  for each row execute function public.enforce_quote_availability_event_workspace();

create index if not exists idx_quote_availability_requests_requested_by
  on public.quote_availability_requests (workspace_id, requested_by, created_at desc);
