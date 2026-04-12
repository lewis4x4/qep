-- Restrict equipment financial reads for reps while preserving elevated access
-- through the application API layer.

revoke select (
  purchase_price,
  current_market_value,
  replacement_cost,
  daily_rental_rate,
  weekly_rental_rate,
  monthly_rental_rate
) on table public.crm_equipment from authenticated;

grant select (
  purchase_price,
  current_market_value,
  replacement_cost,
  daily_rental_rate,
  weekly_rental_rate,
  monthly_rental_rate
) on table public.crm_equipment to service_role;

drop policy if exists "crm_equipment_rep_scope" on public.crm_equipment;

create policy "crm_equipment_rep_select"
  on public.crm_equipment for select
  using (
    public.get_my_role() = 'rep'
    and public.crm_rep_can_access_company(company_id)
  );

create policy "crm_equipment_rep_insert"
  on public.crm_equipment for insert
  with check (
    public.get_my_role() = 'rep'
    and public.crm_rep_can_access_company(company_id)
  );

create policy "crm_equipment_rep_update"
  on public.crm_equipment for update
  using (
    public.get_my_role() = 'rep'
    and public.crm_rep_can_access_company(company_id)
  )
  with check (
    public.get_my_role() = 'rep'
    and public.crm_rep_can_access_company(company_id)
  );

create policy "crm_equipment_rep_delete"
  on public.crm_equipment for delete
  using (
    public.get_my_role() = 'rep'
    and public.crm_rep_can_access_company(company_id)
  );

create or replace function public.crm_guard_rep_equipment_financial_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.get_my_role() = 'rep' then
    if tg_op = 'INSERT' and (
      new.purchase_price is not null
      or new.current_market_value is not null
      or new.replacement_cost is not null
      or new.daily_rental_rate is not null
      or new.weekly_rental_rate is not null
      or new.monthly_rental_rate is not null
    ) then
      raise exception 'rep role cannot write equipment financial fields';
    end if;

    if tg_op = 'UPDATE' and (
      new.purchase_price is distinct from old.purchase_price
      or new.current_market_value is distinct from old.current_market_value
      or new.replacement_cost is distinct from old.replacement_cost
      or new.daily_rental_rate is distinct from old.daily_rental_rate
      or new.weekly_rental_rate is distinct from old.weekly_rental_rate
      or new.monthly_rental_rate is distinct from old.monthly_rental_rate
    ) then
      raise exception 'rep role cannot modify equipment financial fields';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.crm_guard_rep_equipment_financial_write() from public;

drop trigger if exists guard_rep_equipment_financial_write on public.crm_equipment;
create trigger guard_rep_equipment_financial_write
  before insert or update on public.crm_equipment
  for each row execute function public.crm_guard_rep_equipment_financial_write();
