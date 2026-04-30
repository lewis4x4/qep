-- ============================================================================
-- Migration 519: harden IntelliDealer commit status transitions
--
-- The edge function already gates canonical commit to staged runs. This trigger
-- adds a database-level guard so even privileged callers cannot move a run into
-- committing unless it was explicitly staged first.
-- ============================================================================

create or replace function public.qrm_intellidealer_commit_transition_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'committing' and old.status is distinct from 'staged' then
    raise exception 'INTELLIDEALER_COMMIT_REQUIRES_STAGED_RUN';
  end if;

  if new.status = 'committed' and old.status not in ('committing', 'staged') then
    raise exception 'INTELLIDEALER_COMMITTED_REQUIRES_COMMITTING_RUN';
  end if;

  return new;
end;
$$;

revoke execute on function public.qrm_intellidealer_commit_transition_guard() from public;

drop trigger if exists qrm_intellidealer_commit_transition_guard
  on public.qrm_intellidealer_customer_import_runs;

create trigger qrm_intellidealer_commit_transition_guard
  before update of status on public.qrm_intellidealer_customer_import_runs
  for each row
  execute function public.qrm_intellidealer_commit_transition_guard();

comment on function public.qrm_intellidealer_commit_transition_guard() is
  'Prevents IntelliDealer import runs from entering committing/committed states unless the run passed through staged first.';

-- ============================================================================
-- Migration 519 complete.
-- ============================================================================
