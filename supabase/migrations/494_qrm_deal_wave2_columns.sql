-- 494_qrm_deal_wave2_columns.sql
-- Wave 2 qrm_deals extension from Phase-9 open quotes portal tile.

alter table public.qrm_deals
  add column if not exists quote_type text,
  add column if not exists expires_at timestamptz;

comment on column public.qrm_deals.quote_type is 'Open quote type for Account 360: service/parts/equipment/rental.';
comment on column public.qrm_deals.expires_at is 'Quote/deal expiry timestamp for Account 360 open-quotes tile.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'qrm_deals_quote_type_chk') then
    alter table public.qrm_deals
      add constraint qrm_deals_quote_type_chk
      check (quote_type is null or quote_type in ('service','parts','equipment','rental')) not valid;
  end if;
end $$;
