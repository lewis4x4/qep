-- 799: Trade recon approval — admins and owners are valid sales-manager approvers.
--
-- m766's qep_is_trade_recondition_manager_approver accepted only
-- profiles.role = 'manager' or iron_role = 'iron_manager'. Every elevated
-- production user is role 'admin', and the My Approvals card (N1.1, its first
-- caller) passes the logged-in user as p_approved_by, so
-- record_trade_recondition_manager_approval raised
-- VALIDATION_SALES_MANAGER_APPROVER_REQUIRED for every admin approver in every
-- caller context. Diagnosed 2026-07-08: the caller-side gate at the top of the
-- RPC already accepts admin/manager/owner/finance_admin; the approver-side
-- predicate was the odd one out. finance_admin stays excluded — it may record
-- the approval (requested_by) but reconditioning approval authority is a
-- sales-side call.

create or replace function public.qep_is_trade_recondition_manager_approver(
  p_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_profile_id
      and (
        (select auth.role()) = 'service_role'
        or p.active_workspace_id = (select public.get_my_workspace())
        or exists (
          select 1
          from public.profile_workspaces pw
          where pw.profile_id = p.id
            and pw.workspace_id = (select public.get_my_workspace())
        )
      )
      and (
        p.role::text in ('manager', 'admin', 'owner')
        or p.iron_role = 'iron_manager'
      )
  );
$$;

comment on function public.qep_is_trade_recondition_manager_approver(uuid) is
  'Returns true for sales-approval authorities on keep-and-recondition trades: manager, admin, and owner roles, plus owner profiles mapped to iron_manager. Part 10 routes low-margin keep-and-recondition trades to this path.';

revoke execute on function public.qep_is_trade_recondition_manager_approver(uuid) from public;
grant execute on function public.qep_is_trade_recondition_manager_approver(uuid) to authenticated;
grant execute on function public.qep_is_trade_recondition_manager_approver(uuid) to service_role;
