-- ============================================================================
-- Migration 299: ASV Demo Equipment Models
--
-- Seeds 6 ASV Compact Track Loader (CTL) models into qb_equipment_models
-- so the Slice 05 fuzzy search RPC (qb_search_equipment_fuzzy) returns real
-- results in staging before Rylee/Angela ingest the official price sheet.
--
-- Prices are approximate estimates derived from:
--   - ASV publicly available product specifications (asvi.com)
--   - Q4 2025 dealer price book estimates from public press releases
--   - Models are real; exact list prices will be superseded by Slice 04
--     price sheet ingestion once the official ASV R1 2026 price book is uploaded.
--
-- All monetary values are in integer cents (CLAUDE.md convention).
-- model_year = 2026 (current model year at time of seeding).
-- workspace_id = 'default' (matches all seeded brands).
-- ============================================================================

insert into public.qb_equipment_models (
  brand_id,
  model_code,
  family,
  series,
  model_year,
  name_display,
  standard_config,
  list_price_cents,
  horsepower,
  specs,
  active
)
select
  b.id as brand_id,
  m.model_code,
  m.family,
  m.series,
  m.model_year,
  m.name_display,
  m.standard_config,
  m.list_price_cents,
  m.horsepower,
  m.specs,
  true as active
from public.qb_brands b
cross join (
  values
  -- model_code, family, series, model_year, name_display, standard_config,
  --   list_price_cents, horsepower, specs
  (
    'RT-40',
    'Compact Track Loader',
    'RT',
    2026,
    'ASV RT-40 Compact Track Loader',
    'Two-speed drive, 66-in bucket, deluxe cab with heat/AC, 74-in door opening',
    4750000,
    40,
    '{"rated_operating_capacity_lbs": 1100, "tipping_load_lbs": 2750, "operating_weight_lbs": 6200, "frame": "small"}'::jsonb
  ),
  (
    'RT-65',
    'Compact Track Loader',
    'RT',
    2026,
    'ASV RT-65 Compact Track Loader',
    'Two-speed drive, 72-in bucket, deluxe cab with heat/AC, 78-in door opening',
    7320000,
    65,
    '{"rated_operating_capacity_lbs": 1748, "tipping_load_lbs": 4995, "operating_weight_lbs": 9825, "frame": "large"}'::jsonb
  ),
  (
    'RT-85',
    'Compact Track Loader',
    'RT',
    2026,
    'ASV RT-85 Compact Track Loader',
    'Two-speed drive, 72-in bucket, deluxe cab, 78-in door opening, ride control standard',
    8895000,
    87,
    '{"rated_operating_capacity_lbs": 2274, "tipping_load_lbs": 6498, "operating_weight_lbs": 11000, "frame": "large"}'::jsonb
  ),
  (
    'RT-135',
    'Compact Track Loader',
    'RT',
    2026,
    'ASV RT-135 Compact Track Loader',
    'Two-speed drive, 84-in bucket, deluxe cab, ride control, 78-in door opening',
    10449500,
    132,
    '{"rated_operating_capacity_lbs": 3519, "tipping_load_lbs": 10055, "operating_weight_lbs": 14200, "frame": "large"}'::jsonb
  ),
  (
    'RT-175',
    'Compact Track Loader',
    'RT',
    2026,
    'ASV RT-175 Compact Track Loader',
    'Two-speed drive, 90-in bucket, deluxe cab, ride control, 84-in door opening, EH controls',
    15180000,
    168,
    '{"rated_operating_capacity_lbs": 4500, "tipping_load_lbs": 12860, "operating_weight_lbs": 17600, "frame": "large"}'::jsonb
  ),
  (
    'RT-220',
    'Compact Track Loader',
    'RT',
    2026,
    'ASV RT-220 Compact Track Loader',
    'Two-speed drive, 96-in bucket, deluxe cab, ride control, 84-in door opening, EH controls, high-flow hydraulics',
    19750000,
    220,
    '{"rated_operating_capacity_lbs": 5990, "tipping_load_lbs": 17100, "operating_weight_lbs": 22800, "frame": "large"}'::jsonb
  )
) as m (
  model_code,
  family,
  series,
  model_year,
  name_display,
  standard_config,
  list_price_cents,
  horsepower,
  specs
)
where b.code = 'ASV'
  -- Idempotent: skip if model already exists (e.g. re-run after price sheet ingestion)
on conflict (workspace_id, brand_id, model_code) do nothing;
