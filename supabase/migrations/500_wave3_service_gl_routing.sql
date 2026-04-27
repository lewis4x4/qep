-- 500_wave3_service_gl_routing.sql
--
-- Wave 3 GL routing wiring. The repo already has public.gl_routing_rules from
-- migration 079 and service_jobs.request_type is a typed enum. Add a typed
-- request_type discriminator to GL rules plus a security-invoker resolver that
-- maps a service job to its canonical request-type GL rule.
--
-- Rollback notes:
--   drop function public.get_service_job_gl_routing_rule(uuid);
--   drop index idx_gl_routing_rules_request_type;
--   alter table public.gl_routing_rules drop column if exists request_type;

alter table public.gl_routing_rules
  add column if not exists request_type public.service_request_type,
  add column if not exists gl_account_id uuid;

comment on column public.gl_routing_rules.request_type is
  'Wave 3 typed link from service_jobs.request_type to canonical GL routing rules.';
comment on column public.gl_routing_rules.gl_account_id is
  'Optional canonical chart-of-accounts link for this routing rule; backfilled from gl_number/account_number when possible.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any(c.conkey)
    where c.conrelid = 'public.gl_routing_rules'::regclass
      and c.contype = 'f'
      and a.attname = 'gl_account_id'
  ) then
    alter table public.gl_routing_rules
      add constraint gl_routing_rules_gl_account_id_wave3_fkey
      foreign key (gl_account_id) references public.gl_accounts(id) on delete set null not valid;
  end if;
end $$;

update public.gl_routing_rules gr
set gl_account_id = ga.id
from public.gl_accounts ga
where gr.gl_account_id is null
  and gr.gl_number is not null
  and ga.workspace_id = coalesce(public.get_my_workspace(), ga.workspace_id)
  and ga.account_number = gr.gl_number
  and ga.deleted_at is null;

-- Backfill from the older free-text ticket_type when values already line up.
update public.gl_routing_rules
set request_type = ticket_type::public.service_request_type
where request_type is null
  and ticket_type in ('repair', 'pm_service', 'inspection', 'machine_down', 'recall', 'warranty');

create index if not exists idx_gl_routing_rules_request_type
  on public.gl_routing_rules (request_type)
  where request_type is not null;
comment on index public.idx_gl_routing_rules_request_type is
  'Purpose: resolve service_jobs.request_type to default GL routing rule during service billing/posting.';

-- Seed one conservative default per service request type. Existing richer rules
-- remain untouched; this only fills the typed request-type routing gap.
insert into public.gl_routing_rules (gl_code, gl_name, gl_number, request_type, description, usage_examples)
select v.gl_code, v.gl_name, v.gl_number, v.request_type::public.service_request_type, v.description, v.usage_examples
from (values
  ('SVC-REPAIR', 'Service Repair Revenue', null, 'repair', 'Default GL routing for customer-pay repair service jobs.', 'service_jobs.request_type = repair'),
  ('SVC-PM', 'Preventive Maintenance Revenue', null, 'pm_service', 'Default GL routing for preventive-maintenance service jobs.', 'service_jobs.request_type = pm_service'),
  ('SVC-INSP', 'Inspection Revenue', null, 'inspection', 'Default GL routing for inspection-only service jobs.', 'service_jobs.request_type = inspection'),
  ('SVC-DOWN', 'Machine Down Service Revenue', null, 'machine_down', 'Default GL routing for machine-down service jobs requiring expedited handling.', 'service_jobs.request_type = machine_down'),
  ('SVC-RECALL', 'Recall/Warranty Campaign Recovery', null, 'recall', 'Default GL routing for recall campaign work orders.', 'service_jobs.request_type = recall'),
  ('SVC-WARR', 'Warranty Service Recovery', null, 'warranty', 'Default GL routing for warranty service jobs.', 'service_jobs.request_type = warranty')
) as v(gl_code, gl_name, gl_number, request_type, description, usage_examples)
where not exists (
  select 1
  from public.gl_routing_rules existing
  where existing.request_type = v.request_type::public.service_request_type
);

create or replace function public.get_service_job_gl_routing_rule(p_service_job_id uuid)
returns table (
  service_job_id uuid,
  request_type public.service_request_type,
  gl_routing_rule_id uuid,
  gl_code text,
  gl_name text,
  gl_number text,
  requires_ownership_approval boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    sj.id as service_job_id,
    sj.request_type,
    gr.id as gl_routing_rule_id,
    gr.gl_code,
    gr.gl_name,
    gr.gl_number,
    coalesce(gr.requires_ownership_approval, false) as requires_ownership_approval
  from public.service_jobs sj
  join public.gl_routing_rules gr
    on gr.request_type = sj.request_type
  where sj.id = p_service_job_id
    and (
      auth.role() = 'service_role'
      or sj.workspace_id = public.get_my_workspace()
    )
  order by gr.requires_ownership_approval desc nulls last, gr.created_at asc
  limit 1;
$$;

comment on function public.get_service_job_gl_routing_rule(uuid) is
  'Security-invoker resolver from service_jobs.request_type to the default Wave 3 typed GL routing rule.';

revoke execute on function public.get_service_job_gl_routing_rule(uuid) from public;
grant execute on function public.get_service_job_gl_routing_rule(uuid) to authenticated, service_role;
