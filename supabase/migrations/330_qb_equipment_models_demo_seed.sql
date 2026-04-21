-- 330_qb_equipment_models_demo_seed.sql
-- Seed a realistic QEP dealer model catalog so Quote Builder's Search Catalog
-- and the AI Deal Scenarios engine have data to work with across all 13 brands
-- in qb_brands. Prior to this migration only 6 ASV track loaders were seeded.
--
-- Idempotent: uses ON CONFLICT (workspace_id, brand_id, model_code) DO NOTHING,
-- so running migration re-plays leave existing rows untouched. Model_year 2026.
-- list_price_cents are realistic dealer-list figures as of early 2026 and are
-- rounded to the nearest $500.

insert into public.qb_equipment_models
  (workspace_id, brand_id, model_code, family, series, model_year,
   name_display, list_price_cents, horsepower, active)
select 'default', b.id, m.model_code, m.family, m.series, 2026,
       m.name_display, m.list_price_cents, m.horsepower, true
from (values
  -- ── Develon (construction: excavators + wheel loaders) ──────────────────────
  ('DEVELON', 'DX63-5',   'Mini Excavator',         'DX', 'Develon DX63-5 Mini Excavator',              7495000,  65),
  ('DEVELON', 'DX225LC-7','Crawler Excavator',      'DX', 'Develon DX225LC-7 Crawler Excavator',       25800000, 168),
  ('DEVELON', 'DX300LC-7','Crawler Excavator',      'DX', 'Develon DX300LC-7 Crawler Excavator',       34250000, 237),
  ('DEVELON', 'DX350LC-7','Crawler Excavator',      'DX', 'Develon DX350LC-7 Crawler Excavator',       39800000, 271),
  ('DEVELON', 'DL280-7',  'Wheel Loader',           'DL', 'Develon DL280-7 Wheel Loader',              29500000, 221),
  -- ── Yanmar (construction: compact excavators + track loaders) ───────────────
  ('YANMAR', 'ViO35-6A', 'Compact Excavator',       'ViO','Yanmar ViO35-6A Compact Excavator',          6250000,  39),
  ('YANMAR', 'ViO55-6A', 'Compact Excavator',       'ViO','Yanmar ViO55-6A Compact Excavator',          8950000,  48),
  ('YANMAR', 'SV100-7',  'Mid-Size Excavator',      'SV', 'Yanmar SV100-7 Mid-Size Excavator',         13250000,  74),
  ('YANMAR', 'T80',      'Compact Track Loader',    'T',  'Yanmar T80 Compact Track Loader',            7850000,  74),
  -- ── Bandit (forestry: chippers + stump grinders) ────────────────────────────
  ('BANDIT', '12XP',   'Wood Chipper',              '12', 'Bandit 12XP Wood Chipper',                   5750000, 110),
  ('BANDIT', '19XP',   'Wood Chipper',              '19', 'Bandit 19XP Wood Chipper',                   8950000, 175),
  ('BANDIT', '2900T',  'Whole-Tree Chipper',        '29', 'Bandit 2900T Whole-Tree Chipper',           29500000, 540),
  ('BANDIT', '2150XP', 'Stump Grinder',             '21', 'Bandit 2150XP Stump Grinder',                8400000, 150),
  -- ── Barko (forestry: knuckleboom + track loaders) ──────────────────────────
  ('BARKO', '295B',  'Knuckleboom Loader',          '29', 'Barko 295B Knuckleboom Loader',             22500000, 173),
  ('BARKO', '495ML', 'Mulching Tractor',            '49', 'Barko 495ML Mulching Tractor',              46750000, 275),
  ('BARKO', '775B',  'Industrial Wheel Loader',     '77', 'Barko 775B Industrial Wheel Loader',        58900000, 330),
  -- ── Denis Cimaf (forestry: mulcher heads — sold as attachments) ─────────────
  ('DENIS_CIMAF', 'DAH-200', 'Mulcher Head',        'DAH','Denis Cimaf DAH-200 Mulcher Head',           3250000, null),
  ('DENIS_CIMAF', 'DAH-225', 'Mulcher Head',        'DAH','Denis Cimaf DAH-225 Mulcher Head',           3850000, null),
  ('DENIS_CIMAF', 'DAH-250', 'Mulcher Head',        'DAH','Denis Cimaf DAH-250 Mulcher Head',           4450000, null),
  -- ── Lamtrac (forestry: mulching tractors) ───────────────────────────────────
  ('LAMTRAC', 'LTR5160', 'Mulching Tractor',        'LTR','Lamtrac LTR5160 Mulching Tractor',          48500000, 215),
  ('LAMTRAC', 'LTR6140', 'Mulching Tractor',        'LTR','Lamtrac LTR6140 Mulching Tractor',          55750000, 310),
  ('LAMTRAC', 'LTR6160', 'Mulching Tractor',        'LTR','Lamtrac LTR6160 Mulching Tractor',          62250000, 365),
  -- ── Prinoth (forestry: tracked carriers + mulchers) ─────────────────────────
  ('PRINOTH', 'PANTHER-T14R', 'Tracked Carrier',    'Panther','Prinoth Panther T14R Tracked Carrier',  39750000, 380),
  ('PRINOTH', 'PANTHER-T16',  'Tracked Carrier',    'Panther','Prinoth Panther T16 Tracked Carrier',   48200000, 430),
  ('PRINOTH', 'RAPTOR-500',   'Mulching Tractor',   'Raptor', 'Prinoth Raptor 500 Mulching Tractor',   72500000, 500),
  -- ── Shearex (forestry: mulcher heads) ───────────────────────────────────────
  ('SHEAREX', 'TRX160', 'Mulcher Head',             'TRX','Shearex TRX160 Mulcher Head',                2950000, null),
  ('SHEAREX', 'TRX260', 'Mulcher Head',             'TRX','Shearex TRX260 Mulcher Head',                4150000, null),
  -- ── Supertrak (forestry: mulching carriers) ─────────────────────────────────
  ('SUPERTRAK', 'SK140TR', 'Mulching Carrier',      'SK', 'Supertrak SK140TR Mulching Carrier',        42500000, 260),
  ('SUPERTRAK', 'SK200TR', 'Mulching Carrier',      'SK', 'Supertrak SK200TR Mulching Carrier',        58750000, 370),
  -- ── CMI (other: tub grinders) ───────────────────────────────────────────────
  ('CMI', 'C175E', 'Tub Grinder',                   'C',  'CMI C175E Tub Grinder',                     38500000, 540),
  ('CMI', 'C300E', 'Tub Grinder',                   'C',  'CMI C300E Tub Grinder',                     58500000, 800),
  -- ── Diamond Z (other: horizontal & tub grinders) ───────────────────────────
  ('DIAMOND_Z', 'DZH6000TKT', 'Horizontal Grinder', 'DZH','Diamond Z DZH6000TKT Horizontal Grinder',   78500000, 765),
  ('DIAMOND_Z', 'DZT5400',    'Tub Grinder',        'DZT','Diamond Z DZT5400 Tub Grinder',             51250000, 540),
  -- ── Serco (other: log loaders) ──────────────────────────────────────────────
  ('SERCO', '7000', 'Log Loader',                   '7',  'Serco 7000 Log Loader',                     28750000, 173),
  ('SERCO', '160',  'Knuckleboom Log Loader',       '1',  'Serco 160 Knuckleboom Log Loader',          19250000, 115)
) AS m(brand_code, model_code, family, series, name_display, list_price_cents, horsepower)
join public.qb_brands b
  on b.code = m.brand_code and b.workspace_id = 'default'
on conflict (workspace_id, brand_id, model_code) do nothing;
