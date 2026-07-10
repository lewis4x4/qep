# QB-ORCHESTRATOR-CHUNK-DECOMPOSITION — performance evidence

Date: 2026-07-09

## Result

- Baseline `QuoteBuilderV2Page`: 495,224 raw bytes / 131,858 gzip bytes.
- Current `QuoteBuilderV2Page-B6sslCpZ.js`: 144,319 raw bytes / 45,827 gzip bytes.
- Raw route reduction: 350,905 bytes (70.86%).
- The `QuoteBuilderV2Page-` exemption was removed from
  `apps/web/bundle-size-limits.json`; no replacement exemption was added.
- `bun run bundle:check` measured 615 non-exempt route chunks at or below the
  150,000-byte cap and passed.

## Real interaction boundaries

The route now defers code at boundaries the operator actually crosses:

- desktop shell: `QuoteBuilderDesktopViewHost-*` — 22,767 raw bytes;
- mobile shell: `QuoteBuilderMobileViewHost-*` — 11,629 raw bytes;
- wizard router/step graph: `QuoteWizardStepRouter-*` — 115,238 raw bytes,
  with individual step chunks loaded on entry;
- printable PDF fallback: `quote-print-html-*` — 23,652 raw bytes, loaded only
  if the PDF renderer fails;
- the existing intelligence-panel host remains lazy.

This preserves shared orchestrator state while preventing both device shells,
all step implementations, and fallback print markup from entering the initial
route chunk. No data-fetching hook was moved behind a serial UI waterfall.

## Local browser smoke

An authenticated temporary rep fixture exercised the local production-shaped
app against the configured backend. The fixture auth user was deleted after the
run (HTTP 200 cleanup).

- Mobile 375 x 812: Quote Builder rendered the mobile shell, customer step,
  fixed actions, and Sales navigation without horizontal overflow.
- Desktop 1440 x 960: switching the same mounted route loaded the desktop host,
  preserved Step 1 state, and rendered without horizontal overflow.
- Cached responsive host transitions measured 90 ms (desktop to mobile) and
  70 ms (mobile to desktop) in the local in-app browser.
- The route's accessible `Quote Builder` heading and `Step 1: Choose the
  customer` heading were present in both device modes.

These local transition numbers are regression evidence, not a production RUM
claim. Production network latency remains observable through the existing
telemetry after deployment.

## Focused validation

- clean `apps/web` production build: passed;
- strict bundle guard: passed;
- bundle decomposition contract tests: 3 passed;
- Quote Builder status warning tests: 2 passed;
- desktop shell focused test: 1 passed;
- mobile shell focused tests: 7 passed.
