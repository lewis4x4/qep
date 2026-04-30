create extension if not exists pgcrypto with schema extensions;

create or replace function public.qrm_redact_intellidealer_ar_card(p_card text)
returns text
language sql
stable
set search_path = public, extensions
as $$
  select case
    when p_card is null or btrim(p_card) = '' then null
    when btrim(p_card) ~* '^REDACTED:' then btrim(p_card)
    when btrim(p_card) ~ '^[*?xX-]+$' then upper(btrim(p_card))
    else 'REDACTED:' || encode(extensions.digest(convert_to(btrim(p_card), 'UTF8'), 'sha256'), 'hex')
  end
$$;

comment on function public.qrm_redact_intellidealer_ar_card(text) is
  'Returns a deterministic non-reversible token for IntelliDealer A/R card identifiers. Raw card values must not be stored in canonical QRM tables.';

revoke execute on function public.qrm_redact_intellidealer_ar_card(text) from public;

create or replace function public.qrm_customer_ar_agencies_redact_card_number()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  new.card_number := public.qrm_redact_intellidealer_ar_card(new.card_number);
  return new;
end;
$$;

comment on function public.qrm_customer_ar_agencies_redact_card_number() is
  'Before-write guard that prevents raw IntelliDealer A/R card identifiers from being stored in qrm_customer_ar_agencies.';

revoke execute on function public.qrm_customer_ar_agencies_redact_card_number() from public;

drop trigger if exists qrm_customer_ar_agencies_redact_card_number on public.qrm_customer_ar_agencies;
create trigger qrm_customer_ar_agencies_redact_card_number
  before insert or update of card_number on public.qrm_customer_ar_agencies
  for each row
  execute function public.qrm_customer_ar_agencies_redact_card_number();

update public.qrm_customer_ar_agencies
set card_number = public.qrm_redact_intellidealer_ar_card(card_number),
    updated_at = now()
where card_number is distinct from public.qrm_redact_intellidealer_ar_card(card_number);
