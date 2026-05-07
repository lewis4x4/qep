-- ============================================================================
-- 551_quote_availability_event_cascade_fix.sql
--
-- Keeps quote availability events immutable for authenticated users via RLS and
-- update trigger, while allowing service-role/cascade deletes when a parent
-- quote/request is removed.
-- ============================================================================

drop trigger if exists trg_quote_availability_events_append_only on public.quote_availability_events;
create trigger trg_quote_availability_events_append_only
  before update on public.quote_availability_events
  for each row execute function public.prevent_quote_availability_event_mutation();
