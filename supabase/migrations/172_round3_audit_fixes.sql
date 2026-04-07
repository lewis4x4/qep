-- ============================================================================
-- Migration 172: Round 3 audit fixes
--
-- Three security defects + one data-integrity guard found in the post-Phase-2
-- audit. All fixes are additive / corrective; no destructive changes.
--
-- (a) P0 — portal_payment_intents leaked across customers within a workspace.
--     Tighten the RLS select policy so portal customers only see their own
--     company's intents (read via portal_customers.crm_company_id =
--     get_portal_customer_id()-derived). Internal staff continue to see all
--     intents in their workspace.
--
-- (b) P0 — apply_ar_override() was SECURITY DEFINER with no caller role
--     check, allowing any authed user to clear an AR block. Add explicit
--     manager-or-higher gate at the top of the function and verify the
--     named approver is also manager-or-higher.
--
-- (c) P1 — manufacturer_incentives RLS write policy allowed any workspace
--     member, contradicting the migration comment. Replace with a
--     manager-or-higher gate.
--
-- (d) P1 — quote_incentive_applications had no uniqueness guarantee, so
--     concurrent resolver runs could insert duplicate active rows for the
--     same (quote, incentive) pair. Add a unique partial index on
--     (quote_package_id, incentive_id) WHERE removed_at IS NULL.
-- ============================================================================

-- ── (a) portal_payment_intents company-level isolation ───────────────────

drop policy if exists "ppi_workspace_select" on public.portal_payment_intents;

-- Internal staff: see all intents in their workspace
create policy "ppi_workspace_select_staff" on public.portal_payment_intents for select
  using (
    workspace_id = public.get_my_workspace()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('rep', 'admin', 'manager', 'owner')
    )
  );

-- Portal customers: see only their own company's intents
create policy "ppi_workspace_select_portal" on public.portal_payment_intents for select
  using (
    company_id = (
      select pc.crm_company_id
      from public.portal_customers pc
      where pc.id = public.get_portal_customer_id()
      limit 1
    )
  );

-- ── (b) apply_ar_override caller role gate ───────────────────────────────

create or replace function public.apply_ar_override(
  p_block_id uuid,
  p_reason text,
  p_approver_id uuid,
  p_window_days int default 14
)
returns public.ar_credit_blocks
language plpgsql
security definer
as $$
declare
  v_row public.ar_credit_blocks;
  v_caller_role text;
  v_approver_role text;
begin
  -- Caller MUST be manager or higher (Phase 2C contract)
  select role into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role is null then
    raise exception 'caller profile not found';
  end if;
  if v_caller_role not in ('manager', 'owner', 'admin') then
    raise exception 'AR override requires manager or owner role';
  end if;

  -- Named approver MUST also be manager or higher (audit trail integrity)
  select role into v_approver_role from public.profiles where id = p_approver_id;
  if v_approver_role is null then
    raise exception 'approver profile not found';
  end if;
  if v_approver_role not in ('manager', 'owner', 'admin') then
    raise exception 'named approver must be manager or owner';
  end if;

  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'override reason required (min 5 chars)';
  end if;
  if p_approver_id is null then
    raise exception 'approver_id required';
  end if;

  update public.ar_credit_blocks
  set status = 'overridden',
      override_reason = p_reason,
      override_approver_id = p_approver_id,
      override_until = now() + make_interval(days => p_window_days),
      override_created_at = now(),
      override_accounting_notified_at = now()
  where id = p_block_id and status = 'active'
  returning * into v_row;

  if not found then
    raise exception 'block not found or not in active state';
  end if;

  return v_row;
end;
$$;

comment on function public.apply_ar_override(uuid, text, uuid, int) is
  'Manager AR override with role-gated caller check + role-verified named approver. Phase 2C v2 contract.';

-- ── (c) manufacturer_incentives manager-only writes ──────────────────────

drop policy if exists "mi_workspace_write" on public.manufacturer_incentives;

create policy "mi_workspace_write" on public.manufacturer_incentives for all
  using (
    workspace_id = public.get_my_workspace()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('manager', 'owner', 'admin')
    )
  )
  with check (
    workspace_id = public.get_my_workspace()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('manager', 'owner', 'admin')
    )
  );

-- ── (d) quote_incentive_applications dedupe guard ────────────────────────

create unique index if not exists uq_qia_active_quote_incentive
  on public.quote_incentive_applications (quote_package_id, incentive_id)
  where removed_at is null;

comment on index public.uq_qia_active_quote_incentive is
  'Prevents concurrent resolver runs from creating duplicate active applications for the same (quote, incentive) pair.';
