-- Fix: add missing rep UPDATE policy on crm_deal_equipment
create policy "crm_deal_equipment_rep_update"
  on public.crm_deal_equipment for update
  using (
    public.get_my_role() = 'rep'
    and public.crm_rep_can_access_deal(deal_id)
  )
  with check (
    public.get_my_role() = 'rep'
    and public.crm_rep_can_access_deal(deal_id)
  );
