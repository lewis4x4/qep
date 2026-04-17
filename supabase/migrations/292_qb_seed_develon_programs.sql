-- ============================================================================
-- Migration 292: Seed Develon Q1 2026 Programs
--
-- Seeds 5 Develon Q1 2026 programs into qb_programs.
-- DX225 CIL amount ($7,500) confirmed from Slice 02 pricing fixture.
-- All other amounts from live staging DB (queried 2026-04-17).
--
-- Applied to staging (iciddijgonywtxoelous) during Slice 03 execution.
-- SQL file was missing from the outer repo commit — this reconstructs it.
-- ON CONFLICT DO NOTHING: idempotent, safe to run against a DB that already
-- has these rows.
-- ============================================================================

do $$
declare
  dev_id uuid;
begin
  select id into dev_id from public.qb_brands where code = 'DEVELON' limit 1;
  if dev_id is null then raise exception 'qb_brands row for DEVELON not found — run migration 284 first'; end if;

  -- ── Develon Q1 2026: Cash-In-Lieu ──────────────────────────────────────────
  insert into public.qb_programs
    (workspace_id, brand_id, program_code, program_type, name,
     effective_from, effective_to, details, active)
  values ('default', dev_id, 'DEV_Q1_2026_CIL', 'cash_in_lieu',
    'Develon Q1 2026 Cash-In-Lieu Rebate', '2026-01-01', '2026-03-31',
    '{"rebates":[
      {"model_code":"DX35Z",    "amount_cents":200000 },
      {"model_code":"DX50Z",    "amount_cents":250000 },
      {"model_code":"DX85R",    "amount_cents":350000 },
      {"model_code":"DX140LCR", "amount_cents":500000 },
      {"model_code":"DX180LC",  "amount_cents":600000 },
      {"model_code":"DX225LC",  "amount_cents":750000 },
      {"model_code":"DX225LL",  "amount_cents":750000 },
      {"model_code":"DX300LC",  "amount_cents":900000 },
      {"model_code":"DX380LC",  "amount_cents":1000000},
      {"model_code":"DX530LC",  "amount_cents":1200000}
    ]}'::jsonb, true)
  on conflict (workspace_id, brand_id, program_code) do nothing;

  -- ── Develon Q1 2026: Low-Rate Financing (DLL Finance) ──────────────────────
  insert into public.qb_programs
    (workspace_id, brand_id, program_code, program_type, name,
     effective_from, effective_to, details, active)
  values ('default', dev_id, 'DEV_Q1_2026_FINANCING', 'low_rate_financing',
    'Develon Q1 2026 DLL Finance Program', '2026-01-01', '2026-03-31',
    '{"terms":[
      {"months":36,"rate_pct":0,      "dealer_participation_pct":0},
      {"months":48,"rate_pct":0,      "dealer_participation_pct":0},
      {"months":60,"rate_pct":0.0199, "dealer_participation_pct":0},
      {"months":72,"rate_pct":0.0299, "dealer_participation_pct":0}
    ],"lenders":[
      {"name":"DLL Finance (Develon)","customer_type":"commercial",
       "contact":"Contact Develon regional rep for DLL Finance application"}
    ]}'::jsonb, true)
  on conflict (workspace_id, brand_id, program_code) do nothing;

  -- ── Develon Q1 2026: GMU Rebate ────────────────────────────────────────────
  insert into public.qb_programs
    (workspace_id, brand_id, program_code, program_type, name,
     effective_from, effective_to, details, active)
  values ('default', dev_id, 'DEV_Q1_2026_GMU', 'gmu_rebate',
    'Develon Q1 2026 Government/Municipality/Utility Program', '2026-01-01', '2026-03-31',
    '{"discount_off_list_pct":0.08,
      "requires_preapproval":true,
      "preapproval_instructions":"Contact Develon regional rep for GMU pre-approval before closing the deal.",
      "eligible_customer_types":["federal","state","local_gov","municipality","military","university","utility_coop"]
    }'::jsonb, true)
  on conflict (workspace_id, brand_id, program_code) do nothing;

  -- ── Develon Q1 2026: Aged Inventory ────────────────────────────────────────
  insert into public.qb_programs
    (workspace_id, brand_id, program_code, program_type, name,
     effective_from, effective_to, details, active)
  values ('default', dev_id, 'DEV_Q1_2026_AGED', 'aged_inventory',
    'Develon Q1 2026 Aged Inventory Program', '2026-01-01', '2026-03-31',
    '{"eligible_model_years":[2024,2023,2022,2021],
      "requires_reorder":false,
      "rebates":[
        {"model_code":"DX35Z",    "amount_cents":100000},
        {"model_code":"DX50Z",    "amount_cents":125000},
        {"model_code":"DX85R",    "amount_cents":175000},
        {"model_code":"DX140LCR", "amount_cents":250000},
        {"model_code":"DX180LC",  "amount_cents":300000},
        {"model_code":"DX225LC",  "amount_cents":375000},
        {"model_code":"DX225LL",  "amount_cents":375000},
        {"model_code":"DX300LC",  "amount_cents":450000},
        {"model_code":"DX380LC",  "amount_cents":500000},
        {"model_code":"DX530LC",  "amount_cents":600000}
      ]}'::jsonb, true)
  on conflict (workspace_id, brand_id, program_code) do nothing;

  -- ── Develon Q1 2026: Bridge Rent-to-Sales ──────────────────────────────────
  insert into public.qb_programs
    (workspace_id, brand_id, program_code, program_type, name,
     effective_from, effective_to, details, active)
  values ('default', dev_id, 'DEV_Q1_2026_BRIDGE', 'bridge_rent_to_sales',
    'Develon Q1 2026 Bridge Rent-to-Sales Program', '2026-01-01', '2026-03-31',
    '{"can_combine_with_others":false,
      "requires_reorder":false,
      "rebates":[
        {"model_code":"DX35Z",    "amount_cents":150000},
        {"model_code":"DX50Z",    "amount_cents":175000},
        {"model_code":"DX85R",    "amount_cents":250000},
        {"model_code":"DX140LCR", "amount_cents":350000},
        {"model_code":"DX180LC",  "amount_cents":400000},
        {"model_code":"DX225LC",  "amount_cents":500000},
        {"model_code":"DX225LL",  "amount_cents":500000},
        {"model_code":"DX300LC",  "amount_cents":600000},
        {"model_code":"DX380LC",  "amount_cents":700000},
        {"model_code":"DX530LC",  "amount_cents":800000}
      ]}'::jsonb, true)
  on conflict (workspace_id, brand_id, program_code) do nothing;

end $$;
