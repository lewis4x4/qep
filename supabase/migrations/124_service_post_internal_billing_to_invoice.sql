-- ============================================================================
-- Migration 124: Post service_internal_billing_line_staging → customer invoice
-- P1-A: draft consumed parts lines → customer_invoices + customer_invoice_line_items
-- Edge: service-billing-post calls service_post_internal_billing_to_invoice.
-- ============================================================================

-- At most one open (pending) shop invoice per service job — prevents duplicate
-- invoice rows when two sessions post staging concurrently.
create unique index if not exists idx_customer_invoices_one_pending_per_service_job
  on public.customer_invoices (service_job_id)
  where service_job_id is not null and status = 'pending';

create or replace function public.service_post_internal_billing_to_invoice(
  p_service_job_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_workspace text;
  v_inv_id uuid;
  v_max_ln int;
  v_line_n int;
  v_staging record;
  v_subtotal numeric(12, 2);
  v_lines int := 0;
  v_inv_num text;
  v_draft_count int;
begin
  if auth.uid() is null or auth.uid() is distinct from p_actor_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into strict v_job
  from public.service_jobs
  where id = p_service_job_id
  for update;

  v_workspace := v_job.workspace_id;

  if v_workspace is distinct from public.get_my_workspace() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if public.get_my_role() not in ('rep', 'admin', 'manager', 'owner') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select count(*)::int into v_draft_count
  from public.service_internal_billing_line_staging s
  where s.service_job_id = p_service_job_id
    and s.workspace_id = v_workspace
    and s.status = 'draft';

  if v_draft_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_draft_lines');
  end if;

  select id into v_inv_id
  from public.customer_invoices
  where workspace_id = v_workspace
    and service_job_id = p_service_job_id
    and status = 'pending'
  limit 1
  for update;

  if v_inv_id is null then
    v_inv_num := 'SVC-' || substr(replace(p_service_job_id::text, '-', ''), 1, 12) || '-' ||
      to_char((now() at time zone 'utc'), 'YYYYMMDD') || '-' ||
      lower(substr(md5(random()::text), 1, 6));

    insert into public.customer_invoices (
      workspace_id,
      portal_customer_id,
      invoice_number,
      invoice_date,
      due_date,
      description,
      amount,
      tax,
      total,
      status,
      service_job_id,
      crm_company_id
    ) values (
      v_workspace,
      null,
      v_inv_num,
      current_date,
      (current_date + interval '30 days')::date,
      'Service parts — shop job',
      0,
      0,
      0,
      'pending',
      p_service_job_id,
      v_job.customer_id
    ) returning id into v_inv_id;
  end if;

  select coalesce(max(line_number), 0) into v_max_ln
  from public.customer_invoice_line_items
  where invoice_id = v_inv_id;

  v_line_n := v_max_ln;

  for v_staging in
    select *
    from public.service_internal_billing_line_staging s
    where s.service_job_id = p_service_job_id
      and s.workspace_id = v_workspace
      and s.status = 'draft'
    order by s.created_at
    for update
  loop
    v_line_n := v_line_n + 1;
    insert into public.customer_invoice_line_items (
      workspace_id,
      invoice_id,
      line_number,
      description,
      quantity,
      unit_price
    ) values (
      v_workspace,
      v_inv_id,
      v_line_n,
      coalesce(nullif(trim(both from v_staging.description), ''), v_staging.part_number, 'Parts'),
      v_staging.quantity,
      v_staging.unit_cost
    );

    update public.service_internal_billing_line_staging
    set
      status = 'posted',
      customer_invoice_id = v_inv_id,
      updated_at = now()
    where id = v_staging.id;

    v_lines := v_lines + 1;
  end loop;

  select coalesce(sum(line_total), 0) into v_subtotal
  from public.customer_invoice_line_items
  where invoice_id = v_inv_id;

  update public.customer_invoices
  set
    amount = v_subtotal,
    tax = 0,
    total = v_subtotal,
    updated_at = now()
  where id = v_inv_id;

  insert into public.service_job_events (
    workspace_id,
    job_id,
    event_type,
    actor_id,
    metadata
  ) values (
    v_workspace,
    p_service_job_id,
    'billing_posted',
    p_actor_id,
    jsonb_build_object(
      'action', 'post_internal_billing_staging',
      'customer_invoice_id', v_inv_id,
      'lines_posted', v_lines
    )
  );

  return jsonb_build_object(
    'ok', true,
    'customer_invoice_id', v_inv_id,
    'lines_posted', v_lines,
    'invoice_total', v_subtotal
  );
end;
$$;

comment on function public.service_post_internal_billing_to_invoice(uuid, uuid) is
  'Moves draft service_internal_billing_line_staging rows onto a pending customer_invoices for the job.';

grant execute on function public.service_post_internal_billing_to_invoice(uuid, uuid) to authenticated;
grant execute on function public.service_post_internal_billing_to_invoice(uuid, uuid) to service_role;
