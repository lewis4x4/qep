-- 487_branch_wave2_columns.sql
-- Wave 2 branch/location extensions from Phase-8 and Cross-Cutting.
-- Non-destructive additive path only: do not SET NOT NULL on short_code here.

alter table public.branches
  add column if not exists custom_invoice_prefixes text[],
  add column if not exists default_profit_center_code text,
  add column if not exists default_warehouse_code text;

comment on column public.branches.custom_invoice_prefixes is 'Per-branch allowed invoice first digits/letters from IntelliDealer System Settings-Location.';
comment on column public.branches.default_profit_center_code is 'Default GL profit-center digit 0-9 for the branch/location.';
comment on column public.branches.default_warehouse_code is 'Default warehouse/location code for parts inventory routing.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'branches_default_profit_center_code_chk') then
    alter table public.branches
      add constraint branches_default_profit_center_code_chk
      check (default_profit_center_code is null or default_profit_center_code ~ '^[0-9]$') not valid;
  end if;
end $$;

create unique index if not exists idx_branches_short_code_unique
  on public.branches (workspace_id, short_code)
  where short_code is not null;
comment on index public.idx_branches_short_code_unique is 'Purpose: branch/location code lookup without forcing NOT NULL on existing rows during Wave 2.';
