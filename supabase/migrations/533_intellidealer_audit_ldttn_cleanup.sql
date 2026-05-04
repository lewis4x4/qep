-- 533_intellidealer_audit_ldttn_cleanup.sql
--
-- Worker C cleanup for:
-- - docs/intellidealer-gap-audit/cross-cutting.yaml#audit.created_by
-- - docs/intellidealer-gap-audit/phase-3-parts.yaml#parts_invoice.adjust_ldttn
--
-- Additive only. Does not create public.parts_invoices; parts invoice headers
-- remain canonicalized on public.customer_invoices.

create or replace view public.v_audit_record_changes
with (security_invoker = true) as
select
  rch.id,
  rch.workspace_id,
  rch.table_name,
  rch.record_id,
  rch.actor_user_id as created_by,
  rch.actor_user_id,
  rch.action,
  rch.changed_fields,
  rch.before_snapshot,
  rch.after_snapshot,
  rch.occurred_at,
  rch.created_at,
  rch.updated_at,
  rch.deleted_at
from public.record_change_history rch;

comment on view public.v_audit_record_changes is
  'Compatibility audit view exposing record_change_history.actor_user_id as created_by for IntelliDealer-style audit consumers.';

create or replace view public.v_record_created_by
with (security_invoker = true) as
select distinct on (rch.workspace_id, rch.table_name, rch.record_id)
  rch.workspace_id,
  rch.table_name,
  rch.record_id,
  rch.actor_user_id as created_by,
  rch.occurred_at as created_at,
  rch.id as audit_event_id
from public.record_change_history rch
where rch.action = 'insert'
  and rch.deleted_at is null
order by rch.workspace_id, rch.table_name, rch.record_id, rch.occurred_at asc, rch.id asc;

comment on view public.v_record_created_by is
  'Created-by rollup from the first insert audit event per workspace/table/record. Complements mixed created_by/actor_user_id source schemas without rewriting every table.';

do $$
begin
  if to_regclass('public.record_change_history') is not null
     and to_regprocedure('public.record_change_history_capture()') is not null then
    if to_regclass('public.customer_invoices') is not null then
      execute 'drop trigger if exists trg_rch_customer_invoices on public.customer_invoices';
      execute 'create trigger trg_rch_customer_invoices after insert or update or delete on public.customer_invoices for each row execute function public.record_change_history_capture()';
    end if;

    if to_regclass('public.parts_invoice_lines') is not null then
      execute 'drop trigger if exists trg_rch_parts_invoice_lines on public.parts_invoice_lines';
      execute 'create trigger trg_rch_parts_invoice_lines after insert or update or delete on public.parts_invoice_lines for each row execute function public.record_change_history_capture()';
    end if;
  end if;
end $$;

alter table public.parts_invoice_lines
  add column if not exists ldttn_selected boolean not null default false,
  add column if not exists tax_code_1 text,
  add column if not exists tax_code_2 text,
  add column if not exists tax_code_3 text,
  add column if not exists tax_code_4 text,
  add column if not exists price_level_code text,
  add column if not exists non_stock_code text,
  add column if not exists ldttn_adjusted_by uuid references public.profiles(id) on delete set null,
  add column if not exists ldttn_adjusted_at timestamptz;

comment on column public.parts_invoice_lines.ldttn_selected is
  'IntelliDealer LDTTN checkbox equivalent. Selected lines are eligible for Adjust LDTTN bulk tax/discount/level/non-stock updates.';
comment on column public.parts_invoice_lines.tax_code_1 is
  'Line-level tax code slot applied by Adjust LDTTN when a selected part needs an override from the invoice header.';
comment on column public.parts_invoice_lines.tax_code_2 is
  'Line-level tax code slot applied by Adjust LDTTN when a selected part needs an override from the invoice header.';
comment on column public.parts_invoice_lines.tax_code_3 is
  'Line-level tax code slot applied by Adjust LDTTN when a selected part needs an override from the invoice header.';
comment on column public.parts_invoice_lines.tax_code_4 is
  'Line-level tax code slot applied by Adjust LDTTN when a selected part needs an override from the invoice header.';
comment on column public.parts_invoice_lines.price_level_code is
  'Line-level pricing level code applied by Adjust LDTTN.';
comment on column public.parts_invoice_lines.non_stock_code is
  'Line-level non-stock code applied by Adjust LDTTN.';
comment on column public.parts_invoice_lines.ldttn_adjusted_by is
  'Last user to apply Adjust LDTTN to this parts invoice line.';
comment on column public.parts_invoice_lines.ldttn_adjusted_at is
  'Timestamp when Adjust LDTTN was last applied to this parts invoice line.';

create index if not exists idx_parts_invoice_lines_ldttn_selected
  on public.parts_invoice_lines (workspace_id, customer_invoice_id, sort_order)
  where ldttn_selected = true and deleted_at is null;

comment on index public.idx_parts_invoice_lines_ldttn_selected is
  'Purpose: find selected Parts Invoice Detail lines for Adjust LDTTN.';

create or replace function public.adjust_parts_invoice_ldttn(
  p_customer_invoice_id uuid,
  p_line_ids uuid[] default null,
  p_tax_code_1 text default null,
  p_tax_code_2 text default null,
  p_tax_code_3 text default null,
  p_tax_code_4 text default null,
  p_discount_pct numeric default null,
  p_price_level_code text default null,
  p_non_stock_code text default null,
  p_clear_selection boolean default true
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_updated_count integer;
begin
  if p_customer_invoice_id is null then
    raise exception 'p_customer_invoice_id is required';
  end if;

  if p_discount_pct is not null and (p_discount_pct < 0 or p_discount_pct > 100) then
    raise exception 'p_discount_pct must be between 0 and 100';
  end if;

  update public.parts_invoice_lines pil
  set
    tax_code_1 = coalesce(p_tax_code_1, pil.tax_code_1),
    tax_code_2 = coalesce(p_tax_code_2, pil.tax_code_2),
    tax_code_3 = coalesce(p_tax_code_3, pil.tax_code_3),
    tax_code_4 = coalesce(p_tax_code_4, pil.tax_code_4),
    discount_pct = coalesce(p_discount_pct, pil.discount_pct),
    price_level_code = coalesce(p_price_level_code, pil.price_level_code),
    non_stock_code = coalesce(p_non_stock_code, pil.non_stock_code),
    ldttn_selected = case when p_clear_selection then false else pil.ldttn_selected end,
    ldttn_adjusted_by = auth.uid(),
    ldttn_adjusted_at = now(),
    updated_at = now()
  where pil.customer_invoice_id = p_customer_invoice_id
    and pil.deleted_at is null
    and (
      (p_line_ids is not null and pil.id = any(p_line_ids))
      or (p_line_ids is null and pil.ldttn_selected = true)
    );

  get diagnostics v_updated_count = row_count;
  return v_updated_count;
end;
$$;

comment on function public.adjust_parts_invoice_ldttn(uuid, uuid[], text, text, text, text, numeric, text, text, boolean) is
  'Applies IntelliDealer Adjust LDTTN semantics to selected parts invoice lines: tax codes, discount, pricing level, and non-stock code. Runs as security invoker so parts_invoice_lines RLS remains authoritative.';

grant execute on function public.adjust_parts_invoice_ldttn(uuid, uuid[], text, text, text, text, numeric, text, text, boolean) to authenticated;
