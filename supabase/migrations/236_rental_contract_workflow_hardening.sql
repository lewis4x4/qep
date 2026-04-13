-- ============================================================================
-- Migration 236: Rental Contract Workflow Hardening
-- ============================================================================

alter table public.rental_contracts
  add column if not exists assignment_status text not null default 'assigned';

update public.rental_contracts
set assignment_status = case
  when equipment_id is null then 'pending_assignment'
  else 'assigned'
end
where assignment_status not in ('pending_assignment', 'assigned');

update public.rental_contracts
set
  status = 'reviewing',
  dealer_response = case
    when dealer_response is null or btrim(dealer_response) = '' then
      'Unit assignment is still required before this rental can be approved.'
    when dealer_response ilike '%Unit assignment is still required before this rental can be approved.%' then
      dealer_response
    else
      dealer_response || E'\n\nUnit assignment is still required before this rental can be approved.'
  end
where equipment_id is null
  and status in ('approved', 'awaiting_payment', 'active', 'completed');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'rental_contracts_assignment_status_valid'
      and conrelid = 'public.rental_contracts'::regclass
  ) then
    alter table public.rental_contracts
      add constraint rental_contracts_assignment_status_valid
      check (assignment_status in ('pending_assignment', 'assigned'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'rental_contracts_assignment_requires_pending_status'
      and conrelid = 'public.rental_contracts'::regclass
  ) then
    alter table public.rental_contracts
      add constraint rental_contracts_assignment_requires_pending_status
      check (
        equipment_id is not null
        or assignment_status = 'pending_assignment'
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'rental_contracts_ready_state_requires_assigned_unit'
      and conrelid = 'public.rental_contracts'::regclass
  ) then
    alter table public.rental_contracts
      add constraint rental_contracts_ready_state_requires_assigned_unit
      check (
        status not in ('approved', 'awaiting_payment', 'active', 'completed')
        or (equipment_id is not null and assignment_status = 'assigned')
      );
  end if;
end $$;

create index if not exists idx_rental_contracts_assignment_status
  on public.rental_contracts (workspace_id, assignment_status, status, created_at desc);

comment on column public.rental_contracts.assignment_status is
  'Tracks whether a customer booking already has a concrete unit assigned or is still awaiting dealership assignment.';
