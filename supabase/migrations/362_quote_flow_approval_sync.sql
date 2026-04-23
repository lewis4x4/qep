-- ============================================================================
-- Migration 362: Quote flow approval status sync
--
-- Keeps quote_packages.status aligned with Flow Engine approval decisions for
-- the quote-manager-approval workflow so Approval Center and Flow Admin use
-- the same underlying state transitions.
-- ============================================================================

create or replace function public.sync_quote_status_from_flow_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote_package_id uuid;
  v_next_status text;
begin
  if NEW.workflow_slug <> 'quote-manager-approval' then
    return NEW;
  end if;

  if NEW.status = OLD.status then
    return NEW;
  end if;

  v_quote_package_id := nullif(NEW.context_summary ->> 'quote_package_id', '')::uuid;
  if v_quote_package_id is null then
    return NEW;
  end if;

  v_next_status := case
    when NEW.status = 'approved' then 'approved'
    when NEW.status in ('rejected', 'cancelled', 'expired') then 'draft'
    else null
  end;

  if v_next_status is null then
    return NEW;
  end if;

  update public.quote_packages
  set status = v_next_status
  where id = v_quote_package_id;

  return NEW;
end;
$$;

drop trigger if exists trg_sync_quote_status_from_flow_approval on public.flow_approvals;

create trigger trg_sync_quote_status_from_flow_approval
  after update on public.flow_approvals
  for each row
  execute function public.sync_quote_status_from_flow_approval();
