# QEP E2.1 UI Brand-Guide Compliance Audit

Roadmap item: E2.1 / QEP-124  
Audit date: 2026-05-21  
Status: Complete audit baseline; remediation queue opened below

## Evidence source

- Canonical roadmap evidence path: `docs/qep_brand_guide.pdf`
- Tracked source artifact: `docs/Brand Guide QEP.pdf`
- App brand token source: `apps/web/src/index.css`
- Tailwind token bridge: `apps/web/tailwind.config.js`
- Verification command: `bun run brand:guide:audit`

`docs/qep_brand_guide.pdf` is a tracked canonical alias to the existing QEP brand guide artifact so the roadmap evidence key is stable without duplicating a binary PDF.

## Audit rule

Every production UI surface must either:

1. use QEP semantic/tailwind tokens from `apps/web/src/index.css` and `apps/web/tailwind.config.js`, or
2. be recorded here as a raw-color/experience exception requiring follow-up remediation.

The audit covers production `.tsx` and `.css` files under `apps/web/src`, excluding test/spec files.

## Surface inventory

### Customer-facing surfaces

Validated surface class: login, customer/portal flows, quote builder/list, sales routes, service/parts/rental showcase surfaces, customer intelligence, voice quote, and public/customer-facing shell components.

Key anchors:

- `apps/web/src/components/LoginPage.tsx`
- `apps/web/src/features/portal/PortalRoutes.tsx`
- `apps/web/src/features/portal/pages/*`
- `apps/web/src/features/quote-builder/pages/*`
- `apps/web/src/features/quote-builder/components/*`
- `apps/web/src/features/sales/SalesRoutes.tsx`
- `apps/web/src/features/service/pages/*`
- `apps/web/src/features/parts/pages/*`
- `apps/web/src/components/CustomerIntelligenceShowcase.tsx`
- `apps/web/src/components/RentalLabShowcase.tsx`
- `apps/web/src/components/LogisticsShowcase.tsx`

Verdict: Brand tokens exist and are wired, but several customer-facing showcase/login surfaces still use hardcoded hex palettes and should be normalized in a remediation slice.

### Operational surfaces

Validated surface class: floor, QRM, owner, deal-room, service ops, parts ops, sales ops, dashboards, and role shells.

Key anchors:

- `apps/web/src/features/floor/pages/*`
- `apps/web/src/features/floor/widgets/*`
- `apps/web/src/features/qrm/pages/*`
- `apps/web/src/features/qrm/command-center/*`
- `apps/web/src/features/owner/pages/*`
- `apps/web/src/features/deal-room/pages/*`
- `apps/web/src/features/dashboards/pages/*`
- `apps/web/src/components/NavRail.tsx`
- `apps/web/src/components/TopBar.tsx`

Verdict: Operational command-deck tokens are centralized in `index.css`, but shell-level hardcoded slate/white hover colors remain in `NavRail.tsx` and `TopBar.tsx`.

### Admin/internal surfaces

Validated surface class: admin pages/components, integration hub, users/workspace management, document/admin routes, and internal setup flows.

Key anchors:

- `apps/web/src/features/admin/pages/*`
- `apps/web/src/features/admin/components/*`
- `apps/web/src/components/AdminPage.tsx`
- `apps/web/src/components/IntegrationHub.tsx`
- `apps/web/src/components/IntegrationCard.tsx`
- `apps/web/src/components/UsersTab.tsx`
- `apps/web/src/components/WorkspaceSwitcher.tsx`

Verdict: Admin/internal surfaces mostly consume shared UI primitives, but isolated hardcoded border/background colors still exist and should be tokenized opportunistically.

### Shared shell/component surfaces

Validated surface class: app shell, reusable primitives, UI components, Iron assistant shell, voice components, and global CSS.

Key anchors:

- `apps/web/src/App.tsx`
- `apps/web/src/index.css`
- `apps/web/src/components/ui/*`
- `apps/web/src/components/primitives/*`
- `apps/web/src/lib/iron/*`
- `apps/web/src/components/BrandLogo.tsx`

Verdict: The shared token system is present and should remain the source of truth for future remediation. Raw canvas/screenshot colors in Flare are acceptable operational exceptions only if they stay isolated to annotation/capture tooling.

## Brand token baseline

Current source-controlled token anchors include:

- QEP orange: `--qep-orange`
- Accessible orange: `--qep-orange-accessible`
- Dark navy: `--qep-dark`
- Charcoal: `--qep-charcoal`
- Slate/gray/light-gray: `--qep-slate`, `--qep-gray`, `--qep-light-gray`
- Warm app background: `--qep-bg`
- Operational signal colors: `--qep-live`, `--qep-hot`, `--qep-warm`, `--qep-cold`

Tailwind exposes these via `qep-*` color utilities in `apps/web/tailwind.config.js`.

## Raw color exceptions

The audit does not claim all raw colors are resolved. It records the current risk queue so the next build slice can remediate without rediscovery.

Static verifier results:

- UI files scanned: 682
- Surface files inventoried: 594
- Customer-facing surfaces: 140
- Operational surfaces: 212
- Admin/internal surfaces: 48
- Shared shell/component surfaces: 194
- Raw hex color occurrences: 1,309

Highest-priority raw-color clusters found during audit:

1. `apps/web/src/components/PeopleOpsShowcase.tsx` — 93 raw hex occurrences; showcase palette should move to QEP token aliases or documented sub-brand tokens.
2. `apps/web/src/components/ExecutiveIntelligenceShowcase.tsx` — 83 raw hex occurrences; same showcase palette pattern.
3. `apps/web/src/components/CustomerIntelligenceShowcase.tsx` — 71 raw hex occurrences; same showcase palette pattern.
4. `apps/web/src/components/LogisticsShowcase.tsx` — 71 raw hex occurrences; same showcase palette pattern.
5. `apps/web/src/components/PartsLabShowcase.tsx` — 71 raw hex occurrences; same showcase palette pattern.
6. `apps/web/src/components/QuoteBuilderGate.tsx` — 71 raw hex occurrences; gate/brand splash palette should move behind shared QEP tokens.
7. `apps/web/src/components/RentalLabShowcase.tsx` — 71 raw hex occurrences; same showcase palette pattern.
8. `apps/web/src/components/IntegrationPanel.tsx` — 66 raw hex occurrences; integration status palette should move behind semantic tokens.
9. `apps/web/src/features/deal-room/pages/DealRoomPage.tsx` — 42 raw hex occurrences; deal-room surface should move to command-deck tokens.
10. `apps/web/src/features/parts-companion/pages/PredictivePlaysPage.tsx` — 28 raw hex occurrences; parts-companion surface should move to QEP/command-deck tokens.

Additional shell/auth utility exceptions:

- `apps/web/src/components/LoginPage.tsx` — dark gradient, input, and hover colors should use QEP auth-shell tokens.
- `apps/web/src/components/NavRail.tsx` — hardcoded slate text/hover colors should use shell tokens.
- `apps/web/src/components/TopBar.tsx` — hardcoded slate text/hover colors should use shell tokens.
- `apps/web/src/lib/flare/FlareAnnotator.tsx` — annotation red is an acceptable utility exception if documented.
- `apps/web/src/lib/flare/screenshot.ts` — screenshot fallback background is an acceptable utility exception if documented.

## Follow-up remediation queue

1. Add a small set of semantic auth/shell/showcase aliases in `index.css` instead of scattering new literal colors.
2. Convert `LoginPage.tsx`, `NavRail.tsx`, and `TopBar.tsx` first because they affect broad app navigation and authentication surfaces.
3. Normalize showcase copper palette usage behind named tokens or explicitly document it as a QEP innovation/showcase sub-brand.
4. Add a stricter future brand lint mode that fails new raw hex additions outside allowlisted utility files.
5. Run visual QA after token remediation, not before; this audit is static/source compliance evidence.

## Verification

Run:

```bash
bun run brand:guide:audit
```

Expected result:

- Confirms `docs/qep_brand_guide.pdf` and `docs/Brand Guide QEP.pdf` exist.
- Confirms QEP brand tokens exist in `apps/web/src/index.css`.
- Confirms Tailwind brand token bridge exists in `apps/web/tailwind.config.js`.
- Confirms this audit report exists and contains the required inventory/remediation sections.
- Prints current UI file count, surface inventory count, bucket counts, raw color occurrence count, and top raw-color files.

## Completion criteria

E2.1 is complete when this audit artifact and verifier are source-controlled. Remediation of the raw color exceptions is intentionally deferred to follow-up implementation tasks so broad UI changes are not mixed into the audit baseline.
