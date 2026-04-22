# QEP Phase 9 Data Miner Equivalents Ship Report

**Date:** 2026-04-22  
**Phase:** `Phase-9_Advanced-Intelligence`  
**Gap Register row:** `18`  
**Gap:** Data Miner reports don't have 1:1 QEP analog; QEP has different BI approach.

## Scope Closed

- Added QEP-native read views that replace the legacy Data Miner utility with curated management report packs
- Added a dedicated management route at `/executive/data-miner`
- Added three live report families:
  - customer profitability
  - A/R exposure and credit-block analysis
  - service labor throughput
- Added owner-dashboard and Operating System Hub entry points into the report center
- Reframed the parity target as curated equivalents instead of a legacy ad hoc query builder

## Files Changed

- `supabase/migrations/355_owner_data_miner_equivalents.sql`
- `apps/web/src/features/owner/lib/data-miner-utils.ts`
- `apps/web/src/features/owner/lib/data-miner-utils.test.ts`
- `apps/web/src/features/owner/pages/DataMinerEquivalentsPage.tsx`
- `apps/web/src/features/owner/pages/__tests__/DataMinerEquivalentsPage.integration.test.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/features/owner/pages/OwnerDashboardPage.tsx`
- `apps/web/src/features/dashboards/pages/OperatingSystemHubPage.tsx`

## Primary Evidence

- Workbook source: `/Users/brianlewis/Desktop/IntelliDealer/_Manifests/QEP_Parity_Worksheet.xlsx`
  - `Gap Register` row `18`
- IntelliDealer source evidence:
  - `/Users/brianlewis/Desktop/IntelliDealer/Phase-5_Deal-Genome/Data Miner.pdf`
  - `/Users/brianlewis/Desktop/IntelliDealer/Phase-5_Deal-Genome/Analysis-Reports__3.19.39.png`
  - `/Users/brianlewis/Desktop/IntelliDealer/Phase-5_Deal-Genome/Profitability-Analysis__3.25.42.png`
  - `/Users/brianlewis/Desktop/IntelliDealer/Phase-5_Deal-Genome/Credit-Limit-Analysis__3.26.20.png`
  - `/Users/brianlewis/Desktop/IntelliDealer/_OCR/Phase-5_Deal-Genome/Data Miner.txt`
- Segment gate artifact:
  - `/Users/brianlewis/Projects/qep-knowledge-assistant-qb-gl/test-results/agent-gates/20260422T140931Z-phase9-data-miner.json`

## Verification

- file-level TypeScript diagnostics on:
  - `apps/web/src/features/owner/pages/DataMinerEquivalentsPage.tsx`
  - `apps/web/src/features/owner/lib/data-miner-utils.ts`
  - `apps/web/src/features/owner/pages/__tests__/DataMinerEquivalentsPage.integration.test.tsx`
  - `apps/web/src/App.tsx`
  - `apps/web/src/features/owner/pages/OwnerDashboardPage.tsx`
  - `apps/web/src/features/dashboards/pages/OperatingSystemHubPage.tsx`
- `bun test apps/web/src/features/owner/lib/data-miner-utils.test.ts apps/web/src/features/owner/pages/__tests__/DataMinerEquivalentsPage.integration.test.tsx`
- `bun run build`
- `bun run segment:gates --segment phase9-data-miner --ui`

## Deployment

- `supabase db push`
- `supabase migration list`

## Equivalent Mapping

- IntelliDealer Data Miner utility:
  - replaced by a curated QEP management report center
- IntelliDealer profitability analysis:
  - replaced by closed-won QRM deal profitability leaderboard
- IntelliDealer credit-limit analysis:
  - replaced by QEP A/R exposure plus AR block workflow visibility
- IntelliDealer service analysis reports:
  - replaced by service timecard and linked work-order labor rollups

## Remaining Backlog After This Slice

- manual / external blockers:
  - row `2` VitalEdge / IntelliDealer API access
  - row `3` HubSpot API key
  - row `4` QuickBooks credentials and account mapping
  - row `5` technician field UAT
  - row `12` Traffic Management scope decision
  - row `20` IronGuides contract dependency
