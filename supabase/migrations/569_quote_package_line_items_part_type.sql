-- 569_quote_package_line_items_part_type.sql
--
-- Step 3 now lets reps add QEP parts to quotes. The frontend and enum support
-- `part`, but the persisted line-item check constraint still blocked saves.

alter table public.quote_package_line_items
  drop constraint if exists quote_package_line_items_line_type_check;

alter table public.quote_package_line_items
  add constraint quote_package_line_items_line_type_check
  check (line_type in (
    'equipment', 'attachment', 'option', 'accessory', 'part', 'warranty', 'financing',
    'pdi', 'freight', 'good_faith', 'doc_fee', 'title', 'tag', 'registration',
    'discount', 'trade_allowance', 'rebate_mfg', 'rebate_dealer',
    'loyalty_discount', 'tax_state', 'tax_county', 'custom'
  ));
