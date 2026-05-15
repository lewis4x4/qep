# Epic #42 — Post-approval routing (`post_approval_action`)

**GitHub:** [lewis4x4/qep#42](https://github.com/lewis4x4/qep/issues/42)  
**Schema:** `supabase/migrations/566_quote_post_approval_action.sql`  
**Edge:** `supabase/functions/quote-builder-v2/index.ts` (`tryAutoSendApprovedQuote`, save path)  
**Web draft:** `QuoteBuilderV2Page.tsx` (send / review UI chips), `quote-api.ts` save payload, `local-draft.ts` / `saved-quote-draft.ts` hydration

## Database

- Table: `public.quote_packages`
- Column: `post_approval_action text not null default 'return_to_rep'`
- Allowed values: **`return_to_rep`** | **`auto_send_customer`**
- Semantics (from column comment): controls whether an **approved** quote **auto-invokes customer send** vs **returns the rep to the send panel** for manual send.

## Edge (`quote-builder-v2`)

- After approval transitions where auto-send applies, the handler loads `post_approval_action` for the package.
- If **`auto_send_customer`**: calls internal `POST .../send-package` with the caller JWT + anon apikey (same function base URL) to deliver the customer packet when send pipeline succeeds.
- If **`return_to_rep`** (default): `tryAutoSendApprovedQuote` returns `{ attempted: false, sent: false, reason: "post_approval_action_return_to_rep" }` — no automatic send.

## Frontend contract

- Workspace draft field: `postApprovalAction` (camelCase); persisted / API as `post_approval_action` (snake_case).
- Save payload default when unset: **`return_to_rep`** (`quote-api.ts`).

## Verification

```bash
cd /Users/brianlewis/Projects/qep-knowledge-assistant
bun run migrations:check
bun test apps/web/src/features/quote-builder/lib/__tests__/local-draft.test.ts
```

Or: `bun run verify:track-a-epics` (includes the above plus Track B + floor + trade tests).

*(End-to-end auto-send requires approved package + live `send-package` prerequisites — exercise in staging with a test quote.)*

## See also

- [Epic #41 — Customer PDF / proposal line visibility](./epic-41-customer-pdf-line-visibility.md) (internal vs customer packet lines).
- [Epic #43 — M365 + IntelliDealer observability](./epic-43-m365-intellidealer-observability.md) (cron, logs, staging counts).
- [Epic #44 — Trade valuation audit](./epic-44-trade-valuation-audit.md) (Point-Shoot / trade step vs PDF).
