# Slice 08 CP4 — Dark Mode Audit Findings

**Scope:** Slice 07 admin surfaces, checked for dark-mode contrast hazards
and hardcoded color classes that bypass the theme-token system.

**Method:** Grep of `apps/web/src/features/admin` for raw Tailwind color
utilities (`text-red-500`, `bg-yellow-400`, etc.) and for theme-token
usage (`text-success-foreground`, `text-warning`). Components flagged
manually for contrast.

---

## Summary

Slice 07 components ship with theme tokens almost exclusively. Two Slice 07
surfaces had hardcoded color classes that either (a) were missing a dark
variant or (b) didn't respond to theme changes.

Both fixed in the same CP4 commit.

**Pre-existing admin surfaces outside Slice 07 scope** (ExecCommandCenter,
IncentiveCatalog, FlowAdmin, DataQuality, Flare drawers) use
`text-red-400`, `text-amber-400`, `text-emerald-400` — these are
specifically dark-mode-tuned shades paired with dark backgrounds. Not in
CP4 scope; flag for a broader admin-theme pass if ever prioritized.

---

## Fixes Applied

### 1. `AiRequestLogPage.tsx` — "Unresolved" badge

**Before:**
```tsx
<Badge variant="outline" className="text-yellow-600 border-yellow-300">Unresolved</Badge>
```
`text-yellow-600` + `border-yellow-300` reads fine on a white background
but in dark mode the 600-weight yellow against a dark `card` background
was low contrast; the 300-weight border disappeared entirely.

**After:**
```tsx
<Badge variant="warning">Unresolved</Badge>
```
Uses the project's `warning` badge variant, which defines both light and
dark token values. Consistent with the Unresolved badges elsewhere in the
admin UI (e.g., `BrandEngineStatusForm`).

### 2. `PriceSheetsPage.tsx` — "No Freight" stat

**Before:**
```tsx
<span className="text-2xl font-bold text-orange-500">{noFreight}</span>
```
`text-orange-500` is passable in both modes but doesn't follow the
theme-token convention used by the neighboring stats (`text-destructive`
for the urgent count). Inconsistent visual language on the same row.

**After:**
```tsx
<span className="text-2xl font-bold text-warning">{noFreight}</span>
```
Matches the theme token for amber warnings used in `FreightZoneForm`,
`FreightCoverageGrid`, and `BrandEngineStatusForm`.

---

## Surfaces Verified Clean (No Fix Needed)

The following Slice-07 components use theme tokens throughout; no
hardcoded color classes were found:

| Component | Tokens used |
|---|---|
| `UploadDrawer.tsx` (PhaseBanner) | `text-success-foreground`, `text-destructive`, `bg-success/10`, `bg-destructive/10` |
| `FreightCoverageGrid.tsx` | `text-warning-foreground`, `text-success-foreground`, `bg-muted` |
| `FreightZoneForm.tsx` | `text-destructive`, `text-warning`, `border-destructive/30` |
| `FreightZoneDrawer.tsx` | `text-destructive`, `text-primary` |
| `StateCodeMultiSelect.tsx` | `bg-primary`, `text-primary-foreground`, `bg-muted/40` |
| `BrandEngineStatusForm.tsx` | `bg-destructive/10`, `bg-success/10`, `text-warning` |
| `BrandFreshnessTable.tsx` | `text-destructive`, `text-foreground`, `text-muted-foreground` |
| `UrgencyBadge.tsx` | Uses Badge `variant` props only |

`AiRequestLogPage.tsx` also uses `bg-red-50 dark:bg-red-950/20` style
row-color classes — left as-is because they already have explicit dark
variants and achieve a subtle tinted row effect the theme tokens don't
directly provide.

---

## Outcome

- 2 files modified
- 0 new issues discovered outside Slice 07 scope
- No deep theme rework needed; Slice 07 components largely follow the
  token convention already established in Slices 05–06

Audit checklist acceptance (from `SLICE_08_ADMIN_HARDENING.md` CP4):
all admin surfaces pass a contrast spot check ✓.
