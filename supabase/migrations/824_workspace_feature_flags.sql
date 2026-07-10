-- 824_workspace_feature_flags.sql
--
-- L11.4 finding: iron-execute-flow-step gates Iron flows on
-- workspace_settings.feature_flags (absent = enabled, explicit false =
-- blocked), but the column never existed — the best-effort lookup errored
-- silently and every flag check passed. The "kill switch" was
-- unenforceable. Additive column; the existing runtime check needs no
-- code change.

begin;

alter table public.workspace_settings
  add column if not exists feature_flags jsonb not null default '{}'::jsonb;

comment on column public.workspace_settings.feature_flags is
  'Per-workspace feature flags (e.g. iron.flow.open_rental_contract). '
  'Checks are default-on: only an explicit false disables a flow.';

commit;
