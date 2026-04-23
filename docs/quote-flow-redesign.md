# Sales Quote Flow Redesign

Status: Phase 4 UI redesign spec  
Approval basis: Phases 1-3 audit, data contract, and backend gap plan were completed first.  
Implementation rule: Guided Mode preserves the current six-step flow. Workspace Mode becomes the default quote-building surface and uses the same draft state, calculations, save path, approval state, and quote package identity.

## A. New Quote Entry Screen

The entry screen presents four equal-weight cards. Each card creates or updates the same quote workspace draft and then drops the rep into Workspace Mode.

| Entry card | On click | Landing state | Pre-populates |
| --- | --- | --- | --- |
| Voice | Starts in-workspace voice intake. After transcript/recommendation returns, opens customer zone with transcript visible. | Workspace Mode, Customer zone focused. | `entryMode=voice`, `voiceSummary`, optional customer entities, recommendation if returned. |
| AI Chat | Opens a compact AI prompt. On submit, calls the existing recommendation path. | Workspace Mode, Customer zone focused. | `entryMode=ai_chat`, `voiceSummary` as prompt, recommendation if returned. |
| Manual | Starts a blank quote without waiting on AI. | Workspace Mode, Customer search focused. | `entryMode=manual`, rep branch default if available. |
| Trade Photo | Opens trade capture first, then keeps the quote in workspace with Trade expanded. | Workspace Mode, Trade section expanded. | `entryMode=trade_photo`, trade allowance/valuation when capture completes. |

## B. Single Quote Screen - Three-Zone Workspace

### Top Bar

- Back to Floor link.
- Quote ID and status chip.
- Last-saved indicator backed by successful server save timestamps when the quote can be saved; partial drafts show local draft state.
- Running total in tabular numerals and QEP orange. It updates from equipment, attachments, discount, trade, tax, and down payment.
- Financing method label beside the total.
- One primary action always visible:
  - Missing required draft fields: Save Draft disabled with missing fields visible nearby.
  - Draft complete but not approved: Save Draft or Submit for Approval depending status/readiness.
  - Approved and send-ready: Review & Send.
  - Sent/accepted: Update.
- Workspace/Guided segmented toggle.

### Left Zone - Customer, About 320px

- Customer search with live results using existing `CustomerPicker`.
- Opportunity description text area, backed by `voiceSummary` until a stable backend field exists.
- Voice button uses existing voice recorder pipeline.
- Branch selector defaults to the rep's branch when only one active branch is known and stays overrideable.
- Digital Twin compact panel is collapsed by default and expandable.

### Center Zone - Commercial Workspace

- Package section shows all native draft line items and persists the package through canonical `quote_package_line_items` rows. Compatibility JSON remains on `quote_packages` for older surfaces.
- Add item picker supports:
  - Equipment: existing catalog selector.
  - Attachment: compatible options when a selected model provides options.
  - Warranty, Financing, Custom: supported as typed package rows.
- Trade section is collapsed by default and expands to Snap Photo, Add Manually, or No Trade.
- Commercial Terms summary row expands into discount, tax profile, down payment, and financing editor.
- Margin Waterfall is collapsed by default, expandable, and live in the workspace. Current calculation uses the existing estimated dealer cost until authoritative unit-cost data is available.

### Right Zone - AI Copilot, About 320px

- Ask bar opens Deal Assistant/Copilot.
- Signals section shows live win probability and top lifts/drags.
- Suggestions section is empty until trigger conditions are met. Initial implementation only shows AI recommendation after voice/AI prompt/recommendation exists, with a visible source label.
- Deal Coach remains sticky at the bottom/right rail and uses existing rule engine output.

## C. Guided Mode Toggle

Guided Mode preserves the current six-step wizard:

1. Entry
2. Customer
3. Equipment
4. Trade-In
5. Financing
6. Review

Workspace and Guided Mode share the same `QuoteWorkspaceDraft`, computed totals, save mutation, approval workflow, local draft fallback, and quote package id. Reps can switch modes mid-quote without losing state.

## D. Review & Send Modal

Review & Send is a modal opened from the workspace top bar, not a separate screen.

Required contents:

- Quote summary and PDF/print preview actions.
- Delivery options: email, SMS, print, link.
- Recipient fields using the current customer name/email/phone.
- Internal notes field.
- Approval and send readiness messaging.

Current backend support is strongest for email, PDF/print, and share-link flows. SMS remains a visible but disabled channel until backend delivery support exists.

## E. My Quotes Screen for Sales Rep Home

The sales rep home already includes `sales.my-quotes-by-status`. This redesign changes the widget from status-grouped cards to an actionable table that replaces commission-style summary behavior for reps.

Columns:

- Quote ID
- Customer
- Equipment
- Value
- Status
- Days since sent
- Action

Rows link back into `/quote-v2` with the same quote package/deal identity.

## Phase 5 Rules Applied

- Persistent live total stays in the top bar.
- AI recommendation/suggestions stay empty until voice/AI prompt or a saved Copilot turn creates context.
- Auto-save attempts server save every 10 seconds when server requirements are met and passes an `updated_at` concurrency token; partial drafts continue local fallback until they meet minimum server-save requirements.
- Multi-item packages are presented as the primary mental model and saved through canonical line item rows.
- Branch/tax defaults are inferred where current branch data allows.
- Point-Shoot-Trade is an entry method and remains accessible mid-workspace.
- One primary action is always visible in the top bar.
- The six-step wizard survives as Guided Mode.

## Phase 6 Verification Notes

The implementation must verify:

- Workspace Mode renders all three zones.
- Guided Mode still renders and navigates the six-step wizard.
- Top bar running total updates from draft changes.
- Review & Send opens as a modal.
- Entry methods drop into the workspace with correct prepopulation behavior.
- Sales home quote widget renders as an actionable table.

Remaining production gaps after the first implementation pass: SMS delivery is still disabled, opportunity description still rides on `voiceSummary`, and Margin Waterfall still uses estimated dealer cost until authoritative line-level cost data is integrated.
