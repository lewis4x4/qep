# Oracle Review

## Summary

The diff successfully moves Companies/Contacts onto dedicated routes, wires list reads and company duplicate/merge flows through qrm-router, preserves elevated merge gates, adds editor validation/invalidation, and substantially improves the operator-deck UI with richer headers, rows, search, empty/error states, and CSV exports. I found no P0 blockers, but there are a couple of high-value fixes before handoff.

## Findings

### P1

- **`apps/web/src/features/qrm/pages/QrmCompaniesPage.tsx` and `apps/web/src/features/qrm/pages/QrmContactsPage.tsx` — row a11y summary is attached to a non-focusable wrapper**
  - The new `aria-describedby={rowDescriptionId}` sits on the outer `<div>`, but keyboard/screen-reader users actually focus the inner `<Link>` and health/action buttons. That means the stitched row announcement from the hidden span is not reliably announced.
  - **Suggestion:** move `aria-describedby={rowDescriptionId}` onto the primary row link and any secondary row action links/buttons, or make the row a labelled `role="group"` and ensure each focusable child references the same description.

### P2

- **`apps/web/src/features/qrm/pages/QrmCompaniesPage.tsx` and `apps/web/src/features/qrm/pages/QrmContactsPage.tsx` — loading captions still show zero-count copy**
  - Header metrics avoid credibility-breaking zeros, but search captions still render `0 loaded` during initial fetch. This conflicts with the “no zero-metric credibility” goal.
  - **Suggestion:** use `isInitialLoading ? "loading cohort" : \`\${loaded.toLocaleString()} loaded\`` in both search captions.

- **`supabase/functions/_shared/crm-router-data.ts` — list endpoint can turn malformed `tree_root_company_id` into a generic 500**
  - Frontend validates `treeRoot` as UUID, but the router endpoint accepts arbitrary text and passes it into `list_crm_contacts_for_company_subtree_page`. Direct API callers can trigger DB cast/RPC errors that map to `UNEXPECTED_ERROR`.
  - **Suggestion:** validate `treeRootCompanyId` server-side before RPC and return `400 VALIDATION_ERROR` for malformed IDs.

- **`apps/web/src/features/qrm/components/command-deck.tsx` — MoonshotBeat/IronBar action focus styling is on an inner span, not the anchor/button**
  - The visible focus ring class is applied to `actionContent`’s `<span>`, but browser focus lands on the wrapping `<a>`/`button`, so keyboard users may not get a visible focus indicator.
  - **Suggestion:** apply the interactive classes directly to the `<a>`/`button>` and render plain content inside.