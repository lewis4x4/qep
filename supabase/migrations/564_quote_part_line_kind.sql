-- ============================================================================
-- Migration 564: part line kind support on quote line enum
-- ============================================================================

do $$
begin
  if exists (
    select 1
    from pg_type
    where typname = 'quote_line_kind'
  ) then
    begin
      alter type public.quote_line_kind add value if not exists 'part';
    exception
      when duplicate_object then
        null;
    end;
  end if;
end$$;
