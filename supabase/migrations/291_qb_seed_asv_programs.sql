-- ============================================================================
-- Migration 291: Seed ASV + Yanmar Q1 2026 Programs
--
-- Seeds 5 ASV Q1 2026 programs + 5 Yanmar Q1 2026 programs into qb_programs.
-- Both brands unified under the same financing lenders (Great America Finance +
-- Vibrant Credit Union) per the original Slice 03 seed.
--
-- Applied to staging (iciddijgonywtxoelous) during Slice 03 execution.
-- SQL file was missing from the outer repo commit — this reconstructs it
-- from the live staging DB (queried 2026-04-17).
-- ON CONFLICT DO NOTHING: idempotent, safe to run against a DB that already
-- has these rows.
--
-- NOTE: ASV_Q1_2026_FINANCING name "ASV Q1 2026 Yanmar Finance Program" is
-- preserved exactly as it exists in staging — copy-paste artifact from original
-- seed. Fix tracked as TODO in Slice-XX cleanup:
--   UPDATE qb_programs SET name = 'ASV Q1 2026 Finance Program'
--   WHERE program_code = 'ASV_Q1_2026_FINANCING';
-- ============================================================================

do $$
declare
  asv_id uuid;
  yan_id uuid;
begin
  select id into asv_id from public.qb_brands where code = 'ASV'    limit 1;
  select id into yan_id from public.qb_brands where code = 'YANMAR' limit 1;

  if asv_id is null then raise exception 'qb_brands row for ASV not found — run migration 284 first'; end if;
  if yan_id is null then raise exception 'qb_brands row for YANMAR not found — run migration 284 first'; end if;

  -- ── ASV Q1 2026: Cash-In-Lieu ───────────────────────────────────────────────
  insert into public.qb_programs
    (workspace_id, brand_id, program_code, program_type, name,
     effective_from, effective_to, details, active)
  values ('default', asv_id, 'ASV_Q1_2026_CIL', 'cash_in_lieu',
    'ASV Q1 2026 Cash-In-Lieu Rebate', '2026-01-01', '2026-03-31',
    '{"rebates":[
      {"model_code":"RT-25",  "amount_cents":300000},
      {"model_code":"RT-40",  "amount_cents":350000},
      {"model_code":"RT-50",  "amount_cents":400000},
      {"model_code":"RT-65",  "amount_cents":700000},
      {"model_code":"VT-75",  "amount_cents":750000},
      {"model_code":"VT-80",  "amount_cents":800000},
      {"model_code":"VT-80F", "amount_cents":800000},
      {"model_code":"VT-100", "amount_cents":700000},
      {"model_code":"VT-100F","amount_cents":800000},
      {"model_code":"RT-135", "amount_cents":800000},
      {"model_code":"RT-135F","amount_cents":900000},
      {"model_code":"RS-75",  "amount_cents":200000},
      {"model_code":"VS-75",  "amount_cents":200000}
    ]}'::jsonb, true)
  on conflict (workspace_id, brand_id, program_code) do nothing;

  -- ── ASV Q1 2026: Low-Rate Financing ────────────────────────────────────────
  -- Name preserved as-is from staging ("Yanmar Finance Program" is a copy-paste
  -- artifact — see file header TODO).
  insert into public.qb_programs
    (workspace_id, brand_id, program_code, program_type, name,
     effective_from, effective_to, details, active)
  values ('default', asv_id, 'ASV_Q1_2026_FINANCING', 'low_rate_financing',
    'ASV Q1 2026 Yanmar Finance Program', '2026-01-01', '2026-03-31',
    '{"terms":[
      {"months":36,"rate_pct":0,      "dealer_participation_pct":0    },
      {"months":48,"rate_pct":0,      "dealer_participation_pct":0    },
      {"months":60,"rate_pct":0.0199, "dealer_participation_pct":0    },
      {"months":60,"rate_pct":0,      "dealer_participation_pct":0.015},
      {"months":72,"rate_pct":0.0299, "dealer_participation_pct":0    }
    ],"lenders":[
      {"name":"Great America Finance","customer_type":"commercial",
       "contact":"Tom Zubik, 312-550-4789, tzubik@greatamerica.com"},
      {"name":"Vibrant Credit Union","customer_type":"consumer",
       "contact":"John Weaver (FL), 309-645-2062, jweaver@vibrantcu.org"}
    ]}'::jsonb, true)
  on conflict (workspace_id, brand_id, program_code) do nothing;

  -- ── ASV Q1 2026: GMU Rebate ────────────────────────────────────────────────
  insert into public.qb_programs
    (workspace_id, brand_id, program_code, program_type, name,
     effective_from, effective_to, details, active)
  values ('default', asv_id, 'ASV_Q1_2026_GMU', 'gmu_rebate',
    'ASV Q1 2026 Government/Municipality/Utility Program', '2026-01-01', '2026-03-31',
    '{"discount_off_list_pct":0.08,
      "requires_preapproval":true,
      "preapproval_instructions":"Submit GMU Request in YCENA Machine Order App and attach the approval confirmation number before closing the deal.",
      "eligible_customer_types":["federal","state","local_gov","municipality","military","university","utility_coop"]
    }'::jsonb, true)
  on conflict (workspace_id, brand_id, program_code) do nothing;

  -- ── ASV Q1 2026: Aged Inventory ────────────────────────────────────────────
  insert into public.qb_programs
    (workspace_id, brand_id, program_code, program_type, name,
     effective_from, effective_to, details, active)
  values ('default', asv_id, 'ASV_Q1_2026_AGED', 'aged_inventory',
    'ASV Q1 2026 Aged Inventory Program', '2026-01-01', '2026-03-31',
    '{"eligible_model_years":[2024,2023,2022,2021],
      "requires_reorder":false,
      "rebates":[
        {"model_code":"RT-25",  "amount_cents":150000},
        {"model_code":"RT-40",  "amount_cents":175000},
        {"model_code":"RT-50",  "amount_cents":200000},
        {"model_code":"RT-65",  "amount_cents":350000},
        {"model_code":"VT-75",  "amount_cents":375000},
        {"model_code":"VT-80",  "amount_cents":400000},
        {"model_code":"VT-80F", "amount_cents":400000},
        {"model_code":"VT-100", "amount_cents":350000},
        {"model_code":"VT-100F","amount_cents":400000},
        {"model_code":"RT-135", "amount_cents":400000},
        {"model_code":"RT-135F","amount_cents":450000},
        {"model_code":"RS-75",  "amount_cents":100000},
        {"model_code":"VS-75",  "amount_cents":100000}
      ]}'::jsonb, true)
  on conflict (workspace_id, brand_id, program_code) do nothing;

  -- ── ASV Q1 2026: Bridge Rent-to-Sales ──────────────────────────────────────
  insert into public.qb_programs
    (workspace_id, brand_id, program_code, program_type, name,
     effective_from, effective_to, details, active)
  values ('default', asv_id, 'ASV_Q1_2026_BRIDGE', 'bridge_rent_to_sales',
    'ASV Q1 2026 Bridge Rent-to-Sales Program', '2026-01-01', '2026-03-31',
    '{"can_combine_with_others":false,
      "requires_reorder":false,
      "rebates":[
        {"model_code":"RT-25",  "amount_cents":200000},
        {"model_code":"RT-40",  "amount_cents":250000},
        {"model_code":"RT-50",  "amount_cents":300000},
        {"model_code":"RT-65",  "amount_cents":500000},
        {"model_code":"VT-75",  "amount_cents":500000},
        {"model_code":"VT-80",  "amount_cents":600000},
        {"model_code":"VT-80F", "amount_cents":600000},
        {"model_code":"VT-100", "amount_cents":500000},
        {"model_code":"VT-100F","amount_cents":600000},
        {"model_code":"RT-135", "amount_cents":600000},
        {"model_code":"RT-135F","amount_cents":700000},
        {"model_code":"RS-75",  "amount_cents":150000},
        {"model_code":"VS-75",  "amount_cents":150000}
      ]}'::jsonb, true)
  on conflict (workspace_id, brand_id, program_code) do nothing;

  -- ─────────────────────────────────────────────────────────────────────────────
  -- YANMAR Q1 2026 Programs
  -- ─────────────────────────────────────────────────────────────────────────────

  -- ── Yanmar Q1 2026: Cash-In-Lieu ───────────────────────────────────────────
  insert into public.qb_programs
    (workspace_id, brand_id, program_code, program_type, name,
     effective_from, effective_to, details, active)
  values ('default', yan_id, 'YAN_Q1_2026_CIL', 'cash_in_lieu',
    'Yanmar Q1 2026 Cash-In-Lieu Rebate', '2026-01-01', '2026-03-31',
    '{"rebates":[
      {"model_code":"VIO17",  "amount_cents":150000},
      {"model_code":"VIO25",  "amount_cents":200000},
      {"model_code":"VIO35",  "amount_cents":300000},
      {"model_code":"VIO55",  "amount_cents":500000},
      {"model_code":"VIO80",  "amount_cents":600000},
      {"model_code":"VIO100", "amount_cents":700000},
      {"model_code":"SV17",   "amount_cents":150000},
      {"model_code":"SV26",   "amount_cents":200000}
    ]}'::jsonb, true)
  on conflict (workspace_id, brand_id, program_code) do nothing;

  -- ── Yanmar Q1 2026: Low-Rate Financing ─────────────────────────────────────
  insert into public.qb_programs
    (workspace_id, brand_id, program_code, program_type, name,
     effective_from, effective_to, details, active)
  values ('default', yan_id, 'YAN_Q1_2026_FINANCING', 'low_rate_financing',
    'Yanmar Q1 2026 Yanmar Finance Program', '2026-01-01', '2026-03-31',
    '{"terms":[
      {"months":36,"rate_pct":0,      "dealer_participation_pct":0    },
      {"months":48,"rate_pct":0,      "dealer_participation_pct":0    },
      {"months":60,"rate_pct":0.0199, "dealer_participation_pct":0    },
      {"months":60,"rate_pct":0,      "dealer_participation_pct":0.015},
      {"months":72,"rate_pct":0.0299, "dealer_participation_pct":0    }
    ],"lenders":[
      {"name":"Great America Finance","customer_type":"commercial",
       "contact":"Tom Zubik, 312-550-4789, tzubik@greatamerica.com"},
      {"name":"Vibrant Credit Union","customer_type":"consumer",
       "contact":"John Weaver (FL), 309-645-2062, jweaver@vibrantcu.org"}
    ]}'::jsonb, true)
  on conflict (workspace_id, brand_id, program_code) do nothing;

  -- ── Yanmar Q1 2026: GMU Rebate ─────────────────────────────────────────────
  insert into public.qb_programs
    (workspace_id, brand_id, program_code, program_type, name,
     effective_from, effective_to, details, active)
  values ('default', yan_id, 'YAN_Q1_2026_GMU', 'gmu_rebate',
    'Yanmar Q1 2026 Government/Municipality/Utility Program', '2026-01-01', '2026-03-31',
    '{"discount_off_list_pct":0.08,
      "requires_preapproval":true,
      "preapproval_instructions":"Submit GMU Request in YCENA Machine Order App and attach the approval confirmation number before closing the deal.",
      "eligible_customer_types":["federal","state","local_gov","municipality","military","university","utility_coop"]
    }'::jsonb, true)
  on conflict (workspace_id, brand_id, program_code) do nothing;

  -- ── Yanmar Q1 2026: Aged Inventory ─────────────────────────────────────────
  insert into public.qb_programs
    (workspace_id, brand_id, program_code, program_type, name,
     effective_from, effective_to, details, active)
  values ('default', yan_id, 'YAN_Q1_2026_AGED', 'aged_inventory',
    'Yanmar Q1 2026 Aged Inventory Program', '2026-01-01', '2026-03-31',
    '{"eligible_model_years":[2024,2023,2022,2021],
      "requires_reorder":false,
      "rebates":[
        {"model_code":"VIO17",  "amount_cents":75000 },
        {"model_code":"VIO25",  "amount_cents":100000},
        {"model_code":"VIO35",  "amount_cents":150000},
        {"model_code":"VIO55",  "amount_cents":250000},
        {"model_code":"VIO80",  "amount_cents":300000},
        {"model_code":"VIO100", "amount_cents":350000},
        {"model_code":"SV17",   "amount_cents":75000 },
        {"model_code":"SV26",   "amount_cents":100000}
      ]}'::jsonb, true)
  on conflict (workspace_id, brand_id, program_code) do nothing;

  -- ── Yanmar Q1 2026: Bridge Rent-to-Sales ───────────────────────────────────
  insert into public.qb_programs
    (workspace_id, brand_id, program_code, program_type, name,
     effective_from, effective_to, details, active)
  values ('default', yan_id, 'YAN_Q1_2026_BRIDGE', 'bridge_rent_to_sales',
    'Yanmar Q1 2026 Bridge Rent-to-Sales Program', '2026-01-01', '2026-03-31',
    '{"can_combine_with_others":false,
      "requires_reorder":false,
      "rebates":[
        {"model_code":"VIO17",  "amount_cents":100000},
        {"model_code":"VIO25",  "amount_cents":150000},
        {"model_code":"VIO35",  "amount_cents":200000},
        {"model_code":"VIO55",  "amount_cents":350000},
        {"model_code":"VIO80",  "amount_cents":400000},
        {"model_code":"VIO100", "amount_cents":500000},
        {"model_code":"SV17",   "amount_cents":100000},
        {"model_code":"SV26",   "amount_cents":150000}
      ]}'::jsonb, true)
  on conflict (workspace_id, brand_id, program_code) do nothing;

end $$;
