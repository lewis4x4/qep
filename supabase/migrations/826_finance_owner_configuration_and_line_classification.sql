-- 826_finance_owner_configuration_and_line_classification.sql
--
-- Places answered finance values into finance_foundation_config and replaces
-- description-based Parts-vs-Service classification with persisted structural
-- dimensions on canonical quote, billing, parts, and customer-invoice lines.

begin;

-- ---------------------------------------------------------------------------
-- 1. Owner-ratified configuration. Sensitive account numbers are not stored;
--    only the named accounts and operating policy from the packet are placed.
-- ---------------------------------------------------------------------------

with answered(config_key, config_value, authorizing_question, note) as (
  values
    (
      'invoice_pad_width',
      '{"digits":5}'::jsonb,
      'F7',
      'Owner-ratified five-digit branch/department sequence. Existing issued identifiers and counters are preserved.'
    ),
    (
      'department_invoice_prefixes',
      '{"equipment":"E","rental":"R","parts":"P","service":"W"}'::jsonb,
      'F7',
      'Canonical owner prefixes. S remains readable only as a historical compatibility value.'
    ),
    (
      'branch_allocation_basis',
      '{"basis":"headcount","effective_dated":true,"values_status":"awaiting_current_headcounts"}'::jsonb,
      'F2',
      'Allocation method is authorized; exact branch headcount values remain blocked in M0.2.'
    ),
    (
      'book_depreciation_policy',
      '{"owned_equipment_method":"straight_line","rental_basis_reduction":"buydown_40_pct_per_payment","tax_depreciation_owner":"cpa","compute_bonus_or_section_179":false}'::jsonb,
      'F3',
      'QEP OS carries book depreciation only and exports basis/accumulated depreciation for CPA tax work.'
    ),
    (
      'open_service_wo_cutover_policy',
      '{"target_month_day":"01-01","legacy_finish_horizon_days":14,"migrate_longer_jobs":true,"carry_accumulated_labor_and_parts_cost":true,"tag_migrated":true}'::jsonb,
      'F6',
      'Split cutover: short WOs finish in legacy; longer WOs migrate with accumulated cost.'
    ),
    (
      'master_id_strategy',
      '{"match_key":"intellidealer_account_number","qep_primary_id":"uuid","retain_permanent_cross_reference":true}'::jsonb,
      'F8',
      'Use IntelliDealer account number for deterministic match, not as the new primary key.'
    ),
    (
      'quickbooks_desktop_boundary',
      '{"qep_os_is_ledger":true,"intellidealer_is_transition_sor":true,"outputs":["check_register","cpa_reporting"],"retire_when_qep_standalone":true,"sample_format_status":"awaiting_tina_cpa"}'::jsonb,
      'F10',
      'QuickBooks Desktop remains a downstream check-register and CPA-reporting destination; it is not the ledger.'
    ),
    (
      'bank_account_register',
      '{"accounts":[{"name":"Operating","institution":"First Federal Bank"},{"name":"Wire","institution":"First Federal Bank","reconcile_unit_payoffs":true},{"name":"Savings","institution":"Campus USA Credit Union"}],"reconciliation_owners":["Tina","AR/AP clerk"],"contains_account_numbers":false}'::jsonb,
      'F10',
      'Named account register only. No account or routing numbers are stored in this owner-answer migration.'
    ),
    (
      'deposit_liability_policy',
      '{"sale_deposit":{"liability_until_invoice_close":true,"apply_as_partial_payment":true},"rental_security":{"separate_liability":true,"damage_first":true,"bill_shortfall":true,"refund_remainder":true},"reconcile_monthly":true}'::jsonb,
      'F11',
      'Unified policy over existing sale and rental sources; the liability ledger ships separately.'
    ),
    (
      'finance_charge_policy_requested',
      '{"statement_day":1,"monthly_rate":0.015,"starts_days_past_due":30,"compound_requested":true,"reminder_window_days":[30,60],"credit_hold_day":60,"lawful_cap_required":true,"activation_status":"legal_review_required"}'::jsonb,
      'F9',
      'Captures owner intent without enabling compounding. Legal approval and monthly idempotency are required before activation.'
    )
)
update public.finance_foundation_config c
set
  config_value = a.config_value,
  safe_default = a.config_value,
  authorizing_question = a.authorizing_question,
  note = a.note,
  is_active = true,
  deleted_at = null,
  updated_at = now()
from answered a
where c.workspace_id = 'default'
  and c.company_id is null
  and c.config_key = a.config_key
  and c.deleted_at is null;

with answered(config_key, config_value, authorizing_question, note) as (
  values
    ('invoice_pad_width', '{"digits":5}'::jsonb, 'F7', 'Owner-ratified five-digit branch/department sequence. Existing issued identifiers and counters are preserved.'),
    ('department_invoice_prefixes', '{"equipment":"E","rental":"R","parts":"P","service":"W"}'::jsonb, 'F7', 'Canonical owner prefixes. S remains readable only as a historical compatibility value.'),
    ('branch_allocation_basis', '{"basis":"headcount","effective_dated":true,"values_status":"awaiting_current_headcounts"}'::jsonb, 'F2', 'Allocation method is authorized; exact branch headcount values remain blocked in M0.2.'),
    ('book_depreciation_policy', '{"owned_equipment_method":"straight_line","rental_basis_reduction":"buydown_40_pct_per_payment","tax_depreciation_owner":"cpa","compute_bonus_or_section_179":false}'::jsonb, 'F3', 'QEP OS carries book depreciation only and exports basis/accumulated depreciation for CPA tax work.'),
    ('open_service_wo_cutover_policy', '{"target_month_day":"01-01","legacy_finish_horizon_days":14,"migrate_longer_jobs":true,"carry_accumulated_labor_and_parts_cost":true,"tag_migrated":true}'::jsonb, 'F6', 'Split cutover: short WOs finish in legacy; longer WOs migrate with accumulated cost.'),
    ('master_id_strategy', '{"match_key":"intellidealer_account_number","qep_primary_id":"uuid","retain_permanent_cross_reference":true}'::jsonb, 'F8', 'Use IntelliDealer account number for deterministic match, not as the new primary key.'),
    ('quickbooks_desktop_boundary', '{"qep_os_is_ledger":true,"intellidealer_is_transition_sor":true,"outputs":["check_register","cpa_reporting"],"retire_when_qep_standalone":true,"sample_format_status":"awaiting_tina_cpa"}'::jsonb, 'F10', 'QuickBooks Desktop remains a downstream check-register and CPA-reporting destination; it is not the ledger.'),
    ('bank_account_register', '{"accounts":[{"name":"Operating","institution":"First Federal Bank"},{"name":"Wire","institution":"First Federal Bank","reconcile_unit_payoffs":true},{"name":"Savings","institution":"Campus USA Credit Union"}],"reconciliation_owners":["Tina","AR/AP clerk"],"contains_account_numbers":false}'::jsonb, 'F10', 'Named account register only. No account or routing numbers are stored in this owner-answer migration.'),
    ('deposit_liability_policy', '{"sale_deposit":{"liability_until_invoice_close":true,"apply_as_partial_payment":true},"rental_security":{"separate_liability":true,"damage_first":true,"bill_shortfall":true,"refund_remainder":true},"reconcile_monthly":true}'::jsonb, 'F11', 'Unified policy over existing sale and rental sources; the liability ledger ships separately.'),
    ('finance_charge_policy_requested', '{"statement_day":1,"monthly_rate":0.015,"starts_days_past_due":30,"compound_requested":true,"reminder_window_days":[30,60],"credit_hold_day":60,"lawful_cap_required":true,"activation_status":"legal_review_required"}'::jsonb, 'F9', 'Captures owner intent without enabling compounding. Legal approval and monthly idempotency are required before activation.')
)
insert into public.finance_foundation_config (
  workspace_id, company_id, config_key, config_value, safe_default,
  authorizing_question, note
)
select
  'default', null, a.config_key, a.config_value, a.config_value,
  a.authorizing_question, a.note
from answered a
where not exists (
  select 1
  from public.finance_foundation_config c
  where c.workspace_id = 'default'
    and c.company_id is null
    and c.config_key = a.config_key
    and c.deleted_at is null
);

-- Place the owner-approved branch identity without activating an unfinished
-- location or touching the separate live Ocala selling branch.
update public.branches
set
  display_name = 'Belleview',
  city = coalesce(city, 'Belleview'),
  state_province = coalesce(state_province, 'FL'),
  legacy_code = coalesce(legacy_code, '02'),
  legacy_invoice_branch_code = coalesce(legacy_invoice_branch_code, '02'),
  metadata = coalesce(metadata, '{}'::jsonb) || '{"owner_packet_branch_identity":true}'::jsonb,
  updated_at = now()
where workspace_id = 'default'
  and slug = '02'
  and deleted_at is null;

-- Lake City already has one canonical active branch (slug 01) and a separate
-- historical lakecity-branch row used by legacy inventory references. Never
-- assign the same unique legacy_code to both rows; only complete the canonical
-- branch's invoice identity.
update public.branches
set
  legacy_code = '01',
  updated_at = now()
where workspace_id = 'default'
  and slug = '01'
  and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2. Structural two-layer classification on canonical line tables.
-- ---------------------------------------------------------------------------

alter table public.customer_invoice_line_items
  add column if not exists finance_department text,
  add column if not exists finance_segment text,
  add column if not exists finance_category text,
  add column if not exists finance_classification_source text,
  add column if not exists finance_classified_at timestamptz;

alter table public.parts_invoice_lines
  add column if not exists finance_department text not null default 'parts',
  add column if not exists finance_segment text not null default 'customer',
  add column if not exists finance_category text not null default 'part',
  add column if not exists finance_classification_source text not null default 'canonical_parts_line';

alter table public.service_quote_lines
  add column if not exists finance_department text,
  add column if not exists finance_segment text,
  add column if not exists finance_category text;

alter table public.service_billing_rows
  add column if not exists finance_department text,
  add column if not exists finance_segment text,
  add column if not exists finance_category text,
  add column if not exists finance_classification_source text;

do $$
declare
  v_table text;
  v_constraint text;
begin
  foreach v_table in array array[
    'customer_invoice_line_items',
    'parts_invoice_lines',
    'service_quote_lines',
    'service_billing_rows'
  ]
  loop
    v_constraint := v_table || '_finance_department_chk';
    if not exists (select 1 from pg_constraint where conname = v_constraint) then
      execute format(
        'alter table public.%I add constraint %I check (finance_department is null or finance_department in (''equipment'',''parts'',''service'',''rental'')) not valid',
        v_table, v_constraint
      );
    end if;

    v_constraint := v_table || '_finance_segment_chk';
    if not exists (select 1 from pg_constraint where conname = v_constraint) then
      execute format(
        'alter table public.%I add constraint %I check (finance_segment is null or finance_segment in (''customer'',''warranty'',''internal'',''sublet'')) not valid',
        v_table, v_constraint
      );
    end if;
  end loop;
end
$$;

comment on column public.customer_invoice_line_items.finance_department is
  'F1 structural department: equipment, parts, service, or rental. Do not infer from description text.';
comment on column public.customer_invoice_line_items.finance_segment is
  'F1 business segment: customer, warranty, internal, or sublet.';
comment on column public.customer_invoice_line_items.finance_category is
  'Structured line category such as equipment, part, labor, haul, sublet, shop_supply, freight, discount, fee, rental, or misc.';
comment on column public.service_billing_rows.finance_department is
  'F1 invariant: row_type=part belongs to Parts even when the parent is a service work order; every other service billing row belongs to Service.';

create index if not exists idx_customer_invoice_lines_finance_dimensions
  on public.customer_invoice_line_items(
    workspace_id, finance_department, finance_segment, invoice_id
  );

create index if not exists idx_service_billing_rows_finance_dimensions
  on public.service_billing_rows(
    workspace_id, finance_department, finance_segment, service_job_id
  )
  where deleted_at is null;

create or replace function public.qep_apply_service_line_finance_classification()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_line_type text;
  v_revenue_type text;
begin
  v_line_type := coalesce(to_jsonb(new)->>'line_type', to_jsonb(new)->>'row_type', 'misc');
  v_revenue_type := coalesce(to_jsonb(new)->>'payer_type', to_jsonb(new)->>'revenue_type', 'customer');

  new.finance_department := case when v_line_type = 'part' then 'parts' else 'service' end;
  new.finance_segment := case
    when v_line_type = 'sublet' then 'sublet'
    when v_revenue_type in ('warranty', 'warranty_claim', 'oem_policy') then 'warranty'
    when v_revenue_type in ('internal', 'qep_internal', 'goodwill') then 'internal'
    when v_revenue_type = 'sublet' then 'sublet'
    else 'customer'
  end;
  new.finance_category := case
    when v_line_type in ('labor', 'labor_adjustment') then 'labor'
    when v_line_type = 'part' then 'part'
    when v_line_type = 'haul' then 'haul'
    when v_line_type = 'sublet' then 'sublet'
    when v_line_type = 'shop_supply' then 'shop_supply'
    when v_line_type = 'freight' then 'freight'
    when v_line_type = 'discount' then 'discount'
    else 'misc'
  end;

  if to_jsonb(new) ? 'finance_classification_source' then
    new.finance_classification_source := 'service_line_type';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_service_quote_line_finance_classification
  on public.service_quote_lines;
create trigger trg_service_quote_line_finance_classification
  before insert or update of line_type, payer_type
  on public.service_quote_lines
  for each row execute function public.qep_apply_service_line_finance_classification();

drop trigger if exists trg_service_billing_row_finance_classification
  on public.service_billing_rows;
create trigger trg_service_billing_row_finance_classification
  before insert or update of row_type, revenue_type
  on public.service_billing_rows
  for each row execute function public.qep_apply_service_line_finance_classification();

update public.service_quote_lines
set
  finance_department = case when line_type = 'part' then 'parts' else 'service' end,
  finance_segment = case
    when line_type = 'sublet' then 'sublet'
    when payer_type in ('warranty_claim', 'oem_policy') then 'warranty'
    when payer_type in ('qep_internal', 'goodwill') then 'internal'
    else 'customer'
  end,
  finance_category = case
    when line_type = 'labor' then 'labor'
    when line_type = 'part' then 'part'
    when line_type = 'haul' then 'haul'
    when line_type = 'shop_supply' then 'shop_supply'
    when line_type = 'discount' then 'discount'
    else 'misc'
  end
where finance_department is null
   or finance_segment is null
   or finance_category is null;

update public.service_billing_rows
set
  finance_department = case when row_type::text = 'part' then 'parts' else 'service' end,
  finance_segment = case
    when row_type::text = 'sublet' then 'sublet'
    when payer_type in ('warranty_claim', 'oem_policy') then 'warranty'
    when payer_type in ('qep_internal', 'goodwill') then 'internal'
    when revenue_type::text in ('customer', 'warranty', 'internal', 'sublet') then revenue_type::text
    else 'customer'
  end,
  finance_category = case
    when row_type::text = 'labor_adjustment' then 'labor'
    when row_type::text = 'part' then 'part'
    when row_type::text = 'haul' then 'haul'
    when row_type::text = 'sublet' then 'sublet'
    when row_type::text = 'shop_supply' then 'shop_supply'
    when row_type::text = 'freight' then 'freight'
    when row_type::text = 'discount' then 'discount'
    else 'misc'
  end,
  finance_classification_source = 'service_line_type'
where finance_department is null
   or finance_segment is null
   or finance_category is null;

-- Support the structural parts backfill before it probes the latest linked
-- service row for every live parts line. The partial index also serves future
-- reconciliation reads without indexing deleted history.
create index if not exists idx_service_billing_rows_parts_line_latest
  on public.service_billing_rows (parts_invoice_line_id, created_at desc)
  where deleted_at is null
    and parts_invoice_line_id is not null;

-- Canonical parts rows stay Parts even when linked from a service WO.
update public.parts_invoice_lines pil
set
  finance_department = 'parts',
  finance_segment = coalesce((
    select sbr.finance_segment
    from public.service_billing_rows sbr
    where sbr.parts_invoice_line_id = pil.id
      and sbr.deleted_at is null
    order by sbr.created_at desc
    limit 1
  ), 'customer'),
  finance_category = 'part',
  finance_classification_source = 'canonical_parts_line'
where pil.deleted_at is null;

-- Safe header-based backfill for streams whose line nature is unambiguous.
-- Historical service lines remain unclassified unless a structural source row
-- exists; this deliberately refuses the old description-string heuristic.
update public.customer_invoice_line_items li
set
  finance_department = case ci.invoice_type
    when 'equipment' then 'equipment'
    when 'parts' then 'parts'
    when 'rental' then 'rental'
    else li.finance_department
  end,
  finance_segment = case
    when ci.invoice_type in ('equipment', 'parts', 'rental') then 'customer'
    else li.finance_segment
  end,
  finance_category = case ci.invoice_type
    when 'equipment' then 'equipment'
    when 'parts' then 'part'
    when 'rental' then 'rental'
    else li.finance_category
  end,
  finance_classification_source = case
    when ci.invoice_type in ('equipment', 'parts', 'rental') then 'invoice_type_backfill'
    else li.finance_classification_source
  end,
  finance_classified_at = case
    when ci.invoice_type in ('equipment', 'parts', 'rental') then coalesce(li.finance_classified_at, now())
    else li.finance_classified_at
  end
from public.customer_invoices ci
where ci.id = li.invoice_id
  and ci.workspace_id = li.workspace_id
  and ci.invoice_type in ('equipment', 'parts', 'rental')
  and li.finance_department is null;

create or replace view public.finance_invoice_line_classifications
with (security_invoker = true) as
select
  li.workspace_id,
  li.invoice_id,
  li.id as invoice_line_id,
  li.line_number,
  li.description,
  li.quantity,
  li.unit_price,
  li.line_total,
  li.finance_department,
  li.finance_segment,
  li.finance_category,
  li.finance_classification_source,
  (li.finance_department is null or li.finance_segment is null) as needs_review
from public.customer_invoice_line_items li;

comment on view public.finance_invoice_line_classifications is
  'F1 structural invoice-line dimensions. needs_review exposes legacy/service lines that lack source-backed classification; no description matching is used.';

grant select on public.finance_invoice_line_classifications to authenticated, service_role;

create or replace function public.qep_finance_department_code(p_department text)
returns text
language sql
immutable
strict
as $$
  select case lower(p_department)
    when 'equipment' then 'E'
    when 'rental' then 'R'
    when 'parts' then 'P'
    when 'service' then 'W'
    else null
  end;
$$;

comment on function public.qep_finance_department_code(text) is
  'F7 owner-approved department prefix mapping: E/R/P/W.';

update public.qep_roadmap_tasks
set
  evidence_link = concat_ws(' | ', nullif(evidence_link, ''), 'supabase/migrations/826_finance_owner_configuration_and_line_classification.sql'),
  notes = coalesce(notes, '') || E'\n[2026-07-20] F1/F2/F3/F6-F11 values placed in finance_foundation_config. Canonical line structures now persist department + segment + category; service parts remain Parts without description matching.',
  updated_at = now()
where task_id in ('K2.1', 'K3.1', 'M0.1');

commit;

-- Rollback / fix-forward notes:
--   Preserve structural department/segment classifications already written to
--   invoice and quote lines. To disable new classification, stop the writers
--   and mark affected legacy rows needs_review; do not infer replacements from
--   descriptions or drop effective-dated finance configuration evidence.
