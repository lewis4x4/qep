-- Resolve flow trigger inserts after emit_event gained actor metadata defaults.
--
-- Migration 196 introduced a 10-argument emit_event() signature but left the
-- original 8-argument version in place. Postgres treats calls that rely on the
-- default trailing arguments as ambiguous when both overloads exist, which
-- breaks inserts from trigger functions like voice.capture.created.
--
-- Keeping only the 10-argument version is backward-compatible because its last
-- two actor arguments default to system/null.

drop function if exists public.emit_event(
  text,
  text,
  text,
  text,
  jsonb,
  text,
  uuid,
  uuid
);
