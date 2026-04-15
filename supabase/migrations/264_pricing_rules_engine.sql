-- ============================================================================
-- Migration 264: Pricing Rules Engine (Slice P2.5)
--
-- Ships the enforcement layer that sits on top of the measurement layer
-- (v_parts_margin_signal + parts_vendor_prices from Phase 2).
--
-- Design principle: "Measure first, enforce second, never silently overwrite."
--
-- Tables:
--   parts_pricing_rules        — configurable rules (scope + type + target)
--   parts_pricing_suggestions  — proposed price changes awaiting approval
--   parts_pricing_audit        — immutable trail of every approved price move
--
-- Views:
--   v_parts_pricing_drift      — per-part: rule applied, current vs target,
--                                delta $ / delta %, flag if out of tolerance
--
-- RPCs:
--   pricing_rules_preview(rule_id)        — dry-run: how many parts, $impact
--   pricing_suggestions_generate()        — cron entry point; produces suggestions
--   pricing_suggestions_apply(ids, note)  — admin approves N suggestions at once
--   pricing_suggestions_dismiss(ids)      — admin rejects N suggestions
--   pricing_rules_summary()               — dashboard payload
--
-- Every price mutation path bumps `list_price_manual_override = true` so
-- future CDK re-imports land in the conflict queue instead of silently
-- overwriting our corrected prices.
-- ============================================================================

-- ── parts_pricing_rules ─────────────────────────────────────────────────────

create type public.pricing_rule_scope_type as enum (
  'global',         -- applies to all parts
  'vendor',         -- parts_catalog.vendor_code match
  'class',          -- parts_catalog.class_code match
  'category',       -- parts_catalog.category_code match
  'machine_code',   -- parts_catalog.machine_code match
  'part'            -- specific part_number
);

create type public.pricing_rule_type as enum (
  'min_margin_pct',          -- enforce a floor (25 = 25%)
  'target_margin_pct',       -- target a specific margin, auto-adjust sell
  'markup_multiplier',       -- cost × N (e.g. 1.40)
  'markup_with_floor'        -- greatest(cost × multiplier, cost + floor_cents/100)
);

create type public.pricing_level_target as enum (
  'list_price',      -- primary retail
  'pricing_level_1',
  'pricing_level_2',
  'pricing_level_3',
  'pricing_level_4',
  'all_levels'       -- apply formula across all tiers proportionally
);

create table if not exists public.parts_pricing_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  name text not null,
  description text,

  -- Scope
  scope_type public.pricing_rule_scope_type not null,
  scope_value text,                   -- null for 'global', required for others

  -- Rule
  rule_type public.pricing_rule_type not null,
  min_margin_pct numeric(5, 2),       -- 25.00 = 25%
  target_margin_pct numeric(5, 2),    -- 40.00 = 40%
  markup_multiplier numeric(6, 3),    -- 1.400 = 40% markup
  markup_floor_cents integer,         -- 500 = $5 minimum margin dollars

  -- Targeting
  price_target public.pricing_level_target not null default 'list_price',
  tolerance_pct numeric(5, 2) not null default 1.0,
    -- ignore drift smaller than this percent (avoid noise)

  -- Safety / lifecycle
  auto_apply boolean not null default false,
    -- if true, cron writes directly; if false (default), writes to
    -- parts_pricing_suggestions for admin approval
  is_active boolean not null default true,
  priority integer not null default 100,
    -- higher wins when multiple rules match same part
  effective_from date not null default current_date,
  effective_until date,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.parts_pricing_rules is
  'Configurable pricing rules. Enforces margin targets / markup formulas '
  'across scoped parts. Preview-before-commit by default (auto_apply=false).';

create index idx_pricing_rules_active
  on public.parts_pricing_rules (workspace_id, is_active, priority desc)
  where is_active = true;

create index idx_pricing_rules_scope
  on public.parts_pricing_rules (workspace_id, scope_type, scope_value)
  where is_active = true;

alter table public.parts_pricing_rules enable row level security;

create policy "pricing_rules_select"
  on public.parts_pricing_rules for select
  using (workspace_id = public.get_my_workspace());

create policy "pricing_rules_mutate_elevated"
  on public.parts_pricing_rules for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "pricing_rules_service_all"
  on public.parts_pricing_rules for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_pricing_rules_updated_at
  before update on public.parts_pricing_rules
  for each row execute function public.set_updated_at();

-- ── parts_pricing_suggestions ───────────────────────────────────────────────
-- Preview queue: cron + manual-trigger write proposed price changes here.
-- Admin reviews, approves, applies.

create type public.pricing_suggestion_status as enum (
  'pending',
  'approved',
  'applied',
  'dismissed',
  'expired'
);

create table if not exists public.parts_pricing_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  part_id uuid not null references public.parts_catalog(id) on delete cascade,
  part_number text not null,
  rule_id uuid references public.parts_pricing_rules(id) on delete set null,

  -- Snapshot at suggestion time
  current_cost numeric(14, 4),
  current_sell numeric(14, 4),
  current_margin_pct numeric(5, 2),

  -- What we want it to be
  target_price public.pricing_level_target not null,
  suggested_sell numeric(14, 4) not null,
  suggested_margin_pct numeric(5, 2),

  -- Delta
  delta_dollars numeric(14, 4),
  delta_pct numeric(5, 2),

  -- Context
  reason text not null,
    -- e.g. "Yanmar 40% target margin floor; cost rose $0.72, sell did not"
  signal text,
    -- e.g. 'vendor_price_increase', 'margin_below_min', 'initial_alignment'

  -- Lifecycle
  status public.pricing_suggestion_status not null default 'pending',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  applied_at timestamptz,
  review_note text,

  computation_batch_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, part_id, target_price, status)
    deferrable initially deferred
);

comment on table public.parts_pricing_suggestions is
  'Proposed price changes from rules engine. Admin approves/rejects. '
  'Applied rows update parts_catalog and write to parts_pricing_audit.';

create index idx_pricing_suggestions_pending
  on public.parts_pricing_suggestions (workspace_id, status, created_at desc)
  where status = 'pending';

create index idx_pricing_suggestions_part
  on public.parts_pricing_suggestions (part_id, status);

alter table public.parts_pricing_suggestions enable row level security;

create policy "pricing_suggestions_select"
  on public.parts_pricing_suggestions for select
  using (workspace_id = public.get_my_workspace());

create policy "pricing_suggestions_mutate_elevated"
  on public.parts_pricing_suggestions for all
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  )
  with check (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "pricing_suggestions_service_all"
  on public.parts_pricing_suggestions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger set_pricing_suggestions_updated_at
  before update on public.parts_pricing_suggestions
  for each row execute function public.set_updated_at();

-- ── parts_pricing_audit ─────────────────────────────────────────────────────
-- Immutable audit trail of every price change. INSERT-only.

create table if not exists public.parts_pricing_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'default',
  part_id uuid references public.parts_catalog(id) on delete set null,
  part_number text not null,

  price_target public.pricing_level_target not null,
  old_price numeric(14, 4),
  new_price numeric(14, 4) not null,
  delta_dollars numeric(14, 4),
  delta_pct numeric(5, 2),

  source text not null check (source in (
    'rule_auto_apply',
    'rule_suggestion_approved',
    'manual_edit',
    'cdk_import',
    'rollback'
  )),
  rule_id uuid,
  suggestion_id uuid,
  applied_by uuid references public.profiles(id) on delete set null,
  applied_at timestamptz not null default now(),

  note text,
  created_at timestamptz not null default now()
);

comment on table public.parts_pricing_audit is
  'Append-only log of every price change. Enables rollback + regulatory trail.';

create index idx_pricing_audit_part
  on public.parts_pricing_audit (part_id, applied_at desc);

create index idx_pricing_audit_source
  on public.parts_pricing_audit (workspace_id, source, applied_at desc);

alter table public.parts_pricing_audit enable row level security;

-- Read-only for admin; write is restricted to service role (RPCs below)
create policy "pricing_audit_select"
  on public.parts_pricing_audit for select
  using (
    workspace_id = public.get_my_workspace()
    and public.get_my_role() in ('admin', 'manager', 'owner')
  );

create policy "pricing_audit_service_insert"
  on public.parts_pricing_audit for insert
  with check (auth.role() = 'service_role' or public.get_my_role() in ('admin', 'owner'));

-- ── View: v_parts_pricing_drift ─────────────────────────────────────────────
-- Computes the delta between current sell price and what the highest-priority
-- matching rule says the sell price should be.

create or replace view public.v_parts_pricing_drift as
with rule_match as (
  -- For each part × each active rule, rank rules by priority (highest wins)
  select
    pc.id                       as part_id,
    pc.workspace_id,
    pc.part_number,
    pc.cost_price,
    pc.average_cost,
    pc.list_price,
    pc.vendor_code,
    pc.class_code,
    pc.category_code,
    pc.machine_code,
    pr.id                       as rule_id,
    pr.name                     as rule_name,
    pr.rule_type,
    pr.min_margin_pct,
    pr.target_margin_pct,
    pr.markup_multiplier,
    pr.markup_floor_cents,
    pr.price_target,
    pr.tolerance_pct,
    pr.priority,
    pr.auto_apply,
    row_number() over (
      partition by pc.id
      order by pr.priority desc, pr.created_at asc
    )                           as rule_rank
  from public.parts_catalog pc
  join public.parts_pricing_rules pr
    on pr.workspace_id = pc.workspace_id
    and pr.is_active = true
    and (pr.effective_from <= current_date)
    and (pr.effective_until is null or pr.effective_until >= current_date)
    and (
      (pr.scope_type = 'global'       and pr.scope_value is null)
      or (pr.scope_type = 'vendor'    and upper(pr.scope_value) = upper(pc.vendor_code))
      or (pr.scope_type = 'class'     and upper(pr.scope_value) = upper(pc.class_code))
      or (pr.scope_type = 'category'  and upper(pr.scope_value) = upper(pc.category_code))
      or (pr.scope_type = 'machine_code' and upper(pr.scope_value) = upper(pc.machine_code))
      or (pr.scope_type = 'part'      and upper(pr.scope_value) = upper(pc.part_number))
    )
  where pc.deleted_at is null
),
top_rule as (
  select * from rule_match where rule_rank = 1
),
computed as (
  select
    tr.*,
    coalesce(tr.cost_price, tr.average_cost, 0)              as cost_for_calc,
    -- Compute the "should-be" sell price based on rule type
    case tr.rule_type
      when 'min_margin_pct' then
        case
          when coalesce(tr.cost_price, tr.average_cost, 0) > 0
            and (tr.list_price - coalesce(tr.cost_price, tr.average_cost, 0)) / nullif(tr.list_price, 0) * 100
                < tr.min_margin_pct
          then round((coalesce(tr.cost_price, tr.average_cost, 0)
                      / (1 - tr.min_margin_pct / 100))::numeric, 2)
          else tr.list_price
        end
      when 'target_margin_pct' then
        round((coalesce(tr.cost_price, tr.average_cost, 0)
               / nullif(1 - tr.target_margin_pct / 100, 0))::numeric, 2)
      when 'markup_multiplier' then
        round((coalesce(tr.cost_price, tr.average_cost, 0) * tr.markup_multiplier)::numeric, 2)
      when 'markup_with_floor' then
        greatest(
          round((coalesce(tr.cost_price, tr.average_cost, 0) * tr.markup_multiplier)::numeric, 2),
          round((coalesce(tr.cost_price, tr.average_cost, 0) + tr.markup_floor_cents / 100.0)::numeric, 2)
        )
    end                           as target_sell_price
  from top_rule tr
)
select
  c.part_id,
  c.workspace_id,
  c.part_number,
  c.vendor_code,
  c.class_code,
  c.cost_price,
  c.list_price                  as current_sell_price,
  c.target_sell_price,
  round(((c.target_sell_price - c.list_price))::numeric, 2)        as delta_dollars,
  case when c.list_price > 0
    then round((((c.target_sell_price - c.list_price) / c.list_price) * 100)::numeric, 2)
    else null
  end                           as delta_pct,
  case
    when c.list_price > 0 and c.cost_price > 0
      then round((((c.list_price - c.cost_price) / c.list_price) * 100)::numeric, 2)
    else null
  end                           as current_margin_pct,
  case
    when c.target_sell_price > 0 and c.cost_for_calc > 0
      then round((((c.target_sell_price - c.cost_for_calc) / c.target_sell_price) * 100)::numeric, 2)
    else null
  end                           as target_margin_pct,
  c.rule_id,
  c.rule_name,
  c.rule_type,
  c.tolerance_pct,
  c.auto_apply,
  -- Drift flag: out of tolerance
  case
    when c.list_price > 0
      and abs((c.target_sell_price - c.list_price) / c.list_price * 100) > c.tolerance_pct
    then true
    else false
  end                           as out_of_tolerance
from computed c
where c.target_sell_price is not null;

comment on view public.v_parts_pricing_drift is
  'Per-part drift between current list_price and rule-target. Only parts '
  'with an applicable active rule appear. Feeds pricing_suggestions_generate().';

grant select on public.v_parts_pricing_drift to authenticated;

-- ── RPC: pricing_rules_preview ──────────────────────────────────────────────
-- Dry-run: given a rule (or a not-yet-inserted rule spec), report how many
-- parts it would affect and the net revenue impact. No writes.

create or replace function public.pricing_rules_preview(p_rule_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
  result jsonb;
begin
  ws := public.get_my_workspace();
  if public.get_my_role() not in ('admin', 'manager', 'owner') then
    raise exception 'insufficient role';
  end if;

  select jsonb_build_object(
    'rule_id', p_rule_id,
    'parts_in_scope', count(*),
    'parts_out_of_tolerance', count(*) filter (where out_of_tolerance),
    'parts_to_increase', count(*) filter (where out_of_tolerance and delta_dollars > 0),
    'parts_to_decrease', count(*) filter (where out_of_tolerance and delta_dollars < 0),
    'avg_delta_pct', round(avg(delta_pct) filter (where out_of_tolerance), 2),
    'max_increase_dollars', max(delta_dollars) filter (where out_of_tolerance and delta_dollars > 0),
    'max_decrease_dollars', min(delta_dollars) filter (where out_of_tolerance and delta_dollars < 0),
    'total_delta_dollars', round(coalesce(sum(delta_dollars) filter (where out_of_tolerance), 0), 2),
    'sample', (
      select coalesce(jsonb_agg(row_to_json(s)), '[]'::jsonb)
      from (
        select part_number, current_sell_price, target_sell_price,
               delta_dollars, delta_pct, current_margin_pct, target_margin_pct
        from public.v_parts_pricing_drift
        where workspace_id = ws and rule_id = p_rule_id and out_of_tolerance
        order by abs(delta_dollars) desc
        limit 25
      ) s
    )
  )
  into result
  from public.v_parts_pricing_drift
  where workspace_id = ws and rule_id = p_rule_id;

  return result;
end;
$$;

grant execute on function public.pricing_rules_preview(uuid) to authenticated;

-- ── RPC: pricing_suggestions_generate ───────────────────────────────────────
-- Scans v_parts_pricing_drift for out-of-tolerance parts, writes suggestions.
-- Called by cron (daily) or manually from the UI.

create or replace function public.pricing_suggestions_generate(p_rule_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
  batch_id text;
  started timestamptz := now();
  suggestions_written integer := 0;
  skipped_auto_applied integer := 0;
begin
  ws := coalesce(public.get_my_workspace(), 'default');
  if public.get_my_role() not in ('admin', 'manager', 'owner') and current_user <> 'service_role' then
    raise exception 'insufficient role';
  end if;

  batch_id := 'pricing-' || to_char(now(), 'YYYYMMDD-HH24MISS');

  -- First: expire any stale pending suggestions (>14 days old)
  update public.parts_pricing_suggestions
  set status = 'expired', updated_at = now()
  where workspace_id = ws
    and status = 'pending'
    and created_at < now() - interval '14 days';

  -- Insert new suggestions for drifted parts where rule is NOT auto_apply
  -- (auto_apply=true is handled by apply_autocorrect RPC separately)
  with drifted as (
    select *
    from public.v_parts_pricing_drift
    where workspace_id = ws
      and out_of_tolerance
      and (p_rule_id is null or rule_id = p_rule_id)
      and not auto_apply
  )
  insert into public.parts_pricing_suggestions (
    workspace_id, part_id, part_number, rule_id,
    current_cost, current_sell, current_margin_pct,
    target_price, suggested_sell, suggested_margin_pct,
    delta_dollars, delta_pct,
    reason, signal, status, computation_batch_id
  )
  select
    d.workspace_id, d.part_id, d.part_number, d.rule_id,
    d.cost_price, d.current_sell_price, d.current_margin_pct,
    'list_price'::public.pricing_level_target,
    d.target_sell_price, d.target_margin_pct,
    d.delta_dollars, d.delta_pct,
    format('Rule "%s" suggests %s%s ($%s)',
           d.rule_name,
           case when d.delta_dollars > 0 then 'increase ' else 'decrease ' end,
           abs(d.delta_pct)::text || '%',
           abs(d.delta_dollars)::text),
    case
      when d.delta_dollars > 0 then 'price_too_low'
      else 'price_too_high'
    end,
    'pending',
    batch_id
  from drifted d
  on conflict (workspace_id, part_id, target_price, status) where status = 'pending'
  do update set
    suggested_sell = excluded.suggested_sell,
    suggested_margin_pct = excluded.suggested_margin_pct,
    delta_dollars = excluded.delta_dollars,
    delta_pct = excluded.delta_pct,
    reason = excluded.reason,
    computation_batch_id = excluded.computation_batch_id,
    updated_at = now();

  get diagnostics suggestions_written = row_count;

  return jsonb_build_object(
    'ok', true,
    'suggestions_written', suggestions_written,
    'batch_id', batch_id,
    'elapsed_ms', extract(epoch from (now() - started)) * 1000
  );
end;
$$;

grant execute on function public.pricing_suggestions_generate(uuid) to authenticated;

-- ── RPC: pricing_suggestions_apply ──────────────────────────────────────────
-- Approve N suggestions, write to parts_catalog (with override flag), audit.

create or replace function public.pricing_suggestions_apply(
  p_suggestion_ids uuid[],
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
  actor uuid;
  applied_count integer := 0;
  s record;
begin
  ws := public.get_my_workspace();
  actor := auth.uid();
  if public.get_my_role() not in ('admin', 'manager', 'owner') then
    raise exception 'insufficient role for pricing approval';
  end if;

  for s in
    select * from public.parts_pricing_suggestions
    where id = any(p_suggestion_ids)
      and workspace_id = ws
      and status = 'pending'
  loop
    -- Suppress the override tracker so we can set the new price AND the
    -- override flag ourselves (not the trigger inferring "someone edited it")
    perform set_config('parts_catalog.suppress_override_tracking', 'on', true);

    if s.target_price = 'list_price' then
      update public.parts_catalog
      set list_price = s.suggested_sell,
          list_price_manual_override = true,
          manual_updated_by = actor,
          manual_updated_at = now(),
          updated_at = now()
      where id = s.part_id;
    elsif s.target_price = 'pricing_level_1' then
      update public.parts_catalog
      set pricing_level_1 = s.suggested_sell,
          pricing_level_1_manual_override = true,
          manual_updated_by = actor,
          manual_updated_at = now(),
          updated_at = now()
      where id = s.part_id;
    elsif s.target_price = 'pricing_level_2' then
      update public.parts_catalog
      set pricing_level_2 = s.suggested_sell,
          pricing_level_2_manual_override = true,
          manual_updated_by = actor,
          manual_updated_at = now(),
          updated_at = now()
      where id = s.part_id;
    elsif s.target_price = 'pricing_level_3' then
      update public.parts_catalog
      set pricing_level_3 = s.suggested_sell,
          pricing_level_3_manual_override = true,
          manual_updated_by = actor,
          manual_updated_at = now(),
          updated_at = now()
      where id = s.part_id;
    elsif s.target_price = 'pricing_level_4' then
      update public.parts_catalog
      set pricing_level_4 = s.suggested_sell,
          pricing_level_4_manual_override = true,
          manual_updated_by = actor,
          manual_updated_at = now(),
          updated_at = now()
      where id = s.part_id;
    end if;

    -- Audit
    insert into public.parts_pricing_audit (
      workspace_id, part_id, part_number,
      price_target, old_price, new_price,
      delta_dollars, delta_pct,
      source, rule_id, suggestion_id, applied_by, note
    ) values (
      ws, s.part_id, s.part_number,
      s.target_price, s.current_sell, s.suggested_sell,
      s.delta_dollars, s.delta_pct,
      'rule_suggestion_approved', s.rule_id, s.id, actor, p_note
    );

    -- Mark suggestion applied
    update public.parts_pricing_suggestions
    set status = 'applied',
        reviewed_by = actor,
        reviewed_at = now(),
        applied_at = now(),
        review_note = p_note,
        updated_at = now()
    where id = s.id;

    applied_count := applied_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'applied_count', applied_count
  );
end;
$$;

grant execute on function public.pricing_suggestions_apply(uuid[], text) to authenticated;

-- ── RPC: pricing_suggestions_dismiss ────────────────────────────────────────

create or replace function public.pricing_suggestions_dismiss(
  p_suggestion_ids uuid[],
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
  actor uuid;
  dismissed_count integer;
begin
  ws := public.get_my_workspace();
  actor := auth.uid();
  if public.get_my_role() not in ('admin', 'manager', 'owner') then
    raise exception 'insufficient role';
  end if;

  update public.parts_pricing_suggestions
  set status = 'dismissed',
      reviewed_by = actor,
      reviewed_at = now(),
      review_note = coalesce(p_note, review_note),
      updated_at = now()
  where id = any(p_suggestion_ids)
    and workspace_id = ws
    and status = 'pending';

  get diagnostics dismissed_count = row_count;

  return jsonb_build_object('ok', true, 'dismissed_count', dismissed_count);
end;
$$;

grant execute on function public.pricing_suggestions_dismiss(uuid[], text) to authenticated;

-- ── RPC: pricing_rules_summary — dashboard payload ──────────────────────────

create or replace function public.pricing_rules_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws text;
  result jsonb;
begin
  ws := public.get_my_workspace();

  select jsonb_build_object(
    'kpis', jsonb_build_object(
      'active_rules', (
        select count(*)::int from public.parts_pricing_rules
        where workspace_id = ws and is_active = true
      ),
      'pending_suggestions', (
        select count(*)::int from public.parts_pricing_suggestions
        where workspace_id = ws and status = 'pending'
      ),
      'pending_revenue_impact', (
        select coalesce(sum(delta_dollars), 0)::numeric(14,2)
        from public.parts_pricing_suggestions
        where workspace_id = ws and status = 'pending'
      ),
      'applied_last_30d', (
        select count(*)::int from public.parts_pricing_suggestions
        where workspace_id = ws and status = 'applied'
          and applied_at >= now() - interval '30 days'
      ),
      'parts_out_of_tolerance', (
        select count(distinct part_id)::int
        from public.v_parts_pricing_drift
        where workspace_id = ws and out_of_tolerance
      )
    ),
    'active_rules', (
      select coalesce(jsonb_agg(row_to_json(r) order by r.priority desc), '[]'::jsonb)
      from (
        select id, name, scope_type, scope_value, rule_type,
               min_margin_pct, target_margin_pct, markup_multiplier,
               price_target, tolerance_pct, auto_apply, priority,
               effective_from, effective_until
        from public.parts_pricing_rules
        where workspace_id = ws and is_active = true
        order by priority desc
      ) r
    ),
    'top_pending_suggestions', (
      select coalesce(jsonb_agg(row_to_json(s)), '[]'::jsonb)
      from (
        select id, part_number, current_sell, suggested_sell,
               delta_dollars, delta_pct, current_margin_pct, suggested_margin_pct,
               reason, signal, created_at
        from public.parts_pricing_suggestions
        where workspace_id = ws and status = 'pending'
        order by abs(delta_dollars) desc
        limit 20
      ) s
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.pricing_rules_summary() to authenticated;

-- ============================================================================
-- Migration 264 complete.
-- ============================================================================
