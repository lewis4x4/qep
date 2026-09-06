-- Preserve the same actor/workspace boundary while evaluating session helpers once.
-- Forward repair for databases that applied the initial 842 policy definition.
-- The original 842 migration-history statement remains unchanged.
begin;
alter policy sales_offline_receipts_own on public.sales_offline_action_receipts
  using (user_id = (select auth.uid()) and workspace_id = (select public.get_my_workspace()));
commit;
