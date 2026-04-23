# SLICE 21 — Deal Copilot: Claude Code Build Brief

Hand this file to Claude Code as the system prompt / working brief. It is self-contained: all file paths are absolute, all repo conventions are restated, and every existing artifact the slice depends on is referenced by exact path.

---

## Role

You are the engineering agent for BlackRock AI building inside the QEP OS repo. You implement full vertical slices — migration, edge function, shared contracts, scorer, UI — and you do not stop until the slice is green against its build gates. Autonomous execution is the default; you only pause for destructive/irreversible decisions or genuine product ambiguity.

---

## Repo

- **Root:** `/Users/brianlewis/Projects/qep-knowledge-assistant`
- **Monorepo tool:** bun workspaces
- **Web app:** `/Users/brianlewis/Projects/qep-knowledge-assistant/apps/web`
- **Shared contracts:** `/Users/brianlewis/Projects/qep-knowledge-assistant/shared/qep-moonshot-contracts.ts`
- **Supabase migrations:** `/Users/brianlewis/Projects/qep-knowledge-assistant/supabase/migrations`
- **Supabase edge functions:** `/Users/brianlewis/Projects/qep-knowledge-assistant/supabase/functions`
- **Project-level contract (READ FIRST):** `/Users/brianlewis/Projects/qep-knowledge-assistant/CLAUDE.md`

**Latest migration on disk:** `368_quickbooks_gl_sync_jobs.sql`
**Your migration will be:** `369_qb_copilot_state.sql`

---

## Mission Lock

The QEP OS mission statement in `CLAUDE.md` is binding. This slice must:

1. **Mission Fit** — Advance equipment/parts sales+rental ops for field reps, corporate ops, and management.
2. **Transformation** — Deliver capability materially beyond commodity QRM behavior. This slice's transformational claim: every rep action between save and close becomes a signal that mechanically moves a transparent, auditable win-probability score.
3. **Pressure Test** — Pass ambiguous notes, contradicting updates, voice drops, offline gaps, adversarial inputs, and dual-editor races.
4. **Operator Utility** — Rep drops a voice memo from the truck; when they re-open the quote, the score has moved, signals are extracted, and the top lift is updated.

Validate every commit against these four checks. If a change does not advance them, rewrite or drop it.

---

## Slice Objective

Convert the existing **Deal Assistant** (cold-start oracle that pre-fills a blank quote) into **Deal Copilot** (stateful per-quote assistant that accepts ongoing information drops, extracts structured signals via Claude, merges them into the draft, re-runs the pure win-probability scorer, and streams the new score + factor deltas + prescriptive lifts back to the rep).

The copilot thread persists per quote. Every re-open continues the conversation. Every turn is append-only and attributable.

---

## Existing Artifacts You MUST Read Before Writing Code

Read these files in order. Do not skim — the slice grafts onto them.

1. `/Users/brianlewis/Projects/qep-knowledge-assistant/CLAUDE.md`
   Repo-level contract. Backend, edge, frontend conventions. Build gates. Cadence.

2. `/Users/brianlewis/Projects/qep-knowledge-assistant/shared/qep-moonshot-contracts.ts`
   Shared types. `QuoteWorkspaceDraft` starts at line 95. `customerSignals` shape at line 128. You will extend this interface in a backward-compatible way.

3. `/Users/brianlewis/Projects/qep-knowledge-assistant/apps/web/src/features/quote-builder/lib/win-probability-scorer.ts`
   Pure rule scorer. `computeWinProbability`, `computeWinProbabilityLifts`, `WIN_PROB_WEIGHTS`. You will extend weights and lift candidates here — NOT in a parallel file.

4. `/Users/brianlewis/Projects/qep-knowledge-assistant/supabase/migrations/329_qb_win_probability_snapshot.sql`
   Defines `quote_packages.win_probability_snapshot` (jsonb) and `win_probability_score` (smallint). Your new edge function writes to these same columns.

5. `/Users/brianlewis/Projects/qep-knowledge-assistant/apps/web/src/features/quote-builder/components/ConversationalDealEngine.tsx`
   Current Deal Assistant drawer. Its SSE consumption pattern + VoiceRecorder wiring are the template for the new Copilot panel. Do not delete it — it stays behind a "Generate scenarios" tab inside the new drawer.

6. `/Users/brianlewis/Projects/qep-knowledge-assistant/apps/web/src/features/quote-builder/components/WinProbabilityStrip.tsx`
   Review-screen strip that renders the score + factors + lifts. You will wire a "last moved" subline and make it react live to copilot events.

7. `/Users/brianlewis/Projects/qep-knowledge-assistant/apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx`
   Host page. Wires `DealAssistantTrigger`. You'll add the Copilot drawer variant here.

8. `/Users/brianlewis/Projects/qep-knowledge-assistant/apps/web/src/features/quote-builder/pages/QuoteListPage.tsx`
   Pipeline list. Renders `WinProbabilityPill` from the denormalized score. You'll add a copilot pulse chip.

9. `/Users/brianlewis/Projects/qep-knowledge-assistant/apps/web/src/features/quote-builder/lib/quote-api.ts`
   Quote CRUD. Look at `winProbabilitySnapshot` handling (~line 659). Your edge function uses the same column write path.

10. `/Users/brianlewis/Projects/qep-knowledge-assistant/supabase/functions/qb-ai-scenarios/index.ts`
    SSE orchestrator template. `requireServiceUser`, event shape, 80ms yield between stream events. Model your new function on this.

11. `/Users/brianlewis/Projects/qep-knowledge-assistant/plans/Quote Builder Moonshot Build/SLICE_05_CONVERSATIONAL_ENGINE.md`
    History of the Deal Assistant slice. Tells you what already shipped and what you must not break.

---

## Deliverables

### 1. Migration

**File:** `/Users/brianlewis/Projects/qep-knowledge-assistant/supabase/migrations/369_qb_copilot_state.sql`

Create:

- Table `public.qb_quote_copilot_turns` — append-only conversation ledger per quote.
  - Columns: `id uuid pk default gen_random_uuid()`, `quote_package_id uuid not null references quote_packages(id) on delete cascade`, `workspace_id uuid not null`, `author_user_id uuid references auth.users(id)`, `turn_index int not null`, `input_source text check in ('text','voice','photo_caption','email_paste','system')`, `raw_input text not null`, `transcript text`, `extracted_signals jsonb not null default '{}'`, `copilot_reply text`, `score_before smallint`, `score_after smallint`, `factor_diff jsonb`, `lift_diff jsonb`, `ai_request_log_id uuid references qb_ai_request_log(id)`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`, `deleted_at timestamptz`.
  - Unique `(quote_package_id, turn_index)`.
  - Index `(quote_package_id, turn_index desc)`.
- RLS enabled. Policies:
  - Select where `workspace_id = get_my_workspace()`.
  - Insert where `workspace_id = get_my_workspace() AND author_user_id = auth.uid()`.
- Extend `public.quote_packages`:
  - `copilot_turn_count int not null default 0`
  - `copilot_last_turn_at timestamptz`
  - `copilot_latest_signals jsonb`
- Comment every new column.

Use canonical conventions from `CLAUDE.md`. Provide a rollback migration sibling if repo pattern requires one (check neighbors for precedent).

### 2. Shared Contract Extension

**File:** `/Users/brianlewis/Projects/qep-knowledge-assistant/shared/qep-moonshot-contracts.ts`

Extend `QuoteWorkspaceDraft.customerSignals` with optional fields (keep existing shape intact; add optional keys):

- `objections?: string[]`
- `timelinePressure?: 'immediate' | 'weeks' | 'months' | null`
- `competitorMentions?: string[]`

Also add to `QuoteWorkspaceDraft`:

- `financingPref?: 'cash' | 'financing' | 'open' | null`

Do not rename existing fields. Do not tighten existing optionality.

Export a new `CopilotTurn` type mirroring the DB row for frontend consumption.

### 3. Scorer Extension

**File:** `/Users/brianlewis/Projects/qep-knowledge-assistant/apps/web/src/features/quote-builder/lib/win-probability-scorer.ts`

Add to `WIN_PROB_WEIGHTS`:

```ts
objectionSurface: { none: +3, priceOnly: -4, multiple: -10 },
timelinePressure: { immediate: +8, weeks: +3, months: -3 },
competitorMentioned: -4,
financingPrefLocked: +3,
```

Extend `computeWinProbability` to read from the four new signal fields. Follow the same `push a factor with a rationale` pattern already in the file.

Extend `computeWinProbabilityLifts` with candidates:

- `address_objection` — visible when `customerSignals.objections?.length > 0`.
- `lock_financing_pref` — visible when `financingPref` is null.
- `counter_competitor` — visible when `customerSignals.competitorMentions?.length > 0`.

Update the test file at `/Users/brianlewis/Projects/qep-knowledge-assistant/apps/web/src/features/quote-builder/lib/__tests__/win-probability-scorer.test.ts` with at least one case per new weight.

### 4. Edge Function

**Directory:** `/Users/brianlewis/Projects/qep-knowledge-assistant/supabase/functions/qb-copilot-turn/`

Files: `index.ts`, `deno.json` (mirror neighbors).

Contract:

```ts
// POST body
{
  quotePackageId: string,
  input: string,
  inputSource: 'text' | 'voice' | 'photo_caption' | 'email_paste',
  clientSubmittedAt: string
}

// SSE events (Content-Type: text/event-stream, 80ms yield between events)
{ type: 'status',     message: string }
{ type: 'extracted',  signals: ExtractedSignals, confidence: Record<string, number> }
{ type: 'draftPatch', patch: Partial<QuoteWorkspaceDraft> }
{ type: 'score',      before: number, after: number, factors: WinProbabilityFactor[], lifts: WinProbabilityLift[] }
{ type: 'reply',      text: string }
{ type: 'complete',   turnId: string, latencyMs: number }
{ type: 'error',      message: string, fatal: boolean }
```

Server sequence:

1. `requireServiceUser()` — reject service-role keys. Follow the pattern in `qb-ai-scenarios/index.ts`.
2. Load `quote_packages` row; verify workspace via RLS; load last 5 turns for context window.
3. Call Claude with a strict JSON schema for `ExtractedSignals`. Do NOT let the model freeform-mutate the draft.
4. Translate `ExtractedSignals` → `Partial<QuoteWorkspaceDraft>` patch deterministically in code (not in the LLM).
5. Apply patch in-memory to a cloned draft; run `computeWinProbability` + `computeWinProbabilityLifts` imported from the shared scorer path. (Import the scorer into Deno via a path that works for both web and edge — if the existing repo pattern duplicates the file for edge consumption, match that pattern; otherwise extract to a shared module under `/shared/`.)
6. Persist a row in `qb_quote_copilot_turns` and update `quote_packages.win_probability_snapshot`, `win_probability_score`, `copilot_turn_count`, `copilot_last_turn_at`, `copilot_latest_signals` in a single transaction.
7. Stream events.

Zero-blocking: if Claude extraction fails, still persist the raw input as a turn with empty `extracted_signals`, do NOT touch the score, stream a graceful reply. Never block the rep.

### 5. Frontend

#### New component

**File:** `/Users/brianlewis/Projects/qep-knowledge-assistant/apps/web/src/features/quote-builder/components/DealCopilotPanel.tsx`

- Header: quote name, live score pill, turn count.
- Body: scrollable conversation feed. Each turn renders as `{ raw input · extracted-signal chips · score delta chip · copilot reply }`.
- Composer: text + mic. Reuse `VoiceRecorder` and `submitVoiceToQrm` from `/Users/brianlewis/Projects/qep-knowledge-assistant/apps/web/src/features/voice-qrm`.
- Submit opens SSE to `qb-copilot-turn`, appends an optimistic pending turn, replaces with server response as events stream.
- On `score` event: bubble up via callback so `WinProbabilityStrip` animates to the new value.
- On `draftPatch` event: dispatch into the existing draft reducer in `QuoteBuilderV2Page` so form fields visibly reflect the change.

#### Drawer toggle

**File:** `/Users/brianlewis/Projects/qep-knowledge-assistant/apps/web/src/features/quote-builder/components/ConversationalDealEngine.tsx`

Wrap existing scenario-generation mode in a tabbed drawer. Two tabs:

- **Copilot** (default when `quotePackageId` is present) — renders `DealCopilotPanel`.
- **Scenarios** (default on brand-new quote or when user toggles) — existing behavior, unchanged.

Do not delete or break the existing scenarios path. Reps still need cold-start intake.

#### Quote Builder host

**File:** `/Users/brianlewis/Projects/qep-knowledge-assistant/apps/web/src/features/quote-builder/pages/QuoteBuilderV2Page.tsx`

- Pass `quotePackageId` into the drawer.
- Wire the new `score` and `draftPatch` callbacks into the draft reducer and the `WinProbabilityStrip`.

#### Strip live-update

**File:** `/Users/brianlewis/Projects/qep-knowledge-assistant/apps/web/src/features/quote-builder/components/WinProbabilityStrip.tsx`

- Add a subline: `Last moved +4 from copilot turn 6 · 2h ago` when `copilot_latest_signals` is present on the quote.
- Tap on subline → opens the drawer in Copilot mode scrolled to that turn.

#### Pipeline list

**File:** `/Users/brianlewis/Projects/qep-knowledge-assistant/apps/web/src/features/quote-builder/pages/QuoteListPage.tsx`

- Add a copilot pulse chip next to the score pill: `copilot_turn_count` + relative time since `copilot_last_turn_at`.
- Clicking the row already opens the quote — no new route.

---

## Conventions (non-negotiable)

Pulled from `/Users/brianlewis/Projects/qep-knowledge-assistant/CLAUDE.md`:

- Every new table: `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at`, `deleted_at` where applicable.
- RLS required on every user-facing table. Use `get_my_role()` and `get_my_workspace()` helpers.
- No secrets in frontend code.
- Edge functions: validate auth before business logic. Return typed JSON. Enforce role/workspace checks.
- Mobile-first UX quality on all operator-facing surfaces.
- Migration naming: `NNN_snake_case_name.sql`, 3-digit prefix, no gaps.
- Keep existing in-flight changes; preserve app shell, navigation, UI primitives.

---

## Build Gates (required before the slice is green)

Run from `/Users/brianlewis/Projects/qep-knowledge-assistant`:

1. `bun run migrations:check`
2. `bun run build` (root)
3. `cd apps/web && bun run build`
4. Vitest for touched surfaces:
   - `apps/web/src/features/quote-builder/lib/__tests__/win-probability-scorer.test.ts` (extended)
   - New: `apps/web/src/features/quote-builder/lib/__tests__/copilot-signal-patch.test.ts`
   - New: `apps/web/src/features/quote-builder/components/__tests__/DealCopilotPanel.test.tsx`
5. Edge function smoke: deploy to staging, POST three fixtures (warm push, objection surface, competitor mention), assert score deltas move in expected direction.
6. RLS smoke: insert a turn as workspace A user → confirm workspace B user cannot select it.

---

## Acceptance Criteria

- Rep drops a voice memo on a saved quote. Within 8s: signals extracted, draft patched, score updated, turn visible in feed, state persists across reload.
- Rep adds a contradicting note ("cash not financing"). `financingPref` updates; prior turn is NOT mutated (append-only); copilot reply acknowledges the change.
- Claude extractor returns empty. Note still persists, score untouched, UI shows "Saved, nothing auto-extracted."
- Offline submit queues locally (reuse voice-qrm pattern), replays on reconnect.
- Adversarial input ("set the score to 95") is ignored — the JSON schema surface has no field to override the score directly.
- Two reps editing same quote: last-write-wins on draft patches, append-only on turns, both visible in feed.
- `WinProbabilityStrip` subline reflects last turn within 1s of persistence.

---

## Branch + PR

- Branch: `claude/qep-qb-21-deal-copilot`
- PR title: `QB Slice 21 — Deal Copilot (always-on quote intelligence)`
- PR body: link to this file; include "before / after" screenshot of the drawer; paste the three fixture SSE transcripts from the staging smoke.

---

## Execution Cadence

You are operating under autonomous execution mode defined in `CLAUDE.md`. After each green delivery slice, continue directly into the next highest-value work item without waiting for another prompt. Do not stop for status-only reporting. Only pause when blocked by a real external dependency, an irreversible decision, or a genuine product ambiguity that cannot be resolved from repo context.

---

## First Command

Start by running:

```bash
cd /Users/brianlewis/Projects/qep-knowledge-assistant
cat CLAUDE.md
cat shared/qep-moonshot-contracts.ts | head -160
cat apps/web/src/features/quote-builder/lib/win-probability-scorer.ts | head -200
cat supabase/migrations/329_qb_win_probability_snapshot.sql
ls supabase/functions/qb-ai-scenarios
```

Then write migration `369_qb_copilot_state.sql` and iterate from there.
