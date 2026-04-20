-- ============================================================================
-- Migration 310: Demo Construction Equipment Fleet
--
-- Broadens the Quote Builder demo catalog beyond the forestry-heavy seed in
-- migration 299. Adds a wheeled skid steer loader fleet (the core of the
-- "small construction" quoting motion), mainstream compact track loaders
-- from non-ASV manufacturers, mini/compact excavators, and telehandlers —
-- so demo searches for "skid steer", "Bobcat", "Kubota", "mini excavator",
-- "telehandler", etc. return real results and AI recommendations land on
-- models we actually price.
--
-- Prices are approximate 2025-2026 estimates derived from publicly available
-- dealer price book commentary and OEM spec sheets. They are intentionally
-- coarse — Slice 04 price sheet ingestion will supersede them once the
-- official OEM price books are uploaded to qb_price_sheets.
--
-- All monetary values are in integer cents (CLAUDE.md convention).
-- workspace_id defaults to 'default'.
-- Idempotent: re-runs skip existing brands and models.
-- ============================================================================

begin;

-- 1. Brands -------------------------------------------------------------------
insert into public.qb_brands
  (code, name, category, default_markup_pct, markup_floor_pct, dealer_discount_pct, tariff_pct)
values
  ('BOBCAT',      'Bobcat',      'construction', 0.1200, 0.1000, 0.2500, 0.0500),
  ('KUBOTA',      'Kubota',      'construction', 0.1200, 0.1000, 0.2500, 0.0500),
  ('CASE',        'Case',        'construction', 0.1200, 0.1000, 0.2000, 0.0500),
  ('NEW_HOLLAND', 'New Holland', 'construction', 0.1200, 0.1000, 0.2000, 0.0500),
  ('CAT',         'Caterpillar', 'construction', 0.1200, 0.1000, 0.2000, 0.0500),
  ('JOHN_DEERE',  'John Deere',  'construction', 0.1200, 0.1000, 0.2200, 0.0500),
  ('GEHL',        'Gehl',        'construction', 0.1200, 0.1000, 0.2000, 0.0500),
  ('TAKEUCHI',    'Takeuchi',    'construction', 0.1200, 0.1000, 0.2000, 0.0500),
  ('JCB',         'JCB',         'construction', 0.1200, 0.1000, 0.2000, 0.0500),
  ('GENIE',       'Genie',       'construction', 0.1200, 0.1000, 0.2000, 0.0500)
on conflict (workspace_id, code) do nothing;

-- 2. Models -------------------------------------------------------------------
with model_data (brand_code, model_code, family, series, model_year, name_display, standard_config, list_price_cents, horsepower, specs) as (
  values
  -- ─── Wheeled Skid Steer Loaders ─────────────────────────────────────────
  ('BOBCAT', 'S62', 'Skid Steer Loader', 'S', 2026,
    'Bobcat S62 Skid Steer Loader',
    'Radial lift, 66-in bucket, enclosed cab with heat, 2-speed travel',
    5200000, 68,
    '{"rated_operating_capacity_lbs": 2000, "operating_weight_lbs": 6985, "lift_type": "radial", "frame": "medium"}'),
  ('BOBCAT', 'S66', 'Skid Steer Loader', 'S', 2026,
    'Bobcat S66 Skid Steer Loader',
    'Vertical lift, 68-in bucket, deluxe cab with heat/AC, 2-speed travel',
    5800000, 74,
    '{"rated_operating_capacity_lbs": 2200, "operating_weight_lbs": 7458, "lift_type": "vertical", "frame": "medium"}'),
  ('BOBCAT', 'S76', 'Skid Steer Loader', 'S', 2026,
    'Bobcat S76 Skid Steer Loader',
    'Vertical lift, 72-in bucket, deluxe cab with heat/AC, high-flow option',
    6300000, 74,
    '{"rated_operating_capacity_lbs": 3000, "operating_weight_lbs": 8415, "lift_type": "vertical", "frame": "large"}'),
  ('BOBCAT', 'S86', 'Skid Steer Loader', 'S', 2026,
    'Bobcat S86 Skid Steer Loader',
    'Vertical lift, 80-in bucket, deluxe cab, high-flow hydraulics standard',
    6800000, 74,
    '{"rated_operating_capacity_lbs": 3450, "operating_weight_lbs": 9539, "lift_type": "vertical", "frame": "large"}'),

  ('KUBOTA', 'SSV65', 'Skid Steer Loader', 'SSV', 2026,
    'Kubota SSV65 Skid Steer Loader',
    'Vertical lift, 68-in bucket, deluxe cab with heat/AC, 2-speed travel',
    5600000, 64,
    '{"rated_operating_capacity_lbs": 1950, "operating_weight_lbs": 8160, "lift_type": "vertical", "frame": "medium"}'),
  ('KUBOTA', 'SSV75', 'Skid Steer Loader', 'SSV', 2026,
    'Kubota SSV75 Skid Steer Loader',
    'Vertical lift, 72-in bucket, deluxe cab, high-flow hydraulics, 2-speed travel',
    6200000, 74,
    '{"rated_operating_capacity_lbs": 2690, "operating_weight_lbs": 8600, "lift_type": "vertical", "frame": "large"}'),

  ('CASE', 'SR175', 'Skid Steer Loader', 'SR', 2026,
    'Case SR175 Skid Steer Loader',
    'Radial lift, 66-in bucket, enclosed cab with heat, standard-flow hydraulics',
    4700000, 60,
    '{"rated_operating_capacity_lbs": 1750, "operating_weight_lbs": 6985, "lift_type": "radial", "frame": "small"}'),
  ('CASE', 'SR210B', 'Skid Steer Loader', 'SR', 2026,
    'Case SR210B Skid Steer Loader',
    'Radial lift, 68-in bucket, deluxe cab with heat/AC, 2-speed travel',
    5500000, 74,
    '{"rated_operating_capacity_lbs": 2100, "operating_weight_lbs": 7600, "lift_type": "radial", "frame": "medium"}'),
  ('CASE', 'SR270B', 'Skid Steer Loader', 'SR', 2026,
    'Case SR270B Skid Steer Loader',
    'Radial lift, 72-in bucket, deluxe cab, high-flow hydraulics, 2-speed',
    6800000, 90,
    '{"rated_operating_capacity_lbs": 2700, "operating_weight_lbs": 8690, "lift_type": "radial", "frame": "large"}'),

  ('NEW_HOLLAND', 'L220', 'Skid Steer Loader', 'L', 2026,
    'New Holland L220 Skid Steer Loader',
    'Vertical lift, 66-in bucket, enclosed cab with heat, standard-flow',
    4700000, 60,
    '{"rated_operating_capacity_lbs": 2200, "operating_weight_lbs": 6988, "lift_type": "vertical", "frame": "medium"}'),
  ('NEW_HOLLAND', 'L228', 'Skid Steer Loader', 'L', 2026,
    'New Holland L228 Skid Steer Loader',
    'Vertical lift, 68-in bucket, deluxe cab with heat/AC, 2-speed travel',
    5500000, 74,
    '{"rated_operating_capacity_lbs": 2800, "operating_weight_lbs": 7940, "lift_type": "vertical", "frame": "large"}'),
  ('NEW_HOLLAND', 'L234', 'Skid Steer Loader', 'L', 2026,
    'New Holland L234 Skid Steer Loader',
    'Vertical lift, 72-in bucket, deluxe cab, high-flow hydraulics',
    6200000, 90,
    '{"rated_operating_capacity_lbs": 3400, "operating_weight_lbs": 9050, "lift_type": "vertical", "frame": "large"}'),

  ('CAT', '232D3', 'Skid Steer Loader', 'D3', 2026,
    'Caterpillar 232D3 Skid Steer Loader',
    'Radial lift, 66-in bucket, deluxe cab with heat/AC, 2-speed travel',
    4900000, 67,
    '{"rated_operating_capacity_lbs": 1950, "operating_weight_lbs": 6895, "lift_type": "radial", "frame": "small"}'),
  ('CAT', '242D3', 'Skid Steer Loader', 'D3', 2026,
    'Caterpillar 242D3 Skid Steer Loader',
    'Vertical lift, 68-in bucket, deluxe cab with heat/AC, 2-speed travel',
    5700000, 74,
    '{"rated_operating_capacity_lbs": 2350, "operating_weight_lbs": 7450, "lift_type": "vertical", "frame": "medium"}'),
  ('CAT', '262D3', 'Skid Steer Loader', 'D3', 2026,
    'Caterpillar 262D3 Skid Steer Loader',
    'Vertical lift, 72-in bucket, deluxe cab, high-flow hydraulics',
    6000000, 74,
    '{"rated_operating_capacity_lbs": 2700, "operating_weight_lbs": 8405, "lift_type": "vertical", "frame": "large"}'),
  ('CAT', '272D3', 'Skid Steer Loader', 'D3', 2026,
    'Caterpillar 272D3 Skid Steer Loader',
    'Vertical lift, 74-in bucket, deluxe cab, XHP high-flow, 2-speed',
    6600000, 98,
    '{"rated_operating_capacity_lbs": 3400, "operating_weight_lbs": 9700, "lift_type": "vertical", "frame": "large"}'),

  ('JOHN_DEERE', '318G', 'Skid Steer Loader', 'G', 2026,
    'John Deere 318G Skid Steer Loader',
    'Vertical lift, 66-in bucket, enclosed cab with heat, standard-flow',
    5000000, 66,
    '{"rated_operating_capacity_lbs": 1800, "operating_weight_lbs": 7276, "lift_type": "vertical", "frame": "medium"}'),
  ('JOHN_DEERE', '330G', 'Skid Steer Loader', 'G', 2026,
    'John Deere 330G Skid Steer Loader',
    'Vertical lift, 72-in bucket, deluxe cab with heat/AC, 2-speed travel',
    6600000, 100,
    '{"rated_operating_capacity_lbs": 3000, "operating_weight_lbs": 9138, "lift_type": "vertical", "frame": "large"}'),
  ('JOHN_DEERE', '332G', 'Skid Steer Loader', 'G', 2026,
    'John Deere 332G Skid Steer Loader',
    'Vertical lift, 74-in bucket, deluxe cab, high-flow hydraulics, EH controls',
    7000000, 100,
    '{"rated_operating_capacity_lbs": 3600, "operating_weight_lbs": 9622, "lift_type": "vertical", "frame": "large"}'),

  ('GEHL', 'R220', 'Skid Steer Loader', 'R', 2026,
    'Gehl R220 Skid Steer Loader',
    'Vertical lift, 68-in bucket, enclosed cab with heat, 2-speed travel',
    5400000, 69,
    '{"rated_operating_capacity_lbs": 2200, "operating_weight_lbs": 7450, "lift_type": "vertical", "frame": "medium"}'),
  ('GEHL', 'R260', 'Skid Steer Loader', 'R', 2026,
    'Gehl R260 Skid Steer Loader',
    'Vertical lift, 72-in bucket, deluxe cab, high-flow hydraulics',
    5800000, 69,
    '{"rated_operating_capacity_lbs": 2600, "operating_weight_lbs": 7820, "lift_type": "vertical", "frame": "large"}'),

  ('TAKEUCHI', 'TS70R2', 'Skid Steer Loader', 'TS', 2026,
    'Takeuchi TS70R2 Skid Steer Loader',
    'Radial lift, 68-in bucket, deluxe cab with heat/AC, 2-speed travel',
    5200000, 66,
    '{"rated_operating_capacity_lbs": 2000, "operating_weight_lbs": 7275, "lift_type": "radial", "frame": "medium"}'),

  -- ─── Compact Track Loaders (mainstream non-ASV) ─────────────────────────
  ('BOBCAT', 'T66', 'Compact Track Loader', 'T', 2026,
    'Bobcat T66 Compact Track Loader',
    'Vertical lift, 72-in bucket, deluxe cab with heat/AC, 2-speed travel',
    6200000, 74,
    '{"rated_operating_capacity_lbs": 2400, "operating_weight_lbs": 9253, "lift_type": "vertical", "frame": "medium"}'),
  ('BOBCAT', 'T76', 'Compact Track Loader', 'T', 2026,
    'Bobcat T76 Compact Track Loader',
    'Vertical lift, 74-in bucket, deluxe cab, high-flow hydraulics',
    6700000, 74,
    '{"rated_operating_capacity_lbs": 3400, "operating_weight_lbs": 10306, "lift_type": "vertical", "frame": "large"}'),
  ('BOBCAT', 'T86', 'Compact Track Loader', 'T', 2026,
    'Bobcat T86 Compact Track Loader',
    'Vertical lift, 80-in bucket, deluxe cab, super high-flow hydraulics',
    7500000, 74,
    '{"rated_operating_capacity_lbs": 3875, "operating_weight_lbs": 11325, "lift_type": "vertical", "frame": "large"}'),

  ('KUBOTA', 'SVL75-3', 'Compact Track Loader', 'SVL', 2026,
    'Kubota SVL75-3 Compact Track Loader',
    'Vertical lift, 72-in bucket, deluxe cab with heat/AC, 2-speed travel',
    6400000, 74,
    '{"rated_operating_capacity_lbs": 2690, "operating_weight_lbs": 9392, "lift_type": "vertical", "frame": "medium"}'),
  ('KUBOTA', 'SVL97-2', 'Compact Track Loader', 'SVL', 2026,
    'Kubota SVL97-2 Compact Track Loader',
    'Vertical lift, 84-in bucket, deluxe cab, high-flow hydraulics',
    8200000, 96,
    '{"rated_operating_capacity_lbs": 3200, "operating_weight_lbs": 11574, "lift_type": "vertical", "frame": "large"}'),

  ('CAT', '259D3', 'Compact Track Loader', 'D3', 2026,
    'Caterpillar 259D3 Compact Track Loader',
    'Vertical lift, 66-in bucket, deluxe cab with heat/AC, 2-speed travel',
    6500000, 74,
    '{"rated_operating_capacity_lbs": 2450, "operating_weight_lbs": 9052, "lift_type": "vertical", "frame": "medium"}'),
  ('CAT', '279D3', 'Compact Track Loader', 'D3', 2026,
    'Caterpillar 279D3 Compact Track Loader',
    'Vertical lift, 72-in bucket, deluxe cab, high-flow hydraulics',
    7500000, 74,
    '{"rated_operating_capacity_lbs": 3150, "operating_weight_lbs": 10174, "lift_type": "vertical", "frame": "large"}'),
  ('CAT', '299D3', 'Compact Track Loader', 'D3', 2026,
    'Caterpillar 299D3 Compact Track Loader',
    'Vertical lift, 84-in bucket, deluxe cab, XHP high-flow, EH controls',
    9500000, 110,
    '{"rated_operating_capacity_lbs": 4300, "operating_weight_lbs": 11942, "lift_type": "vertical", "frame": "large"}'),

  ('JOHN_DEERE', '325G', 'Compact Track Loader', 'G', 2026,
    'John Deere 325G Compact Track Loader',
    'Vertical lift, 72-in bucket, deluxe cab with heat/AC, 2-speed travel',
    7000000, 74,
    '{"rated_operating_capacity_lbs": 2700, "operating_weight_lbs": 10250, "lift_type": "vertical", "frame": "medium"}'),
  ('JOHN_DEERE', '333G', 'Compact Track Loader', 'G', 2026,
    'John Deere 333G Compact Track Loader',
    'Vertical lift, 84-in bucket, deluxe cab, high-flow hydraulics, EH controls',
    8500000, 100,
    '{"rated_operating_capacity_lbs": 3700, "operating_weight_lbs": 11534, "lift_type": "vertical", "frame": "large"}'),

  ('TAKEUCHI', 'TL10V2', 'Compact Track Loader', 'TL', 2026,
    'Takeuchi TL10V2 Compact Track Loader',
    'Vertical lift, 84-in bucket, deluxe cab, high-flow hydraulics',
    8200000, 96,
    '{"rated_operating_capacity_lbs": 3300, "operating_weight_lbs": 11520, "lift_type": "vertical", "frame": "large"}'),

  -- ─── Mini / Compact Excavators ──────────────────────────────────────────
  ('BOBCAT', 'E35', 'Mini Excavator', 'E', 2026,
    'Bobcat E35 Mini Excavator',
    'Enclosed cab with heat/AC, retractable undercarriage, 24-in bucket',
    5800000, 25,
    '{"operating_weight_lbs": 7716, "dig_depth_in": 123, "bucket_breakout_lbs": 6345}'),
  ('BOBCAT', 'E85', 'Compact Excavator', 'E', 2026,
    'Bobcat E85 Compact Excavator',
    'Enclosed cab with heat/AC, angle blade, 30-in bucket, auxiliary hydraulics',
    10500000, 65,
    '{"operating_weight_lbs": 19040, "dig_depth_in": 174, "bucket_breakout_lbs": 12600}'),

  ('KUBOTA', 'U27-4', 'Mini Excavator', 'U', 2026,
    'Kubota U27-4 Mini Excavator',
    'Enclosed cab with heat/AC, zero-tail-swing, 18-in bucket',
    4800000, 20,
    '{"operating_weight_lbs": 6160, "dig_depth_in": 107, "bucket_breakout_lbs": 5379}'),
  ('KUBOTA', 'U55-4', 'Mini Excavator', 'U', 2026,
    'Kubota U55-4 Mini Excavator',
    'Enclosed cab with heat/AC, zero-tail-swing, 24-in bucket, angle blade',
    7500000, 47,
    '{"operating_weight_lbs": 12125, "dig_depth_in": 149, "bucket_breakout_lbs": 9175}'),
  ('KUBOTA', 'KX040-4', 'Mini Excavator', 'KX', 2026,
    'Kubota KX040-4 Mini Excavator',
    'Enclosed cab with heat/AC, 20-in bucket, auxiliary hydraulics',
    6500000, 40,
    '{"operating_weight_lbs": 8847, "dig_depth_in": 131, "bucket_breakout_lbs": 7650}'),

  ('JOHN_DEERE', '35G', 'Mini Excavator', 'G', 2026,
    'John Deere 35G Mini Excavator',
    'Enclosed cab with heat/AC, 24-in bucket, retractable undercarriage',
    6000000, 25,
    '{"operating_weight_lbs": 8154, "dig_depth_in": 124, "bucket_breakout_lbs": 6580}'),
  ('JOHN_DEERE', '60G', 'Mini Excavator', 'G', 2026,
    'John Deere 60G Mini Excavator',
    'Enclosed cab with heat/AC, 24-in bucket, auxiliary hydraulics, angle blade',
    9500000, 53,
    '{"operating_weight_lbs": 13232, "dig_depth_in": 152, "bucket_breakout_lbs": 9566}'),

  ('CAT', '305.5E2', 'Mini Excavator', 'E2', 2026,
    'Caterpillar 305.5E2 Mini Excavator',
    'Enclosed cab with heat/AC, 24-in bucket, angle blade, auxiliary hydraulics',
    7800000, 45,
    '{"operating_weight_lbs": 12570, "dig_depth_in": 142, "bucket_breakout_lbs": 8730}'),
  ('CAT', '308CR', 'Compact Excavator', 'CR', 2026,
    'Caterpillar 308 CR Compact Excavator',
    'Enclosed cab with heat/AC, 30-in bucket, zero-tail-swing, angle blade',
    9800000, 65,
    '{"operating_weight_lbs": 18300, "dig_depth_in": 170, "bucket_breakout_lbs": 11600}'),

  -- ─── Telehandlers ───────────────────────────────────────────────────────
  ('JCB', '507-42', 'Telehandler', '500', 2026,
    'JCB 507-42 Telehandler',
    'Enclosed cab with heat/AC, 48-in carriage, auxiliary hydraulics',
    12500000, 74,
    '{"max_lift_capacity_lbs": 7000, "max_lift_height_ft": 42, "max_forward_reach_ft": 27}'),
  ('GENIE', 'GTH-844', 'Telehandler', 'GTH', 2026,
    'Genie GTH-844 Telehandler',
    'Enclosed cab with heat/AC, 48-in carriage, frame-leveling, auxiliary hydraulics',
    14000000, 74,
    '{"max_lift_capacity_lbs": 8000, "max_lift_height_ft": 44, "max_forward_reach_ft": 29}'),
  ('BOBCAT', 'TL723', 'Telehandler', 'TL', 2026,
    'Bobcat TL723 Telehandler',
    'Enclosed cab with heat/AC, 48-in carriage, 2-speed travel',
    11800000, 100,
    '{"max_lift_capacity_lbs": 7000, "max_lift_height_ft": 23, "max_forward_reach_ft": 15}'),
  ('CAT', 'TH408D', 'Telehandler', 'D', 2026,
    'Caterpillar TH408D Telehandler',
    'Enclosed cab with heat/AC, 48-in carriage, frame-leveling, aux hydraulics',
    14500000, 74,
    '{"max_lift_capacity_lbs": 8000, "max_lift_height_ft": 44, "max_forward_reach_ft": 30}')
)
insert into public.qb_equipment_models
  (brand_id, model_code, family, series, model_year, name_display, standard_config, list_price_cents, horsepower, specs, active)
select
  b.id,
  m.model_code,
  m.family,
  m.series,
  m.model_year,
  m.name_display,
  m.standard_config,
  m.list_price_cents,
  m.horsepower,
  m.specs::jsonb,
  true as active
from model_data m
join public.qb_brands b on b.code = m.brand_code
on conflict (workspace_id, brand_id, model_code) do nothing;

commit;
