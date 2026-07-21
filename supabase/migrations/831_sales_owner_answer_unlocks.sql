-- ============================================================================
-- Migration 831: Sales owner-answer unlocks (SA6-SA8 data plane)
--
-- SA6: prospect quotes are allowed; a durable qrm_prospects row is created
--      when the quote is sent, and acceptance converts the prospect to a
--      cash-only customer while opening a Tina/Ryan credit approval handoff.
-- SA7: OEM program stacking keeps program/effective-date provenance back to
--      the reviewed manufacturer worksheet. No manufacturer rules are guessed.
-- SA8: one availability business query fans out to SMS and 8x8 delivery rows,
--      with cross-channel dedupe and one-channel-per-user mute preferences.
--
-- Provider dispatch is intentionally separate from this migration. A queued
-- row is evidence of requested delivery, not evidence that 8x8/Twilio sent it.
-- ============================================================================

begin;

-- --------------------------------------------------------------------------
-- SA6: quote prospect -> customer + credit-approval lifecycle
-- --------------------------------------------------------------------------

create table if not exists public.quote_prospect_lifecycles (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  quote_package_id uuid not null references public.quote_packages(id) on delete cascade,
  prospect_id uuid not null references public.qrm_prospects(id) on delete restrict,
  customer_company_id uuid references public.qrm_companies(id) on delete set null,
  customer_contact_id uuid references public.qrm_contacts(id) on delete set null,
  lifecycle_status text not null default 'sent_prospect'
    check (lifecycle_status in (
      'sent_prospect',
      'customer_cash_only',
      'linked_existing_customer',
      'credit_approved',
      'credit_denied'
    )),
  prospect_created_at timestamptz not null default now(),
  customer_converted_at timestamptz,
  conversion_method text check (
    conversion_method is null
    or conversion_method in ('created_customer', 'linked_existing_customer')
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, quote_package_id),
  unique (prospect_id)
);

create index if not exists idx_quote_prospect_lifecycles_company
  on public.quote_prospect_lifecycles (workspace_id, customer_company_id)
  where customer_company_id is not null;

create index if not exists idx_quote_prospect_lifecycles_contact
  on public.quote_prospect_lifecycles (workspace_id, customer_contact_id)
  where customer_contact_id is not null;

drop trigger if exists set_quote_prospect_lifecycles_updated_at
  on public.quote_prospect_lifecycles;
create trigger set_quote_prospect_lifecycles_updated_at
  before update on public.quote_prospect_lifecycles
  for each row execute function public.set_updated_at();

create table if not exists public.sales_customer_credit_approval_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  quote_package_id uuid not null references public.quote_packages(id) on delete restrict,
  company_id uuid not null references public.qrm_companies(id) on delete restrict,
  requested_by uuid references public.profiles(id) on delete set null,
  assigned_principal text not null default 'tina_or_ryan'
    check (assigned_principal = 'tina_or_ryan'),
  status text not null default 'pending'
    check (status in ('pending', 'needs_information', 'approved', 'denied', 'cancelled')),
  requested_terms_code text,
  requested_credit_limit_cents bigint check (
    requested_credit_limit_cents is null or requested_credit_limit_cents >= 0
  ),
  approved_terms_code text,
  approved_credit_limit_cents bigint check (
    approved_credit_limit_cents is null or approved_credit_limit_cents >= 0
  ),
  decision_by uuid references public.profiles(id) on delete set null,
  decision_note text,
  decided_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, quote_package_id)
);

create index if not exists idx_sales_credit_approval_company_status
  on public.sales_customer_credit_approval_requests
    (workspace_id, company_id, status, created_at desc);

create index if not exists idx_sales_credit_approval_requested_by
  on public.sales_customer_credit_approval_requests
    (workspace_id, requested_by, created_at desc)
  where requested_by is not null;

create index if not exists idx_sales_credit_approval_decision_by
  on public.sales_customer_credit_approval_requests
    (workspace_id, decision_by, decided_at desc)
  where decision_by is not null;

drop trigger if exists set_sales_customer_credit_approval_updated_at
  on public.sales_customer_credit_approval_requests;
create trigger set_sales_customer_credit_approval_updated_at
  before update on public.sales_customer_credit_approval_requests
  for each row execute function public.set_updated_at();

alter table public.quote_prospect_lifecycles enable row level security;
alter table public.sales_customer_credit_approval_requests enable row level security;

-- Reuse the immutable principal bindings introduced for quarter reopen.  The
-- owner-answer packet names Tina/Ryan, but a mutable profile display name is
-- not an authorization boundary.  A null binding intentionally means the
-- approval lane is not ready yet.
alter table public.finance_approval_principals
  drop constraint if exists finance_approval_principals_approval_scope_check;
alter table public.finance_approval_principals
  add constraint finance_approval_principals_approval_scope_check
  check (approval_scope in ('quarter_reopen', 'sales_credit'));

insert into public.finance_approval_principals (
  workspace_id,
  approval_scope,
  approval_role,
  expected_name,
  profile_id,
  is_active
)
select
  principal.workspace_id,
  'sales_credit',
  principal.approval_role,
  principal.expected_name,
  principal.profile_id,
  principal.is_active
from public.finance_approval_principals principal
where principal.approval_scope = 'quarter_reopen'
on conflict (workspace_id, approval_scope, approval_role) do update
set expected_name = excluded.expected_name,
    profile_id = coalesce(
      public.finance_approval_principals.profile_id,
      excluded.profile_id
    ),
    updated_at = now();

-- The principal table is configuration with authorization consequences.
-- Authenticated owners retain read access through the finance policy, but no
-- user (including an owner) can directly insert, replace, or delete a binding.
drop policy if exists "finance_approval_principals_owner_mutate"
  on public.finance_approval_principals;
revoke insert, update, delete on public.finance_approval_principals
  from public, anon, authenticated, service_role;

create table if not exists public.finance_approval_principal_binding_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  principal_id uuid not null
    references public.finance_approval_principals(id) on delete restrict,
  approval_scope text not null,
  approval_role text not null,
  bound_profile_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (length(trim(reason)) >= 10),
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_kind text not null default 'service_role'
    check (actor_kind = 'service_role'),
  created_at timestamptz not null default now(),
  unique (principal_id)
);

comment on table public.finance_approval_principal_binding_events is
  'Append-only evidence for the one permitted null-to-profile approval-principal binding. Existing bindings are never replaced by mutable names.';

alter table public.finance_approval_principal_binding_events enable row level security;

create policy "finance_approval_principal_binding_events_service_read"
  on public.finance_approval_principal_binding_events for select
  using ((select auth.role()) = 'service_role');

create policy "finance_approval_principal_binding_events_finance_read"
  on public.finance_approval_principal_binding_events for select
  using (
    workspace_id = (select public.get_my_workspace())
    and public.qep_finance_can_read()
  );

revoke all on public.finance_approval_principal_binding_events
  from public, anon, authenticated, service_role;
grant select on public.finance_approval_principal_binding_events
  to authenticated, service_role;

create or replace function public.finance_bind_approval_principal(
  p_workspace_id text,
  p_approval_scope text,
  p_approval_role text,
  p_profile_id uuid,
  p_reason text
)
returns public.finance_approval_principals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_principal public.finance_approval_principals;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'approval-principal binding requires service_role';
  end if;
  if p_profile_id is null then
    raise exception 'approval-principal profile_id is required';
  end if;
  if nullif(trim(p_reason), '') is null or length(trim(p_reason)) < 10 then
    raise exception 'approval-principal binding reason must be at least 10 characters';
  end if;

  select principal.*
    into v_principal
  from public.finance_approval_principals principal
  where principal.workspace_id = p_workspace_id
    and principal.approval_scope = p_approval_scope
    and principal.approval_role = p_approval_role
  for update;

  if v_principal.id is null then
    raise exception 'approval-principal slot not found';
  end if;
  if v_principal.profile_id = p_profile_id then
    return v_principal;
  end if;
  if v_principal.profile_id is not null then
    raise exception 'approval-principal binding is immutable';
  end if;
  if not exists (
    select 1
    from public.profiles profile
    join public.profile_workspaces membership
      on membership.profile_id = profile.id
     and membership.workspace_id = p_workspace_id
    where profile.id = p_profile_id
      and profile.is_active = true
  ) then
    raise exception 'approval-principal profile must be active in the target workspace';
  end if;

  update public.finance_approval_principals
  set profile_id = p_profile_id,
      updated_at = now()
  where id = v_principal.id
    and profile_id is null
  returning * into v_principal;

  if v_principal.profile_id is distinct from p_profile_id then
    raise exception 'approval-principal binding lost a concurrent race';
  end if;

  insert into public.finance_approval_principal_binding_events (
    workspace_id,
    principal_id,
    approval_scope,
    approval_role,
    bound_profile_id,
    reason,
    actor_profile_id
  ) values (
    v_principal.workspace_id,
    v_principal.id,
    v_principal.approval_scope,
    v_principal.approval_role,
    v_principal.profile_id,
    trim(p_reason),
    (select auth.uid())
  );

  return v_principal;
end;
$$;

revoke all on function public.finance_bind_approval_principal(text, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.finance_bind_approval_principal(text, text, text, uuid, text)
  to service_role;

create or replace view public.v_finance_approval_principal_readiness
with (security_invoker = true)
as
select
  principal.workspace_id,
  principal.approval_scope,
  principal.approval_role,
  principal.expected_name,
  principal.profile_id,
  principal.is_active,
  coalesce(profile.is_active, false) as profile_is_active,
  (membership.profile_id is not null) as workspace_membership_present,
  (
    principal.is_active
    and principal.profile_id is not null
    and coalesce(profile.is_active, false)
    and membership.profile_id is not null
  ) as ready,
  case
    when not principal.is_active then 'inactive'
    when principal.profile_id is null then 'profile_binding_required'
    when not coalesce(profile.is_active, false) then 'bound_profile_inactive'
    when membership.profile_id is null then 'workspace_membership_required'
    else 'ready'
  end as readiness_status
from public.finance_approval_principals principal
left join public.profiles profile
  on profile.id = principal.profile_id
left join public.profile_workspaces membership
  on membership.profile_id = principal.profile_id
 and membership.workspace_id = principal.workspace_id;

comment on view public.v_finance_approval_principal_readiness is
  'Owner/finance readiness for immutable approval bindings. profile_binding_required is a hard block; expected_name is informational and never authorizes.';

create or replace function public.qrm_can_access_customer_financial()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.role() = 'service_role'
    or coalesce(public.get_my_role()::text, '') in (
      'admin', 'manager', 'owner', 'finance_admin'
    );
$$;

comment on function public.qrm_can_access_customer_financial() is
  'Returns true for service callers and explicitly elevated QEP roles, including finance_admin, allowed to view/write sensitive customer finance fields.';

revoke execute on function public.qrm_can_access_customer_financial() from public;
grant execute on function public.qrm_can_access_customer_financial()
  to authenticated, service_role;

create or replace function public.is_sales_credit_principal(
  p_workspace_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.finance_approval_principals principal
    join public.profiles profile
      on profile.id = principal.profile_id
    join public.profile_workspaces membership
      on membership.profile_id = profile.id
     and membership.workspace_id = p_workspace_id
    where principal.workspace_id = p_workspace_id
      and principal.approval_scope = 'sales_credit'
      and principal.is_active = true
      and principal.profile_id is not null
      and principal.profile_id = auth.uid()
      and profile.is_active = true
  );
$$;

comment on function public.is_sales_credit_principal(text) is
  'SA6 owner-answer authorization: only an active, immutable sales_credit principal binding with workspace membership may decide new-customer terms and credit limits. Display names never authorize.';

revoke all on function public.is_sales_credit_principal(text)
  from public, anon;
grant execute on function public.is_sales_credit_principal(text)
  to authenticated, service_role;

-- Harden the earlier quarter-reopen decision path too: an unbound principal is
-- a configuration blocker, never an invitation to authorize by display name.
create or replace function public.decide_gl_quarter_reopen(
  p_request_id uuid,
  p_decision text,
  p_attestation text
)
returns public.quarter_reopen_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.quarter_reopen_requests;
  v_actor public.profiles;
  v_principal public.finance_approval_principals;
  v_approval_role text;
  v_approve_count integer;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'decision must be approve or reject';
  end if;
  if nullif(trim(p_attestation), '') is null
     or length(trim(p_attestation)) < 5 then
    raise exception 'approval attestation must be at least 5 characters';
  end if;

  select * into v_request
  from public.quarter_reopen_requests request
  where request.id = p_request_id
    and request.workspace_id = public.get_my_workspace()
  for update;

  if v_request.id is null
     or v_request.status not in ('pending', 'partially_approved') then
    raise exception 'quarter reopen request is not awaiting approval';
  end if;

  select profile.* into v_actor
  from public.profiles profile
  join public.profile_workspaces membership
    on membership.profile_id = profile.id
   and membership.workspace_id = v_request.workspace_id
  where profile.id = auth.uid()
    and profile.is_active = true;

  if v_actor.id is null then
    raise exception 'approval requires an active workspace profile';
  end if;

  v_approval_role := case v_actor.role::text
    when 'owner' then 'owner'
    when 'finance_admin' then 'finance_controller'
    else null
  end;
  if v_approval_role is null then
    raise exception 'quarter reopen approval requires owner or finance_admin role';
  end if;

  select * into v_principal
  from public.finance_approval_principals principal
  where principal.workspace_id = v_request.workspace_id
    and principal.approval_scope = 'quarter_reopen'
    and principal.approval_role = v_approval_role
    and principal.is_active = true;

  if v_principal.id is null or v_principal.profile_id is null then
    raise exception 'quarter-reopen % principal binding is required', v_approval_role
      using errcode = '55000';
  end if;
  if v_principal.profile_id <> v_actor.id then
    raise exception 'actor is not the bound % quarter-reopen principal', v_approval_role
      using errcode = '42501';
  end if;

  insert into public.quarter_reopen_approvals (
    workspace_id,
    request_id,
    approval_role,
    approver_id,
    decision,
    attestation
  ) values (
    v_request.workspace_id,
    v_request.id,
    v_approval_role,
    v_actor.id,
    p_decision,
    trim(p_attestation)
  );

  if p_decision = 'reject' then
    update public.quarter_reopen_requests
    set status = 'rejected', updated_at = now()
    where id = v_request.id
    returning * into v_request;
    return v_request;
  end if;

  select count(*) into v_approve_count
  from public.quarter_reopen_approvals approval
  where approval.request_id = v_request.id
    and approval.decision = 'approve';

  update public.quarter_reopen_requests
  set status = case
        when v_approve_count = 2 then 'approved'
        else 'partially_approved'
      end,
      updated_at = now()
  where id = v_request.id
  returning * into v_request;

  return v_request;
end;
$$;

comment on function public.decide_gl_quarter_reopen(uuid, text, text) is
  'Quarter reopen approval requires an active immutable profile_id binding. Unbound Tina/Ryan slots remain safely blocked until owner/service configuration.';

revoke all on function public.decide_gl_quarter_reopen(uuid, text, text)
  from public, anon;
grant execute on function public.decide_gl_quarter_reopen(uuid, text, text)
  to authenticated, service_role;

drop policy if exists "quote_prospect_lifecycles_service_all"
  on public.quote_prospect_lifecycles;
create policy "quote_prospect_lifecycles_service_all"
  on public.quote_prospect_lifecycles for all to service_role
  using (true) with check (true);

drop policy if exists "quote_prospect_lifecycles_workspace_select"
  on public.quote_prospect_lifecycles;
create policy "quote_prospect_lifecycles_workspace_select"
  on public.quote_prospect_lifecycles for select to authenticated
  using (
    workspace_id = (select public.get_my_workspace())
    and (
      (select public.get_my_role()) in ('admin', 'manager', 'owner')
      or exists (
        select 1
        from public.quote_packages quote
        where quote.id = public.quote_prospect_lifecycles.quote_package_id
          and quote.workspace_id = public.quote_prospect_lifecycles.workspace_id
          and quote.created_by = (select auth.uid())
      )
    )
  );

drop policy if exists "sales_credit_approval_service_all"
  on public.sales_customer_credit_approval_requests;
create policy "sales_credit_approval_service_all"
  on public.sales_customer_credit_approval_requests for all to service_role
  using (true) with check (true);

drop policy if exists "sales_credit_approval_requester_select"
  on public.sales_customer_credit_approval_requests;
create policy "sales_credit_approval_requester_select"
  on public.sales_customer_credit_approval_requests for select to authenticated
  using (
    workspace_id = (select public.get_my_workspace())
    and (
      requested_by = (select auth.uid())
      or (select public.get_my_role()) in ('admin', 'manager', 'owner')
      or (select public.is_sales_credit_principal(workspace_id))
    )
  );

drop policy if exists "sales_credit_approval_elevated_update"
  on public.sales_customer_credit_approval_requests;

create or replace function public.sync_quote_prospect_lifecycle(
  p_quote_package_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quote_packages%rowtype;
  v_lifecycle public.quote_prospect_lifecycles%rowtype;
  v_prospect_id uuid;
  v_company_id uuid;
  v_contact_id uuid;
  v_credit_request_id uuid;
  v_company_name text;
  v_person_name text;
  v_person_email text;
  v_person_phone text;
  v_first_name text;
  v_last_name text;
  v_conversion_method text;
  v_duplicate_company_ids jsonb := '[]'::jsonb;
begin
  select *
    into v_quote
  from public.quote_packages
  where id = p_quote_package_id
  for update;

  if not found then
    raise exception 'quote package % not found', p_quote_package_id
      using errcode = 'P0002';
  end if;

  if not coalesce(v_quote.is_prospect_quote, false) then
    return jsonb_build_object('status', 'not_prospect');
  end if;

  if v_quote.status not in ('sent', 'viewed', 'accepted', 'converted_to_deal') then
    return jsonb_build_object('status', 'not_ready', 'quoteStatus', v_quote.status);
  end if;

  select *
    into v_lifecycle
  from public.quote_prospect_lifecycles
  where workspace_id = v_quote.workspace_id
    and quote_package_id = v_quote.id
  for update;

  if not found then
    insert into public.qrm_prospects (
      workspace_id,
      prospect_status,
      source,
      salesperson_id,
      selling,
      company_name_unconverted,
      comments
    ) values (
      v_quote.workspace_id,
      'early'::public.prospect_status,
      'quote_builder_send',
      v_quote.created_by,
      coalesce(v_quote.quote_number, v_quote.id::text),
      nullif(trim(coalesce(v_quote.customer_company, v_quote.customer_name)), ''),
      concat('Auto-created when quote ', coalesce(v_quote.quote_number, v_quote.id::text), ' was sent (SA6).')
    )
    returning id into v_prospect_id;

    insert into public.quote_prospect_lifecycles (
      workspace_id,
      quote_package_id,
      prospect_id,
      lifecycle_status,
      metadata
    ) values (
      v_quote.workspace_id,
      v_quote.id,
      v_prospect_id,
      'sent_prospect',
      jsonb_build_object(
        'source', 'owner_answer_SA6',
        'quote_number', v_quote.quote_number,
        'sent_at', v_quote.sent_at
      )
    )
    returning * into v_lifecycle;
  end if;

  if v_quote.status not in ('accepted', 'converted_to_deal') then
    return jsonb_build_object(
      'status', 'sent_prospect',
      'prospectId', v_lifecycle.prospect_id
    );
  end if;

  if v_lifecycle.customer_company_id is not null then
    return jsonb_build_object(
      'status', v_lifecycle.lifecycle_status,
      'prospectId', v_lifecycle.prospect_id,
      'companyId', v_lifecycle.customer_company_id,
      'contactId', v_lifecycle.customer_contact_id
    );
  end if;

  select
    nullif(trim(signature.signer_name), ''),
    nullif(lower(trim(signature.signer_email)), '')
  into v_person_name, v_person_email
  from public.quote_signatures signature
  where signature.quote_package_id = v_quote.id
    and signature.is_valid = true
  order by signature.signed_at desc
  limit 1;

  v_person_name := coalesce(v_person_name, nullif(trim(v_quote.customer_name), ''));
  v_person_email := coalesce(v_person_email, nullif(lower(trim(v_quote.customer_email)), ''));
  v_person_phone := nullif(trim(v_quote.customer_phone), '');
  v_company_name := nullif(trim(coalesce(v_quote.customer_company, v_quote.customer_name)), '');

  if v_company_name is null or lower(v_company_name) in ('walk-in prospect', 'prospect') then
    v_company_name := coalesce(
      v_person_name,
      concat('Accepted quote ', coalesce(v_quote.quote_number, v_quote.id::text))
    );
  end if;

  -- An existing customer may be reused only through the quote's explicit CRM
  -- deal relationship.  Names, email addresses, and phone numbers are useful
  -- dedupe hints, but are never identity keys and never authorize credit edits.
  select company.id, contact.id
    into v_company_id, v_contact_id
  from public.qrm_deals deal
  join public.qrm_companies company
    on company.id = deal.company_id
   and company.workspace_id = deal.workspace_id
   and company.deleted_at is null
  left join public.qrm_contacts contact
    on contact.id = deal.primary_contact_id
   and contact.workspace_id = deal.workspace_id
   and contact.primary_company_id = company.id
   and contact.deleted_at is null
  where deal.id = v_quote.deal_id
    and deal.workspace_id = v_quote.workspace_id
  limit 1;

  if v_company_id is not null then
    update public.qrm_prospects
    set prospect_status = 'sold'::public.prospect_status,
        company_id = v_company_id,
        comments = concat_ws(
          E'\n',
          comments,
          'Linked to the explicitly selected existing customer at quote acceptance; no new-customer credit request was opened.'
        ),
        modified_at = now()
    where id = v_lifecycle.prospect_id
      and workspace_id = v_quote.workspace_id;

    update public.quote_prospect_lifecycles
    set customer_company_id = v_company_id,
        customer_contact_id = v_contact_id,
        lifecycle_status = 'linked_existing_customer',
        customer_converted_at = coalesce(customer_converted_at, now()),
        conversion_method = 'linked_existing_customer',
        metadata = metadata || jsonb_build_object(
          'customer_status', 'existing_customer',
          'credit_approval_required', false,
          'identity_evidence', 'explicit_qrm_deal_company_id'
        )
    where id = v_lifecycle.id;

    return jsonb_build_object(
      'status', 'linked_existing_customer',
      'prospectId', v_lifecycle.prospect_id,
      'companyId', v_company_id,
      'contactId', v_contact_id,
      'creditApprovalRequestId', null,
      'conversionMethod', 'linked_existing_customer'
    );
  end if;

  select coalesce(jsonb_agg(company.id order by company.created_at), '[]'::jsonb)
    into v_duplicate_company_ids
  from public.qrm_companies company
  where company.workspace_id = v_quote.workspace_id
    and company.deleted_at is null
    and lower(trim(company.name)) = lower(v_company_name);

  insert into public.qrm_companies (
    workspace_id,
    name,
    assigned_rep_id,
    business_email,
    business_cell,
    phone,
    status,
    credit_limit_cents,
    credit_hold,
    credit_hold_reason,
    credit_hold_set_at,
    metadata
  ) values (
    v_quote.workspace_id,
    v_company_name,
    v_quote.created_by,
    v_person_email,
    v_person_phone,
    v_person_phone,
    'active',
    0,
    true,
    'CREDIT APPROVAL PENDING: SA6 quote acceptance',
    now(),
    jsonb_build_object(
      'source', 'quote_prospect_acceptance',
      'quote_package_id', v_quote.id,
      'credit_approval_status', 'pending',
      'cash_only', true,
      'dedupe_review_required', jsonb_array_length(v_duplicate_company_ids) > 0,
      'potential_duplicate_company_ids', v_duplicate_company_ids
    )
  )
  returning id into v_company_id;
  v_conversion_method := 'created_customer';

  -- A typed prospect gets a new contact owned by the new company.  Never
  -- attach a pre-existing contact from another company merely because an
  -- email address or phone number happens to match.
  if v_person_name is not null
     or v_person_email is not null
     or v_person_phone is not null then
    v_first_name := split_part(v_person_name, ' ', 1);
    v_last_name := trim(substr(v_person_name, length(v_first_name) + 1));

    insert into public.qrm_contacts (
      workspace_id,
      first_name,
      last_name,
      email,
      phone,
      cell,
      primary_company_id,
      assigned_rep_id,
      metadata
    ) values (
      v_quote.workspace_id,
      coalesce(nullif(v_first_name, ''), 'Customer'),
      coalesce(v_last_name, ''),
      v_person_email,
      v_person_phone,
      v_person_phone,
      v_company_id,
      v_quote.created_by,
      jsonb_build_object(
        'source', 'quote_prospect_acceptance',
        'quote_package_id', v_quote.id
      )
    )
    returning id into v_contact_id;
  end if;

  if v_contact_id is not null then
    update public.qrm_companies
    set primary_contact_id = coalesce(primary_contact_id, v_contact_id)
    where id = v_company_id
      and workspace_id = v_quote.workspace_id;

    update public.quote_packages
    set contact_id = coalesce(contact_id, v_contact_id)
    where id = v_quote.id
      and workspace_id = v_quote.workspace_id;
  end if;

  update public.qrm_deals
  set company_id = v_company_id,
      primary_contact_id = coalesce(v_contact_id, primary_contact_id),
      assigned_rep_id = coalesce(assigned_rep_id, v_quote.created_by),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'prospect_conversion_source', 'quote_acceptance',
        'quote_package_id', v_quote.id
      )
  where id = v_quote.deal_id
    and workspace_id = v_quote.workspace_id;

  update public.qrm_prospects
  set prospect_status = 'sold'::public.prospect_status,
      company_id = v_company_id,
      comments = concat_ws(E'\n', comments, 'Converted to cash-only customer at quote acceptance; Tina/Ryan credit approval opened.'),
      modified_at = now()
  where id = v_lifecycle.prospect_id
    and workspace_id = v_quote.workspace_id;

  insert into public.sales_customer_credit_approval_requests (
    workspace_id,
    quote_package_id,
    company_id,
    requested_by,
    assigned_principal,
    status,
    metadata
  ) values (
    v_quote.workspace_id,
    v_quote.id,
    v_company_id,
    v_quote.created_by,
    'tina_or_ryan',
    'pending',
    jsonb_build_object(
      'source', 'owner_answer_SA6',
      'customer_status_until_decision', 'cash_only',
      'quote_number', v_quote.quote_number
    )
  )
  on conflict (workspace_id, quote_package_id) do update
    set company_id = excluded.company_id
  returning id into v_credit_request_id;

  if v_credit_request_id is null then
    select id into v_credit_request_id
    from public.sales_customer_credit_approval_requests
    where workspace_id = v_quote.workspace_id
      and quote_package_id = v_quote.id;
  end if;

  insert into public.qrm_in_app_notifications (
    workspace_id,
    user_id,
    kind,
    title,
    body,
    deal_id,
    metadata
  )
  select
    v_quote.workspace_id,
    profile.id,
    'sales_credit_approval_pending',
    'New customer credit approval',
    concat(v_company_name, ' accepted quote ', coalesce(v_quote.quote_number, v_quote.id::text), '. Set terms and credit limit.'),
    v_quote.deal_id,
    jsonb_build_object(
      'credit_approval_request_id', v_credit_request_id,
      'quote_package_id', v_quote.id,
      'company_id', v_company_id
    )
  from public.finance_approval_principals principal
  join public.profiles profile
    on profile.id = principal.profile_id
   and profile.is_active = true
  join public.profile_workspaces membership
    on membership.profile_id = principal.profile_id
   and membership.workspace_id = principal.workspace_id
  where principal.workspace_id = v_quote.workspace_id
    and principal.approval_scope = 'sales_credit'
    and principal.is_active = true
    and principal.profile_id is not null
    and not exists (
      select 1
      from public.qrm_in_app_notifications existing
      where existing.workspace_id = v_quote.workspace_id
        and existing.user_id = profile.id
        and existing.kind = 'sales_credit_approval_pending'
        and existing.metadata ->> 'credit_approval_request_id' = v_credit_request_id::text
    );

  update public.quote_prospect_lifecycles
  set customer_company_id = v_company_id,
      customer_contact_id = v_contact_id,
      lifecycle_status = 'customer_cash_only',
      customer_converted_at = coalesce(customer_converted_at, now()),
      conversion_method = v_conversion_method,
      metadata = metadata || jsonb_build_object(
        'credit_approval_request_id', v_credit_request_id,
        'customer_status', 'cash_only',
        'dedupe_review_required', jsonb_array_length(v_duplicate_company_ids) > 0,
        'potential_duplicate_company_ids', v_duplicate_company_ids
      )
  where id = v_lifecycle.id;

  return jsonb_build_object(
    'status', 'customer_cash_only',
    'prospectId', v_lifecycle.prospect_id,
    'companyId', v_company_id,
    'contactId', v_contact_id,
    'creditApprovalRequestId', v_credit_request_id,
    'conversionMethod', v_conversion_method
  );
end;
$$;

comment on function public.sync_quote_prospect_lifecycle(uuid) is
  'SA6 internal lifecycle: creates qrm_prospects at send and converts accepted prospect quotes to cash-only customers with a Tina/Ryan credit approval handoff. Idempotent by quote.';

revoke all on function public.sync_quote_prospect_lifecycle(uuid) from public, anon, authenticated;
grant execute on function public.sync_quote_prospect_lifecycle(uuid) to service_role;

create or replace function public.decide_sales_customer_credit_approval(
  p_request_id uuid,
  p_decision text,
  p_terms_code text default null,
  p_credit_limit_cents bigint default null,
  p_note text default null
)
returns public.sales_customer_credit_approval_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.sales_customer_credit_approval_requests%rowtype;
  v_hold_reason constant text := 'CREDIT APPROVAL PENDING: SA6 quote acceptance';
begin
  select * into v_request
  from public.sales_customer_credit_approval_requests request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception 'sales credit approval request % not found', p_request_id
      using errcode = 'P0002';
  end if;

  if v_request.workspace_id is distinct from public.get_my_workspace() then
    raise exception 'sales credit approval request is outside the active workspace'
      using errcode = '42501';
  end if;

  if not public.is_sales_credit_principal(v_request.workspace_id) then
    raise exception 'only Tina or Ryan may decide sales customer credit requests'
      using errcode = '42501';
  end if;

  if p_decision is null or p_decision not in ('approved', 'denied') then
    raise exception 'decision must be approved or denied'
      using errcode = '22023';
  end if;

  if v_request.status not in ('pending', 'needs_information') then
    raise exception 'credit request % is already %', p_request_id, v_request.status
      using errcode = '55000';
  end if;

  if p_decision = 'approved' then
    if nullif(trim(p_terms_code), '') is null then
      raise exception 'approved terms code is required'
        using errcode = '23514';
    end if;
    if p_credit_limit_cents is null or p_credit_limit_cents < 0 then
      raise exception 'approved credit limit must be zero or greater'
        using errcode = '23514';
    end if;
  end if;

  update public.sales_customer_credit_approval_requests request
  set status = p_decision,
      approved_terms_code = case when p_decision = 'approved' then trim(p_terms_code) else null end,
      approved_credit_limit_cents = case when p_decision = 'approved' then p_credit_limit_cents else null end,
      decision_by = auth.uid(),
      decision_note = nullif(trim(p_note), ''),
      decided_at = now(),
      metadata = request.metadata || jsonb_build_object(
        'decision_source', 'tina_or_ryan_rpc',
        'decided_at', now()
      )
  where request.id = p_request_id
  returning * into v_request;

  if p_decision = 'approved' then
    update public.qrm_companies company
    set payment_terms_code = trim(p_terms_code),
        terms_code = trim(p_terms_code),
        credit_limit_cents = p_credit_limit_cents,
        credit_limit_set_by = auth.uid(),
        credit_limit_set_at = now(),
        credit_hold = case
          when company.credit_hold_reason = v_hold_reason then false
          else company.credit_hold
        end,
        credit_hold_reason = case
          when company.credit_hold_reason = v_hold_reason then null
          else company.credit_hold_reason
        end,
        credit_hold_set_at = case
          when company.credit_hold_reason = v_hold_reason then null
          else company.credit_hold_set_at
        end,
        metadata = coalesce(company.metadata, '{}'::jsonb) || jsonb_build_object(
          'credit_approval_status', 'approved',
          'credit_approval_request_id', v_request.id
        )
    where company.id = v_request.company_id
      and company.workspace_id = v_request.workspace_id;
  else
    update public.qrm_companies company
    set metadata = coalesce(company.metadata, '{}'::jsonb) || jsonb_build_object(
          'credit_approval_status', 'denied',
          'credit_approval_request_id', v_request.id
        )
    where company.id = v_request.company_id
      and company.workspace_id = v_request.workspace_id;
  end if;

  update public.quote_prospect_lifecycles lifecycle
  set lifecycle_status = case
        when p_decision = 'approved' then 'credit_approved'
        else 'credit_denied'
      end,
      metadata = lifecycle.metadata || jsonb_build_object(
        'credit_decision', p_decision,
        'credit_decided_at', now()
      )
  where lifecycle.workspace_id = v_request.workspace_id
    and lifecycle.quote_package_id = v_request.quote_package_id;

  if v_request.requested_by is not null and v_request.requested_by <> auth.uid() then
    insert into public.qrm_in_app_notifications (
      workspace_id,
      user_id,
      kind,
      title,
      body,
      metadata
    ) values (
      v_request.workspace_id,
      v_request.requested_by,
      concat('sales_credit_', p_decision),
      concat('Customer credit ', p_decision),
      case
        when p_decision = 'approved'
          then concat('Terms ', trim(p_terms_code), ' and credit limit were approved.')
        else 'Credit was denied; the customer remains on the SA6 approval hold.'
      end,
      jsonb_build_object(
        'credit_approval_request_id', v_request.id,
        'quote_package_id', v_request.quote_package_id,
        'company_id', v_request.company_id
      )
    );
  end if;

  return v_request;
end;
$$;

comment on function public.decide_sales_customer_credit_approval(uuid, text, text, bigint, text) is
  'SA6 guarded decision path. Tina/Ryan set terms plus credit limit; only the SA6 pending hold is cleared on approval, preserving unrelated manual or AR holds.';

revoke all on function public.decide_sales_customer_credit_approval(uuid, text, text, bigint, text)
  from public, anon;
grant execute on function public.decide_sales_customer_credit_approval(uuid, text, text, bigint, text)
  to authenticated;

drop trigger if exists trg_quote_package_prospect_lifecycle
  on public.quote_packages;
drop function if exists public.trg_sync_quote_prospect_lifecycle();

-- Prospect lifecycle work is driven only by evidence-bearing server
-- boundaries below.  This guard prevents a quote owner from manufacturing the
-- downstream CRM/credit side effects with a naked status update.
create or replace function public.guard_quote_prospect_status_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_prospect_quote is not true
     or old.status is not distinct from new.status then
    return new;
  end if;

  if new.status in ('sent', 'viewed', 'accepted', 'converted_to_deal')
     and not exists (
       select 1
       from public.quote_delivery_events delivery
       where delivery.workspace_id = new.workspace_id
         and delivery.quote_package_id = new.id
         and delivery.status = 'sent'
         and delivery.channel <> 'preview'
     ) then
    raise exception 'PROSPECT_SEND_EVIDENCE_REQUIRED: quote % has no durable sent delivery event', new.id
      using errcode = '55000';
  end if;

  if new.status in ('accepted', 'converted_to_deal')
     and not exists (
       select 1
       from public.quote_signatures signature
       where signature.workspace_id = new.workspace_id
         and signature.quote_package_id = new.id
         and signature.is_valid = true
     ) then
    raise exception 'PROSPECT_ACCEPTANCE_SIGNATURE_REQUIRED: quote % has no valid signature', new.id
      using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_quote_prospect_status_evidence()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_quote_prospect_status_evidence_trg
  on public.quote_packages;
create trigger guard_quote_prospect_status_evidence_trg
  before update of status on public.quote_packages
  for each row execute function public.guard_quote_prospect_status_evidence();

-- Signatures are immutable server evidence.  Authenticated users may read
-- signatures for accessible packages, but all writes go through the atomic
-- service-role acceptance RPC.
drop policy if exists "signatures_workspace" on public.quote_signatures;
drop policy if exists "signatures_workspace_select" on public.quote_signatures;
create policy "signatures_workspace_select" on public.quote_signatures
  for select to authenticated
  using (public.signature_in_my_workspace(quote_package_id));

create or replace function public.accept_quote_package_with_signature(
  p_workspace_id text,
  p_quote_package_id uuid,
  p_signer_name text,
  p_signer_email text,
  p_signer_ip text,
  p_signer_user_agent text,
  p_signature_image_url text,
  p_signed_snapshot jsonb,
  p_signed_via text,
  p_document_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quote_packages%rowtype;
  v_signature public.quote_signatures%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'accept_quote_package_with_signature requires service_role'
      using errcode = '42501';
  end if;
  if nullif(trim(p_signer_name), '') is null then
    raise exception 'signer name is required' using errcode = '23514';
  end if;
  if nullif(trim(p_document_hash), '') is null then
    raise exception 'document hash is required' using errcode = '23514';
  end if;
  if p_signed_via not in ('deal_room', 'portal', 'rep') then
    raise exception 'signed_via must be deal_room, portal, or rep'
      using errcode = '23514';
  end if;

  select * into v_quote
  from public.quote_packages quote
  where quote.id = p_quote_package_id
    and quote.workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'quote package % not found in workspace %',
      p_quote_package_id, p_workspace_id using errcode = 'P0002';
  end if;

  if v_quote.status in ('accepted', 'converted_to_deal') then
    select * into v_signature
    from public.quote_signatures signature
    where signature.workspace_id = p_workspace_id
      and signature.quote_package_id = p_quote_package_id
      and signature.is_valid = true
    order by signature.signed_at desc, signature.id desc
    limit 1;

    if not found then
      raise exception 'accepted quote % has no valid signature evidence', p_quote_package_id
        using errcode = '55000';
    end if;

    if v_quote.is_prospect_quote is true
       and not exists (
         select 1
         from public.quote_delivery_events delivery
         where delivery.workspace_id = p_workspace_id
           and delivery.quote_package_id = p_quote_package_id
           and delivery.status = 'sent'
           and delivery.channel <> 'preview'
       ) then
      raise exception 'PROSPECT_SEND_EVIDENCE_REQUIRED: acceptance requires a durable sent delivery event'
        using errcode = '55000';
    end if;

    if v_quote.is_prospect_quote is true then
      perform public.sync_quote_prospect_lifecycle(v_quote.id);
    end if;

    return jsonb_build_object(
      'signature_id', v_signature.id,
      'signed_at', v_signature.signed_at,
      'status', v_quote.status,
      'accepted_at', v_quote.accepted_at,
      'document_hash', v_signature.document_hash,
      'created', false
    );
  end if;

  if v_quote.status not in (
    'sent', 'viewed', 'countered', 'approved', 'approved_with_conditions'
  ) then
    raise exception 'quote % status % is not ready for acceptance',
      p_quote_package_id, v_quote.status using errcode = '55000';
  end if;

  if v_quote.is_prospect_quote is true
     and not exists (
       select 1
       from public.quote_delivery_events delivery
       where delivery.workspace_id = p_workspace_id
         and delivery.quote_package_id = p_quote_package_id
         and delivery.status = 'sent'
         and delivery.channel <> 'preview'
     ) then
    raise exception 'PROSPECT_SEND_EVIDENCE_REQUIRED: acceptance requires a durable sent delivery event'
      using errcode = '55000';
  end if;

  insert into public.quote_signatures (
    workspace_id,
    quote_package_id,
    deal_id,
    signer_name,
    signer_email,
    signer_ip,
    signer_user_agent,
    signature_image_url,
    signed_snapshot,
    signed_via,
    document_hash,
    is_valid
  ) values (
    p_workspace_id,
    p_quote_package_id,
    v_quote.deal_id,
    trim(p_signer_name),
    nullif(lower(trim(p_signer_email)), ''),
    nullif(trim(p_signer_ip), ''),
    nullif(trim(p_signer_user_agent), ''),
    p_signature_image_url,
    coalesce(p_signed_snapshot, '{}'::jsonb),
    p_signed_via,
    lower(trim(p_document_hash)),
    true
  )
  returning * into v_signature;

  update public.quote_packages
  set status = 'accepted',
      accepted_at = v_signature.signed_at,
      updated_at = now()
  where id = p_quote_package_id
    and workspace_id = p_workspace_id;

  if v_quote.is_prospect_quote is true then
    perform public.sync_quote_prospect_lifecycle(v_quote.id);
  end if;

  return jsonb_build_object(
    'signature_id', v_signature.id,
    'signed_at', v_signature.signed_at,
    'status', 'accepted',
    'accepted_at', v_signature.signed_at,
    'document_hash', v_signature.document_hash,
    'created', true
  );
end;
$$;

comment on function public.accept_quote_package_with_signature(
  text, uuid, text, text, text, text, text, jsonb, text, text
) is
  'Service-only atomic acceptance: lock quote, persist valid signature evidence, update accepted status, then run SA6 lifecycle in one transaction.';

revoke all on function public.accept_quote_package_with_signature(
  text, uuid, text, text, text, text, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.accept_quote_package_with_signature(
  text, uuid, text, text, text, text, text, jsonb, text, text
) to service_role;

create or replace function public.mark_quote_package_sent_with_evidence(
  p_workspace_id text,
  p_quote_package_id uuid,
  p_channel text,
  p_recipient text,
  p_created_by uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quote_packages%rowtype;
  v_delivery_id uuid;
  v_sent_at timestamptz := now();
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'mark_quote_package_sent_with_evidence requires service_role'
      using errcode = '42501';
  end if;
  if p_channel not in ('email', 'text', 'link', 'print') then
    raise exception 'manual send channel must be email, text, link, or print'
      using errcode = '23514';
  end if;

  select * into v_quote
  from public.quote_packages quote
  where quote.id = p_quote_package_id
    and quote.workspace_id = p_workspace_id
  for update;
  if not found then
    raise exception 'quote package % not found in workspace %',
      p_quote_package_id, p_workspace_id using errcode = 'P0002';
  end if;
  if not exists (
    select 1
    from public.profiles profile
    join public.profile_workspaces membership
      on membership.profile_id = profile.id
     and membership.workspace_id = p_workspace_id
    where profile.id = p_created_by
      and profile.is_active = true
  ) then
    raise exception 'manual send attestor must be an active workspace member'
      using errcode = '42501';
  end if;
  if v_quote.status in ('accepted', 'converted_to_deal', 'rejected', 'expired', 'archived') then
    raise exception 'quote % status % cannot be marked sent',
      p_quote_package_id, v_quote.status using errcode = '55000';
  end if;
  if v_quote.status in ('sent', 'viewed') then
    select delivery.id into v_delivery_id
    from public.quote_delivery_events delivery
    where delivery.workspace_id = p_workspace_id
      and delivery.quote_package_id = p_quote_package_id
      and delivery.status = 'sent'
      and delivery.channel <> 'preview'
    order by delivery.created_at desc
    limit 1;
    if v_delivery_id is not null then
      return v_delivery_id;
    end if;
  end if;

  insert into public.quote_delivery_events (
    workspace_id,
    quote_package_id,
    channel,
    status,
    recipient,
    provider,
    created_by,
    metadata
  ) values (
    p_workspace_id,
    p_quote_package_id,
    p_channel,
    'sent',
    nullif(trim(p_recipient), ''),
    'manual_attestation',
    p_created_by,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'manual_attestation', true,
      'attested_at', v_sent_at
    )
  )
  returning id into v_delivery_id;

  update public.quote_packages
  set status = 'sent',
      sent_at = v_sent_at,
      sent_via = p_channel,
      updated_at = now()
  where id = p_quote_package_id
    and workspace_id = p_workspace_id;

  if v_quote.is_prospect_quote is true then
    perform public.sync_quote_prospect_lifecycle(v_quote.id);
  end if;

  return v_delivery_id;
end;
$$;

revoke all on function public.mark_quote_package_sent_with_evidence(
  text, uuid, text, text, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.mark_quote_package_sent_with_evidence(
  text, uuid, text, text, uuid, jsonb
) to service_role;

-- Replace the migration-818 send wrapper so SA6 runs only after the immutable
-- delivery event and OEM authorization state are committed in this transaction.
create or replace function public.quote_send_package_commit(
  p_workspace_id text,
  p_quote_package_id uuid,
  p_sent_at timestamptz,
  p_document_artifact_id uuid,
  p_recipient text,
  p_subject text,
  p_message_body text,
  p_provider text,
  p_follow_up_at timestamptz,
  p_created_by uuid,
  p_metadata jsonb,
  p_send_authorization_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery_id uuid;
  v_is_prospect boolean;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'quote_send_package_commit requires service_role'
      using errcode = '42501';
  end if;

  select quote.is_prospect_quote into v_is_prospect
  from public.quote_packages quote
  where quote.id = p_quote_package_id
    and quote.workspace_id = p_workspace_id
    and quote.requires_requote is not true
  for update;
  if not found then
    raise exception 'QUOTE_REQUIRES_REQUOTE: customer send authorization is no longer valid'
      using errcode = '55000';
  end if;

  perform 1
  from public.quote_send_authorizations send_auth
  where send_auth.id = p_send_authorization_id
    and send_auth.workspace_id = p_workspace_id
    and send_auth.quote_package_id = p_quote_package_id
    and send_auth.document_artifact_id = p_document_artifact_id
    and send_auth.status = 'authorized'
    and send_auth.expires_at > now()
  for update;
  if not found then
    raise exception 'quote send authorization is missing, stale, or expired'
      using errcode = '55000';
  end if;

  v_delivery_id := public.quote_send_package_commit_v599(
    p_workspace_id,
    p_quote_package_id,
    p_sent_at,
    p_document_artifact_id,
    p_recipient,
    p_subject,
    p_message_body,
    p_provider,
    p_follow_up_at,
    p_created_by,
    p_metadata
  );

  update public.quote_send_authorizations
  set status = 'sent', completed_at = now(), error_detail = null
  where id = p_send_authorization_id
    and status = 'authorized';
  if not found then
    raise exception 'quote send authorization changed during delivery commit'
      using errcode = '40001';
  end if;

  if v_is_prospect is true then
    perform public.sync_quote_prospect_lifecycle(p_quote_package_id);
  end if;

  return v_delivery_id;
end;
$$;

revoke all on function public.quote_send_package_commit(
  text, uuid, timestamptz, uuid, text, text, text, text, timestamptz, uuid, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.quote_send_package_commit(
  text, uuid, timestamptz, uuid, text, text, text, text, timestamptz, uuid, jsonb, uuid
) to service_role;

-- --------------------------------------------------------------------------
-- SA7: per-OEM/effective-date program provenance
-- --------------------------------------------------------------------------

alter table public.qb_programs
  add column if not exists source_price_sheet_id uuid
    references public.qb_price_sheets(id) on delete set null,
  add column if not exists source_program_row_id uuid
    references public.qb_price_sheet_programs(id) on delete set null,
  add column if not exists stack_policy_provenance text not null default 'legacy_unverified',
  add column if not exists stack_policy_verified_by uuid
    references auth.users(id) on delete set null,
  add column if not exists stack_policy_verified_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'qb_programs_stack_policy_provenance_chk'
      and conrelid = 'public.qb_programs'::regclass
  ) then
    alter table public.qb_programs
      add constraint qb_programs_stack_policy_provenance_chk
      check (stack_policy_provenance in (
        'legacy_unverified',
        'manufacturer_worksheet',
        'manufacturer_portal',
        'manager_override'
      ));
  end if;
end $$;

create index if not exists idx_qb_programs_source_price_sheet
  on public.qb_programs (workspace_id, source_price_sheet_id)
  where source_price_sheet_id is not null;

create index if not exists idx_qb_programs_source_program_row
  on public.qb_programs (source_program_row_id)
  where source_program_row_id is not null;

create or replace function public.validate_qb_price_sheet_program_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sheet public.qb_price_sheets%rowtype;
begin
  select * into v_sheet
  from public.qb_price_sheets sheet
  where sheet.id = new.price_sheet_id;

  if not found then
    raise exception 'price sheet % not found', new.price_sheet_id
      using errcode = '23503';
  end if;
  if new.workspace_id <> v_sheet.workspace_id then
    raise exception 'price-sheet program workspace must match source sheet workspace'
      using errcode = '23514';
  end if;
  if v_sheet.brand_id is null then
    raise exception 'program source sheet must identify an OEM brand'
      using errcode = '23514';
  end if;

  if new.proposed_program_id is not null
     and not exists (
       select 1
       from public.qb_programs program
       where program.id = new.proposed_program_id
         and program.workspace_id = new.workspace_id
         and program.brand_id = v_sheet.brand_id
     ) then
    raise exception 'proposed program must belong to the source sheet workspace and OEM'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_qb_price_sheet_program_scope()
  from public, anon, authenticated, service_role;

drop trigger if exists validate_qb_price_sheet_program_scope_trg
  on public.qb_price_sheet_programs;
create trigger validate_qb_price_sheet_program_scope_trg
  before insert or update of workspace_id, price_sheet_id, proposed_program_id
  on public.qb_price_sheet_programs
  for each row execute function public.validate_qb_price_sheet_program_scope();

create table if not exists public.qb_program_pair_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  brand_id uuid not null references public.qb_brands(id) on delete restrict,
  program_a_id uuid not null references public.qb_programs(id) on delete restrict,
  program_b_id uuid not null references public.qb_programs(id) on delete restrict,
  can_combine boolean not null,
  effective_from date not null,
  effective_to date not null,
  source_price_sheet_id uuid not null
    references public.qb_price_sheets(id) on delete restrict,
  source_program_row_a_id uuid not null
    references public.qb_price_sheet_programs(id) on delete restrict,
  source_program_row_b_id uuid not null
    references public.qb_price_sheet_programs(id) on delete restrict,
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  reviewed_at timestamptz not null,
  status text not null default 'published'
    check (status in ('published', 'superseded')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (program_a_id <> program_b_id),
  check (program_a_id::text < program_b_id::text),
  check (effective_to >= effective_from),
  unique (
    workspace_id,
    brand_id,
    program_a_id,
    program_b_id,
    effective_from,
    effective_to
  )
);

comment on table public.qb_program_pair_policies is
  'SA7 fail-closed OEM stacking policy. Every exact program pair and effective window must trace to reviewed rows in one published manufacturer worksheet; absent rows mean policy_pending.';

drop index if exists public.idx_qb_program_pair_policies_resolve;
create index idx_qb_program_pair_policies_resolve
  on public.qb_program_pair_policies (
    workspace_id,
    brand_id,
    status,
    program_a_id,
    program_b_id,
    effective_from,
    effective_to
  ) include (
    can_combine,
    source_price_sheet_id,
    reviewed_at,
    notes
  );

create index if not exists idx_qb_program_pair_policies_source
  on public.qb_program_pair_policies (workspace_id, source_price_sheet_id);

drop trigger if exists set_qb_program_pair_policies_updated_at
  on public.qb_program_pair_policies;
create trigger set_qb_program_pair_policies_updated_at
  before update on public.qb_program_pair_policies
  for each row execute function public.set_updated_at();

alter table public.qb_program_pair_policies enable row level security;

drop policy if exists "qb_program_pair_policies_service_all"
  on public.qb_program_pair_policies;
create policy "qb_program_pair_policies_service_all"
  on public.qb_program_pair_policies for all to service_role
  using (true) with check (true);

drop policy if exists "qb_program_pair_policies_workspace_select"
  on public.qb_program_pair_policies;
create policy "qb_program_pair_policies_workspace_select"
  on public.qb_program_pair_policies for select to authenticated
  using (
    workspace_id = (select public.get_my_workspace())
    and (select auth.uid()) is not null
  );

drop policy if exists "qb_program_stacking_rules_write"
  on public.qb_program_stacking_rules;
comment on table public.qb_program_stacking_rules is
  'Deprecated legacy global type-pair fixtures. They are not authoritative for SA7 and must not be used for customer-send decisions; use qb_program_pair_policies.';

create or replace function public.validate_qb_program_pair_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sheet public.qb_price_sheets%rowtype;
  v_program_a public.qb_programs%rowtype;
  v_program_b public.qb_programs%rowtype;
begin
  select * into v_sheet
  from public.qb_price_sheets sheet
  where sheet.id = new.source_price_sheet_id;
  select * into v_program_a
  from public.qb_programs program
  where program.id = new.program_a_id;
  select * into v_program_b
  from public.qb_programs program
  where program.id = new.program_b_id;

  if v_sheet.id is null
     or v_sheet.workspace_id <> new.workspace_id
     or v_sheet.brand_id is distinct from new.brand_id
     or v_sheet.status <> 'published'
     or v_sheet.reviewed_by is null
     or v_sheet.reviewed_at is null then
    raise exception 'stacking policy requires a reviewed, published same-workspace OEM worksheet'
      using errcode = '23514';
  end if;
  if v_program_a.id is null or v_program_b.id is null
     or v_program_a.workspace_id <> new.workspace_id
     or v_program_b.workspace_id <> new.workspace_id
     or v_program_a.brand_id <> new.brand_id
     or v_program_b.brand_id <> new.brand_id then
    raise exception 'stacking programs must belong to the policy workspace and OEM'
      using errcode = '23514';
  end if;
  if new.effective_from < greatest(v_program_a.effective_from, v_program_b.effective_from)
     or new.effective_to > least(v_program_a.effective_to, v_program_b.effective_to)
     or (v_sheet.effective_from is not null and new.effective_from < v_sheet.effective_from)
     or (v_sheet.effective_to is not null and new.effective_to > v_sheet.effective_to) then
    raise exception 'stacking effective window must be inside both programs and source worksheet'
      using errcode = '23514';
  end if;

  if not exists (
       select 1
       from public.qb_price_sheet_programs source_row
       where source_row.id = new.source_program_row_a_id
         and source_row.workspace_id = new.workspace_id
         and source_row.price_sheet_id = new.source_price_sheet_id
         and source_row.program_code = v_program_a.program_code
         and source_row.review_status = 'approved'
         and source_row.action <> 'skip'
         and source_row.applied_at is not null
     )
     or not exists (
       select 1
       from public.qb_price_sheet_programs source_row
       where source_row.id = new.source_program_row_b_id
         and source_row.workspace_id = new.workspace_id
         and source_row.price_sheet_id = new.source_price_sheet_id
         and source_row.program_code = v_program_b.program_code
         and source_row.review_status = 'approved'
         and source_row.action <> 'skip'
         and source_row.applied_at is not null
     ) then
    raise exception 'stacking policy source rows must be approved/applied rows for both programs on the source worksheet'
      using errcode = '23514';
  end if;

  if new.status = 'published'
     and exists (
       select 1
       from public.qb_program_pair_policies existing
       where existing.workspace_id = new.workspace_id
         and existing.brand_id = new.brand_id
         and existing.program_a_id = new.program_a_id
         and existing.program_b_id = new.program_b_id
         and existing.status = 'published'
         and existing.id <> new.id
         and daterange(existing.effective_from, existing.effective_to, '[]')
           && daterange(new.effective_from, new.effective_to, '[]')
     ) then
    raise exception 'published stacking policy effective windows may not overlap'
      using errcode = '23P01';
  end if;

  new.reviewed_by := v_sheet.reviewed_by;
  new.reviewed_at := v_sheet.reviewed_at;
  return new;
end;
$$;

revoke all on function public.validate_qb_program_pair_policy()
  from public, anon, authenticated, service_role;

drop trigger if exists validate_qb_program_pair_policy_trg
  on public.qb_program_pair_policies;
create trigger validate_qb_program_pair_policy_trg
  before insert or update on public.qb_program_pair_policies
  for each row execute function public.validate_qb_program_pair_policy();

create or replace function public.guard_qb_quote_program_policy_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy_date date;
  v_selected_count integer;
  v_verified_count integer;
  v_brand_count integer;
  v_program_a uuid;
  v_program_b uuid;
begin
  if new.status not in ('sent', 'accepted', 'converted_to_deal')
     or coalesce(cardinality(new.applied_program_ids), 0) = 0 then
    return new;
  end if;

  v_policy_date := coalesce(new.sent_at::date, new.created_at::date, current_date);

  select count(*) into v_selected_count
  from (
    select distinct selected.id
    from unnest(new.applied_program_ids) selected(id)
    where selected.id is not null
  ) selected;

  select count(*), count(distinct program.brand_id)
    into v_verified_count, v_brand_count
  from public.qb_programs program
  join public.qb_price_sheets source_sheet
    on source_sheet.id = program.source_price_sheet_id
   and source_sheet.workspace_id = program.workspace_id
   and source_sheet.brand_id = program.brand_id
   and source_sheet.status = 'published'
   and source_sheet.reviewed_by is not null
   and source_sheet.reviewed_at is not null
  where program.id = any(new.applied_program_ids)
    and program.workspace_id = new.workspace_id
    and program.active = true
    and program.deleted_at is null
    and program.effective_from <= v_policy_date
    and program.effective_to >= v_policy_date
    and program.stack_policy_provenance = 'manufacturer_worksheet'
    and program.stack_policy_verified_at is not null;

  if v_selected_count = 0
     or v_verified_count <> v_selected_count
     or v_brand_count <> 1 then
    raise exception 'PROGRAM_POLICY_PENDING: selected programs lack one reviewed, published same-workspace OEM worksheet for %',
      v_policy_date using errcode = '55000';
  end if;

  select first_program.id, second_program.id
    into v_program_a, v_program_b
  from public.qb_programs first_program
  join public.qb_programs second_program
    on first_program.id::text < second_program.id::text
  where first_program.id = any(new.applied_program_ids)
    and second_program.id = any(new.applied_program_ids)
    and not exists (
      select 1
      from public.qb_program_pair_policies policy
      join public.qb_price_sheets source_sheet
        on source_sheet.id = policy.source_price_sheet_id
       and source_sheet.workspace_id = policy.workspace_id
       and source_sheet.brand_id = policy.brand_id
       and source_sheet.status = 'published'
       and source_sheet.reviewed_by is not null
       and source_sheet.reviewed_at is not null
      where policy.workspace_id = new.workspace_id
        and policy.brand_id = first_program.brand_id
        and policy.program_a_id = first_program.id
        and policy.program_b_id = second_program.id
        and policy.status = 'published'
        and policy.effective_from <= v_policy_date
        and policy.effective_to >= v_policy_date
    )
  limit 1;

  if v_program_a is not null then
    raise exception 'PROGRAM_POLICY_PENDING: no reviewed stacking rule for program pair % + % on %',
      v_program_a, v_program_b, v_policy_date using errcode = '55000';
  end if;

  select first_program.id, second_program.id
    into v_program_a, v_program_b
  from public.qb_programs first_program
  join public.qb_programs second_program
    on first_program.id::text < second_program.id::text
  join public.qb_program_pair_policies policy
    on policy.workspace_id = new.workspace_id
   and policy.brand_id = first_program.brand_id
   and policy.program_a_id = first_program.id
   and policy.program_b_id = second_program.id
   and policy.status = 'published'
   and policy.effective_from <= v_policy_date
   and policy.effective_to >= v_policy_date
  where first_program.id = any(new.applied_program_ids)
    and second_program.id = any(new.applied_program_ids)
    and policy.can_combine = false
  limit 1;

  if v_program_a is not null then
    raise exception 'PROGRAM_STACKING_NOT_ALLOWED: reviewed OEM policy blocks program pair % + % on %',
      v_program_a, v_program_b, v_policy_date using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_qb_quote_program_policy_ready()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_qb_quote_program_policy_ready_trg
  on public.qb_quotes;
create trigger guard_qb_quote_program_policy_ready_trg
  before insert or update of status, applied_program_ids, sent_at
  on public.qb_quotes
  for each row execute function public.guard_qb_quote_program_policy_ready();

comment on function public.guard_qb_quote_program_policy_ready() is
  'SA7 customer-send gate for qb_quotes: every applied program and exact pair must be active, effective, same-workspace/OEM, and backed by a currently published reviewed manufacturer worksheet.';

create or replace function public.stamp_qb_program_policy_provenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sheet public.qb_price_sheets%rowtype;
  v_program_id uuid;
begin
  if new.applied_at is null
    or new.review_status <> 'approved'
    or new.action = 'skip' then
    return new;
  end if;

  select * into v_sheet
  from public.qb_price_sheets
  where id = new.price_sheet_id
    and workspace_id = new.workspace_id;

  if not found then
    raise exception 'program source worksheet must belong to the extracted row workspace'
      using errcode = '23514';
  end if;
  if v_sheet.brand_id is null
     or v_sheet.status <> 'published'
     or v_sheet.reviewed_by is null
     or v_sheet.reviewed_at is null then
    -- The extraction row may be approved before the worksheet publication
    -- transaction completes.  Keep it explicitly unverified until the sheet is
    -- reviewed/published; never synthesize provenance from a pending sheet.
    return new;
  end if;

  v_program_id := new.proposed_program_id;
  if v_program_id is null then
    select program.id into v_program_id
    from public.qb_programs program
    where program.workspace_id = v_sheet.workspace_id
      and program.brand_id = v_sheet.brand_id
      and program.program_code = new.program_code
      and program.deleted_at is null
    order by program.updated_at desc
    limit 1;
  elsif not exists (
    select 1
    from public.qb_programs program
    where program.id = v_program_id
      and program.workspace_id = v_sheet.workspace_id
      and program.brand_id = v_sheet.brand_id
      and program.deleted_at is null
  ) then
    raise exception 'proposed program must belong to the source worksheet workspace and OEM'
      using errcode = '23514';
  end if;

  if v_program_id is not null then
    update public.qb_programs
    set source_price_sheet_id = v_sheet.id,
        source_program_row_id = new.id,
        source_document_url = coalesce(v_sheet.file_url, source_document_url),
        stack_policy_provenance = 'manufacturer_worksheet',
        stack_policy_verified_by = v_sheet.reviewed_by,
        stack_policy_verified_at = v_sheet.reviewed_at
    where id = v_program_id
      and workspace_id = v_sheet.workspace_id
      and brand_id = v_sheet.brand_id;
  end if;

  return new;
end;
$$;

revoke all on function public.stamp_qb_program_policy_provenance()
  from public, anon, authenticated;

drop trigger if exists trg_stamp_qb_program_policy_provenance
  on public.qb_price_sheet_programs;
create trigger trg_stamp_qb_program_policy_provenance
  after insert or update of applied_at, review_status
  on public.qb_price_sheet_programs
  for each row execute function public.stamp_qb_program_policy_provenance();

create or replace function public.refresh_qb_program_provenance_on_sheet_publish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Transition tables collapse a bulk publish into one provenance update.
  -- This deliberately updates qb_programs directly: the previous no-op update
  -- of every extracted row re-fired one row trigger per program and amplified
  -- both writes and locks as worksheets grew.
  with published_sheets as (
    select
      new_sheet.id,
      new_sheet.workspace_id,
      new_sheet.brand_id,
      new_sheet.file_url,
      new_sheet.reviewed_by,
      new_sheet.reviewed_at
    from new_price_sheets new_sheet
    join old_price_sheets old_sheet on old_sheet.id = new_sheet.id
    where new_sheet.status = 'published'
      and new_sheet.brand_id is not null
      and new_sheet.reviewed_by is not null
      and new_sheet.reviewed_at is not null
      and (
        old_sheet.status is distinct from new_sheet.status
        or old_sheet.reviewed_by is distinct from new_sheet.reviewed_by
        or old_sheet.reviewed_at is distinct from new_sheet.reviewed_at
      )
  ),
  candidate_sources as (
    select
      program.id as program_id,
      sheet.id as price_sheet_id,
      source_row.id as program_row_id,
      sheet.file_url,
      sheet.reviewed_by,
      sheet.reviewed_at as verified_at,
      row_number() over (
        partition by program.id
        order by
          sheet.reviewed_at desc,
          source_row.applied_at desc,
          source_row.id desc
      ) as source_rank
    from published_sheets sheet
    join public.qb_price_sheet_programs source_row
      on source_row.workspace_id = sheet.workspace_id
     and source_row.price_sheet_id = sheet.id
     and source_row.applied_at is not null
     and source_row.review_status = 'approved'
     and source_row.action <> 'skip'
    join lateral (
      select candidate.id
      from public.qb_programs candidate
      where candidate.workspace_id = sheet.workspace_id
        and candidate.brand_id = sheet.brand_id
        and candidate.deleted_at is null
        and (
          (
            source_row.proposed_program_id is not null
            and candidate.id = source_row.proposed_program_id
          )
          or (
            source_row.proposed_program_id is null
            and candidate.program_code = source_row.program_code
          )
        )
      order by candidate.updated_at desc, candidate.id desc
      limit 1
    ) program on true
  ),
  latest_source as (
    select *
    from candidate_sources
    where source_rank = 1
  )
  update public.qb_programs program
  set source_price_sheet_id = source.price_sheet_id,
      source_program_row_id = source.program_row_id,
      source_document_url = coalesce(source.file_url, program.source_document_url),
      stack_policy_provenance = 'manufacturer_worksheet',
      stack_policy_verified_by = source.reviewed_by,
      stack_policy_verified_at = source.verified_at
  from latest_source source
  where program.id = source.program_id
    and row(
      program.source_price_sheet_id,
      program.source_program_row_id,
      program.source_document_url,
      program.stack_policy_provenance,
      program.stack_policy_verified_by,
      program.stack_policy_verified_at
    ) is distinct from row(
      source.price_sheet_id,
      source.program_row_id,
      coalesce(source.file_url, program.source_document_url),
      'manufacturer_worksheet'::text,
      source.reviewed_by,
      source.verified_at
    );

  return null;
end;
$$;

revoke all on function public.refresh_qb_program_provenance_on_sheet_publish()
  from public, anon, authenticated, service_role;

drop trigger if exists refresh_qb_program_provenance_on_sheet_publish_trg
  on public.qb_price_sheets;
create trigger refresh_qb_program_provenance_on_sheet_publish_trg
  after update
  on public.qb_price_sheets
  referencing old table as old_price_sheets new table as new_price_sheets
  for each statement execute function public.refresh_qb_program_provenance_on_sheet_publish();

with latest_source as (
  select distinct on (sheet.workspace_id, sheet.brand_id, row.program_code)
    sheet.workspace_id,
    sheet.brand_id,
    row.program_code,
    sheet.id as price_sheet_id,
    row.id as program_row_id,
    sheet.file_url,
    sheet.reviewed_by,
    coalesce(sheet.reviewed_at, row.applied_at) as verified_at
  from public.qb_price_sheet_programs row
  join public.qb_price_sheets sheet
    on sheet.id = row.price_sheet_id
   and sheet.workspace_id = row.workspace_id
  where row.applied_at is not null
    and row.review_status = 'approved'
    and row.action <> 'skip'
    and sheet.status = 'published'
    and sheet.brand_id is not null
    and sheet.reviewed_by is not null
    and sheet.reviewed_at is not null
  order by
    sheet.workspace_id,
    sheet.brand_id,
    row.program_code,
    row.applied_at desc,
    row.id desc
)
update public.qb_programs program
set source_price_sheet_id = source.price_sheet_id,
    source_program_row_id = source.program_row_id,
    source_document_url = coalesce(source.file_url, program.source_document_url),
    stack_policy_provenance = 'manufacturer_worksheet',
    stack_policy_verified_by = source.reviewed_by,
    stack_policy_verified_at = source.verified_at
from latest_source source
where program.workspace_id = source.workspace_id
  and program.brand_id = source.brand_id
  and program.program_code = source.program_code;

create or replace view public.v_qb_program_policy_provenance
with (security_invoker = true)
as
select
  program.id,
  program.workspace_id,
  program.brand_id,
  brand.code as brand_code,
  brand.name as brand_name,
  program.program_code,
  program.program_type,
  program.name,
  program.stack_kind,
  program.effective_from,
  program.effective_to,
  program.active,
  program.stack_policy_provenance,
  program.source_price_sheet_id,
  program.source_program_row_id,
  program.source_document_url,
  program.stack_policy_verified_by,
  program.stack_policy_verified_at,
  source_sheet.filename as source_price_sheet_filename,
  source_sheet.status as source_price_sheet_status,
  source_sheet.effective_from as source_sheet_effective_from,
  source_sheet.effective_to as source_sheet_effective_to,
  (program.stack_policy_provenance <> 'legacy_unverified') as policy_source_verified
from public.qb_programs program
join public.qb_brands brand on brand.id = program.brand_id
left join public.qb_price_sheets source_sheet on source_sheet.id = program.source_price_sheet_id
where program.deleted_at is null;

comment on view public.v_qb_program_policy_provenance is
  'SA7 evidence view: per-OEM program stack_kind/effective dates plus the reviewed manufacturer source. legacy_unverified rows remain visible and must not be represented as worksheet-confirmed.';

-- --------------------------------------------------------------------------
-- SA8: deduped dual-channel availability alert queue + one-channel mute
-- --------------------------------------------------------------------------

create table if not exists public.sales_availability_alert_preferences (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  muted_channel text check (muted_channel is null or muted_channel in ('sms', 'eight_by_eight')),
  muted_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index if not exists idx_sales_alert_preferences_user
  on public.sales_availability_alert_preferences (user_id, workspace_id);

drop trigger if exists set_sales_availability_alert_preferences_updated_at
  on public.sales_availability_alert_preferences;
create trigger set_sales_availability_alert_preferences_updated_at
  before update on public.sales_availability_alert_preferences
  for each row execute function public.set_updated_at();

create table if not exists public.sales_availability_alert_queries (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  availability_request_id uuid not null
    references public.quote_availability_requests(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  business_dedupe_key text not null,
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, availability_request_id),
  unique (workspace_id, business_dedupe_key)
);

create index if not exists idx_sales_alert_queries_requested_by
  on public.sales_availability_alert_queries
    (workspace_id, requested_by, created_at desc);

drop trigger if exists set_sales_availability_alert_queries_updated_at
  on public.sales_availability_alert_queries;
create trigger set_sales_availability_alert_queries_updated_at
  before update on public.sales_availability_alert_queries
  for each row execute function public.set_updated_at();

create table if not exists public.sales_availability_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  alert_query_id uuid not null
    references public.sales_availability_alert_queries(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('sms', 'eight_by_eight')),
  provider text not null check (provider in ('twilio', 'eight_by_eight')),
  status text not null default 'queued'
    check (status in (
      'queued', 'muted', 'sending', 'sent', 'delivered', 'failed',
      'dead_letter', 'cancelled'
    )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  provider_message_id text,
  last_error_code text,
  last_error_detail text,
  next_attempt_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, alert_query_id, recipient_user_id, channel)
);

create index if not exists idx_sales_alert_deliveries_dispatch
  on public.sales_availability_alert_deliveries
    (provider, status, next_attempt_at, created_at)
  where status in ('queued', 'failed');

create index if not exists idx_sales_alert_deliveries_recipient
  on public.sales_availability_alert_deliveries
    (workspace_id, recipient_user_id, created_at desc);

drop trigger if exists set_sales_availability_alert_deliveries_updated_at
  on public.sales_availability_alert_deliveries;
create trigger set_sales_availability_alert_deliveries_updated_at
  before update on public.sales_availability_alert_deliveries
  for each row execute function public.set_updated_at();

alter table public.sales_availability_alert_preferences enable row level security;
alter table public.sales_availability_alert_queries enable row level security;
alter table public.sales_availability_alert_deliveries enable row level security;

drop policy if exists "sales_alert_preferences_service_all"
  on public.sales_availability_alert_preferences;
create policy "sales_alert_preferences_service_all"
  on public.sales_availability_alert_preferences for all to service_role
  using (true) with check (true);

drop policy if exists "sales_alert_preferences_own_all"
  on public.sales_availability_alert_preferences;
drop policy if exists "sales_alert_preferences_own_select"
  on public.sales_availability_alert_preferences;
create policy "sales_alert_preferences_own_select"
  on public.sales_availability_alert_preferences for select to authenticated
  using (
    workspace_id = (select public.get_my_workspace())
    and user_id = (select auth.uid())
  );

drop policy if exists "sales_alert_queries_service_all"
  on public.sales_availability_alert_queries;
create policy "sales_alert_queries_service_all"
  on public.sales_availability_alert_queries for all to service_role
  using (true) with check (true);

drop policy if exists "sales_alert_queries_workspace_select"
  on public.sales_availability_alert_queries;
create policy "sales_alert_queries_workspace_select"
  on public.sales_availability_alert_queries for select to authenticated
  using (
    workspace_id = (select public.get_my_workspace())
    and (
      requested_by = (select auth.uid())
      or (select public.get_my_role()) in ('admin', 'manager', 'owner')
    )
  );

drop policy if exists "sales_alert_deliveries_service_all"
  on public.sales_availability_alert_deliveries;
create policy "sales_alert_deliveries_service_all"
  on public.sales_availability_alert_deliveries for all to service_role
  using (true) with check (true);

drop policy if exists "sales_alert_deliveries_recipient_select"
  on public.sales_availability_alert_deliveries;
create policy "sales_alert_deliveries_recipient_select"
  on public.sales_availability_alert_deliveries for select to authenticated
  using (
    workspace_id = (select public.get_my_workspace())
    and (
      recipient_user_id = (select auth.uid())
      or (select public.get_my_role()) in ('admin', 'manager', 'owner')
    )
  );

create or replace function public.validate_quote_availability_request_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.profiles profile
    join public.profile_workspaces membership
      on membership.profile_id = profile.id
     and membership.workspace_id = new.workspace_id
    where profile.id = new.requested_by
      and profile.is_active = true
  ) then
    raise exception 'availability requested_by must be an active member of workspace %',
      new.workspace_id using errcode = '23514';
  end if;

  if new.assigned_to is not null
     and not exists (
       select 1
       from public.profiles profile
       join public.profile_workspaces membership
         on membership.profile_id = profile.id
        and membership.workspace_id = new.workspace_id
       where profile.id = new.assigned_to
         and profile.is_active = true
     ) then
    raise exception 'availability assigned_to must be an active member of workspace %',
      new.workspace_id using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_quote_availability_request_members()
  from public, anon, authenticated, service_role;

drop trigger if exists validate_quote_availability_request_members_trg
  on public.quote_availability_requests;
create trigger validate_quote_availability_request_members_trg
  before insert or update of workspace_id, requested_by, assigned_to
  on public.quote_availability_requests
  for each row execute function public.validate_quote_availability_request_members();

create or replace function public.enqueue_sales_availability_alert(
  p_availability_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.quote_availability_requests%rowtype;
  v_query_id uuid;
  v_title text;
  v_body text;
begin
  select * into v_request
  from public.quote_availability_requests
  where id = p_availability_request_id;

  if not found then
    raise exception 'availability request % not found', p_availability_request_id
      using errcode = 'P0002';
  end if;

  v_title := concat('Availability needed: ', v_request.requested_machine_label);
  v_body := concat_ws(
    ' · ',
    v_request.requested_machine_label,
    nullif(v_request.customer_need, ''),
    concat('Urgency: ', v_request.urgency)
  );

  insert into public.sales_availability_alert_queries (
    workspace_id,
    availability_request_id,
    requested_by,
    business_dedupe_key,
    title,
    body,
    payload
  ) values (
    v_request.workspace_id,
    v_request.id,
    v_request.requested_by,
    concat('quote_availability:', v_request.workspace_id, ':', v_request.id),
    v_title,
    v_body,
    jsonb_build_object(
      'availability_request_id', v_request.id,
      'quote_package_id', v_request.quote_package_id,
      'requested_machine_label', v_request.requested_machine_label,
      'urgency', v_request.urgency,
      'sla_due_at', v_request.sla_due_at
    )
  )
  on conflict (workspace_id, availability_request_id) do update
    set title = excluded.title,
        body = excluded.body,
        payload = excluded.payload
  returning id into v_query_id;

  -- Reassignment supersedes only work that has not reached a terminal/provider
  -- state.  Previously queued deliveries for an old assignee must not fire
  -- after ownership moves.
  update public.sales_availability_alert_deliveries delivery
  set status = 'cancelled',
      next_attempt_at = null,
      metadata = delivery.metadata || jsonb_build_object(
        'cancelled_reason', 'recipient_no_longer_current',
        'cancelled_at', now()
      )
  where delivery.workspace_id = v_request.workspace_id
    and delivery.alert_query_id = v_query_id
    and delivery.status in ('queued', 'muted', 'failed')
    and not exists (
      select 1
      from public.profiles current_profile
      join public.profile_workspaces current_membership
        on current_membership.profile_id = current_profile.id
       and current_membership.workspace_id = v_request.workspace_id
      where current_profile.is_active = true
        and current_profile.id = delivery.recipient_user_id
        and (
          current_profile.id = v_request.assigned_to
          or current_profile.role in ('admin', 'manager', 'owner')
        )
    );

  with recipients as (
    select profile.id as user_id
    from public.profiles profile
    join public.profile_workspaces membership
      on membership.profile_id = profile.id
     and membership.workspace_id = v_request.workspace_id
    where profile.is_active = true
      and (
        profile.id = v_request.assigned_to
        or profile.role in ('admin', 'manager', 'owner')
      )
  ), channels(channel, provider) as (
    values
      ('sms'::text, 'twilio'::text),
      ('eight_by_eight'::text, 'eight_by_eight'::text)
  )
  insert into public.sales_availability_alert_deliveries (
    workspace_id,
    alert_query_id,
    recipient_user_id,
    channel,
    provider,
    status,
    next_attempt_at,
    metadata
  )
  select
    v_request.workspace_id,
    v_query_id,
    recipient.user_id,
    channel.channel,
    channel.provider,
    case
      when preference.muted_channel = channel.channel
        and (preference.muted_until is null or preference.muted_until > now())
        then 'muted'
      else 'queued'
    end,
    case
      when preference.muted_channel = channel.channel
        and (preference.muted_until is null or preference.muted_until > now())
        then null
      else now()
    end,
    jsonb_build_object(
      'business_dedupe_key', concat('quote_availability:', v_request.workspace_id, ':', v_request.id),
      'mute_evaluated_at', now()
    )
  from recipients recipient
  cross join channels channel
  left join public.sales_availability_alert_preferences preference
    on preference.workspace_id = v_request.workspace_id
   and preference.user_id = recipient.user_id
  on conflict (workspace_id, alert_query_id, recipient_user_id, channel)
  do update set
    status = case
      when public.sales_availability_alert_deliveries.status in (
        'queued', 'muted', 'failed', 'cancelled'
      ) then excluded.status
      else public.sales_availability_alert_deliveries.status
    end,
    next_attempt_at = case
      when public.sales_availability_alert_deliveries.status in (
        'queued', 'muted', 'failed', 'cancelled'
      ) then excluded.next_attempt_at
      else public.sales_availability_alert_deliveries.next_attempt_at
    end,
    metadata = public.sales_availability_alert_deliveries.metadata
      || excluded.metadata
      || jsonb_build_object('recipient_reconciled_at', now());

  insert into public.qrm_in_app_notifications (
    workspace_id,
    user_id,
    kind,
    title,
    body,
    metadata
  )
  select distinct
    v_request.workspace_id,
    delivery.recipient_user_id,
    'quote_availability_requested',
    v_title,
    v_body,
    jsonb_build_object(
      'alert_query_id', v_query_id,
      'availability_request_id', v_request.id,
      'business_dedupe_key', concat('quote_availability:', v_request.workspace_id, ':', v_request.id)
    )
  from public.sales_availability_alert_deliveries delivery
  where delivery.alert_query_id = v_query_id
    and delivery.workspace_id = v_request.workspace_id
    and delivery.status <> 'cancelled'
    and not exists (
      select 1
      from public.qrm_in_app_notifications existing
      where existing.workspace_id = v_request.workspace_id
        and existing.user_id = delivery.recipient_user_id
        and existing.kind = 'quote_availability_requested'
        and existing.metadata ->> 'alert_query_id' = v_query_id::text
    );

  return v_query_id;
end;
$$;

comment on function public.enqueue_sales_availability_alert(uuid) is
  'SA8 internal queue fan-out. One availability business query creates deduped SMS and 8x8 delivery intents per recipient; queued is not delivery proof.';

revoke all on function public.enqueue_sales_availability_alert(uuid)
  from public, anon, authenticated;
grant execute on function public.enqueue_sales_availability_alert(uuid)
  to service_role;

create or replace function public.trg_enqueue_sales_availability_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enqueue_sales_availability_alert(new.id);
  return new;
end;
$$;

revoke all on function public.trg_enqueue_sales_availability_alert()
  from public, anon, authenticated;

drop trigger if exists trg_quote_availability_dual_channel_alert
  on public.quote_availability_requests;
create trigger trg_quote_availability_dual_channel_alert
  after insert or update of assigned_to on public.quote_availability_requests
  for each row execute function public.trg_enqueue_sales_availability_alert();

create or replace function public.set_sales_availability_alert_mute(
  p_channel text,
  p_muted_until timestamptz default null
)
returns public.sales_availability_alert_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id text := public.get_my_workspace();
  v_row public.sales_availability_alert_preferences%rowtype;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if v_workspace_id is null
     or not exists (
       select 1
       from public.profiles profile
       join public.profile_workspaces membership
         on membership.profile_id = profile.id
        and membership.workspace_id = v_workspace_id
       where profile.id = v_user_id
         and profile.is_active = true
     ) then
    raise exception 'active workspace membership required'
      using errcode = '42501';
  end if;

  if p_channel is not null and p_channel not in ('sms', 'eight_by_eight') then
    raise exception 'channel must be sms, eight_by_eight, or null'
      using errcode = '22023';
  end if;

  insert into public.sales_availability_alert_preferences (
    workspace_id,
    user_id,
    muted_channel,
    muted_until
  ) values (
    v_workspace_id,
    v_user_id,
    p_channel,
    case when p_channel is null then null else p_muted_until end
  )
  on conflict (workspace_id, user_id) do update
    set muted_channel = excluded.muted_channel,
        muted_until = excluded.muted_until
  returning * into v_row;

  update public.sales_availability_alert_deliveries delivery
  set status = case
        when p_channel = delivery.channel
          and (p_muted_until is null or p_muted_until > now()) then 'muted'
        else 'queued'
      end,
      next_attempt_at = case
        when p_channel = delivery.channel
          and (p_muted_until is null or p_muted_until > now()) then null
        else now()
      end,
      metadata = delivery.metadata || jsonb_build_object(
        'mute_evaluated_at', now(),
        'mute_changed_by', v_user_id
      )
  where delivery.workspace_id = v_workspace_id
    and delivery.recipient_user_id = v_user_id
    and delivery.status in ('queued', 'muted');

  return v_row;
end;
$$;

comment on function public.set_sales_availability_alert_mute(text, timestamptz) is
  'SA8 user preference: mute at most one of SMS or 8x8, optionally until a timestamp; NULL channel restores both.';

revoke all on function public.set_sales_availability_alert_mute(text, timestamptz)
  from public, anon, service_role;
grant execute on function public.set_sales_availability_alert_mute(text, timestamptz)
  to authenticated;

commit;

-- Rollback / fix-forward notes:
--   Revoke execute on prospect send/accept, stacking-policy, availability,
--   mute, and principal-binding RPCs before disabling this release. Preserve
--   prospect lifecycles, signature evidence, credit requests, delivery rows,
--   worksheet policies, and principal-binding events. Correct them only with
--   append-only evidence in a later migration; never re-enable name-based or
--   owner-editable authorization.
