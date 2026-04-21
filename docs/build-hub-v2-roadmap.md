# Build Hub v2 — "The Room That Hears You"

**Date:** 2026-04-20
**Owner:** Brian
**Audience:** Engineering + stakeholder previewers (Angela, Ryan, Rylee, Juan)
**Status:** Moonshot scope — sequenced for ship
**Parent:** `QEP-OS-Master-Roadmap.md`, Track 7A
**Mission lock:** Every slice must advance equipment/parts sales+rental ops for
field reps, employees, corporate ops, and management. No feature ships that
doesn't sharpen one of those four roles' decision speed or execution quality.

---

## Why we are rebuilding the feedback surface

Build Hub v1 ships feedback to a database and fires a high-priority email to
`HUB_OPS_EMAIL`. That is a **submission pipe**, not a loop. A stakeholder who
submits feedback today has no idea whether it was seen, understood, drafted,
or shipped unless they remember to check `/brief/feedback` by hand. In the
field — gloves, wind, diesel noise, no keyboard — they won't. Adoption dies
in week two, and with it the data QEP OS needs to out-learn every competitor.

The v1 pipe is a "form." v2 is a **conversation**. v3 is a **colleague**.

The guiding principle:

> **The Build Hub should feel like talking to a team that hears you,**
> **remembers what you said, and ships the fix with your name on it —**
> **not like dropping a form into a box.**

If a feature doesn't advance that principle, it doesn't ship in this roadmap.

---

## The four moonshot tenets

Every slice in this document is graded against these four bars. A slice that
clears one tenet is v2. A slice that clears all four is v3 moonshot-grade.

1. **Heard** — the stakeholder knows a human (and a model) saw their words,
   within seconds, on the same device they typed them on. No "check your
   email." No "check the inbox."
2. **Understood** — the response back reflects the **context** of the thing
   they were looking at, the role they hold (owner vs. primary_contact vs.
   technical vs. admin), and the history of what they've already said.
3. **Acted on** — the feedback produces a visible delta: a PR, a decision, a
   "this is how we're handling it" note, a changelog entry with their name
   on it. Every item has a receipt.
4. **Remembered** — the resolved item becomes institutional memory. The next
   stakeholder who asks "did we ever fix X?" gets a citation with a PR link,
   not "I'll check."

These aren't soft goals. They are the grading rubric for every acceptance
criterion below.

---

## Shipping ladder

| Layer | Moonshot tenet(s) | Ship order | Status |
|---|---|:---:|---|
| **V2.1** Submitter loop-back (events + bell + status emails) | Heard, Acted on | 1 | 🟢 building now |
| **V2.2** Voice-first capture + page context auto-attach | Heard, Understood | 2 | planned |
| **V2.3** Feedback → NotebookLM on resolve | Remembered | 3 | planned |
| **V2.4** pgvector dedup on insert + stacked counts | Understood, Acted on | 4 | planned |
| **V3.1** Agentic PR loop with live Netlify preview per feedback | Acted on (moonshot) | 5 | designed |
| **V3.2** Multimodal capture — voice + screenshot + DOM snapshot + mic level | Heard, Understood (moonshot) | 6 | designed |
| **V3.3** Business-impact scoring tied to QRM signal | Understood, Acted on (moonshot) | 7 | designed |
| **V3.4** "What shipped because of you" stakeholder ledger | Heard, Remembered (moonshot) | 8 | designed |
| **V3.5** Proactive nudges — the Hub pages the stakeholder, not vice versa | Heard (moonshot) | 9 | designed |

v2 (slices .1–.4) is ~2 weeks sequential / ~1 week parallelized. v3 (slices
.1–.5) adds ~3–4 weeks on top. All behind `/brief/feedback`; no URL moves.

---

## Slice V2.1 — Submitter loop-back

**Moonshot tenets:** Heard, Acted on.

**What the stakeholder sees:** A notification bell in the `/brief` nav shows
a dot when any of their submitted items transitions state. Their card in the
inbox shows an inline timeline:
`submitted → triaged → drafting → awaiting_merge → shipped`,
each step with an ISO timestamp and, where relevant, a clickable artifact
(PR URL, commit SHA, "won't fix" rationale). When something ships, they
receive a Resend email with the same summary and a one-sentence "here's what
this means for you" note written by Claude from the PR body. When something
is marked `wont_fix`, they get a different, respectful email that cites the
triage record and explains the call.

**What to build:**

- New table `hub_feedback_events (id, feedback_id, workspace_id, event_type,
  from_status, to_status, actor_id, actor_role, payload jsonb,
  notified_submitter_at, created_at)`. RLS mirrors `hub_feedback` (workspace
  read; service role writes).
- Event types: `submitted`, `triaged`, `drafting_started`, `pr_opened`,
  `merged`, `shipped`, `wont_fix`, `admin_note`.
- Trigger `hub_feedback_emit_event` on `hub_feedback` AFTER INSERT/UPDATE:
  derive event type from status transition and write a row with the `OLD`
  row's status as `from_status`, `NEW.status` as `to_status`. Include
  `claude_pr_url` + `claude_branch_name` in payload when present.
- Add `last_seen_events_at timestamptz` to `hub_feedback` so the bell knows
  what's "unseen."
- New edge function `hub-feedback-notify`:
  - Callable by the trigger (via `pg_net`) OR by a 1-minute cron that drains
    unsent events (zero-blocking fallback when `pg_net` isn't available on
    this plan).
  - For each event with `notified_submitter_at IS NULL`, find the submitter,
    render the appropriate email (ships, won't-fix, or an amber "draft PR
    opened" that reassures mid-flight), send via `sendResendEmail()`.
  - Writes `notified_submitter_at = now()` on success; leaves it NULL on
    skipped/failed so the next cron pass retries.
- Frontend:
  - `FeedbackTimeline` component inside each `FeedbackCard` shows the ordered
    event list with status badges, relative times, and artifact chips.
  - `NotificationBell` in `BriefNav` — read count from `hub_feedback_events`
    where `feedback.submitted_by = me AND created_at > me.last_seen_events_at`.
    Click → navigate to `/brief/feedback` + stamp `last_seen_events_at = now()`.
  - 30s polling via `useQuery` — real-time upgrade is V3.5.

**Acceptance (moonshot rubric):**

- **Heard.** Stakeholder submits feedback at `T`. By `T+60s`, without
  refreshing, they see the `triaged` event in their card and the bell lights
  for the first time.
- **Acted on.** Feedback flips to `shipped` in prod. Within one notify cycle,
  the submitter has an email and the timeline shows `shipped` with the PR
  link + merge SHA.
- **Won't-fix dignity.** Admin marks `wont_fix`. Email is respectful, cites
  the reason pulled from the triage record + any admin note, and closes with
  "if this changes context, reply and we'll re-open."
- **Zero-blocking.** Missing `RESEND_API_KEY` → events still appear in the
  UI, the bell still works, emails are skipped silently.

**Files:**
- `supabase/migrations/321_hub_feedback_events.sql` (new)
- `supabase/functions/hub-feedback-notify/index.ts` (new)
- `apps/web/src/features/brief/components/FeedbackTimeline.tsx` (new)
- `apps/web/src/features/brief/components/NotificationBell.tsx` (new)
- `apps/web/src/features/brief/lib/brief-api.ts` (extend)
- `apps/web/src/features/brief/BriefRoutes.tsx` (mount bell)
- `apps/web/src/features/brief/pages/BriefFeedbackPage.tsx` (embed timeline)

---

## Slice V2.2 — Voice-first capture + page context auto-attach

**Moonshot tenets:** Heard, Understood.

**What the stakeholder sees:** The feedback modal opens with a large circular
mic button at the top. Press-and-hold (or toggle on mobile) → release →
transcript appears in the body field, editable. The submit button captures
the URL they were on, the page title, the current `build_item_id` (from any
`data-build-item-id` on the ancestor chain), and a trimmed DOM snapshot for
context. Claude triage now reads where they were, not just what they typed.

**What to build:**

- Reuse `iron-transcribe` edge function. Frontend records via `MediaRecorder`,
  uploads to a signed Supabase Storage URL in a new `hub_feedback_audio`
  bucket (public-read, 7-day expiry, stakeholder-write only), calls
  `iron-transcribe`, drops transcript in textarea.
- New column `submission_context jsonb` on `hub_feedback` — path, title,
  build_item_id, user-agent summary, screen size, dark_mode boolean.
- Permission prompt UX: first mic click shows an inline "we need mic access
  to transcribe — nothing is sent until you click Send" row with Grant
  button. Denial falls through silently to typed path.
- Live transcription mirror: as audio records, show a dimmed placeholder
  like "recording — 12s" with an audio-level bar so the stakeholder knows
  the mic is live. (Accessibility: screen reader reads "recording started"
  / "recording stopped.")
- Extend triage prompt in `hub-feedback-intake` with `submission_context`
  so the summary/priority reflect the page the user was on.

**Acceptance:**
- Rylee records 30 seconds on `/qrm/quotes/new`. Resulting row has:
  - `body` = transcript
  - `voice_transcript` = transcript (body is editable copy)
  - `voice_audio_url` = signed Storage URL
  - `submission_context.path = "/qrm/quotes/new"`
  - `ai_summary` names the page in its first clause
- Mobile Safari and Android Chrome grant mic on HTTPS without errors.
- Typed-only path keeps working — no regression.
- **Heard rubric:** latency from stop-recording → transcript visible in
  textarea ≤ 3 s on cellular for a 30-second clip.

**Files:**
- `supabase/migrations/322_hub_feedback_voice_context.sql`
- `apps/web/src/features/brief/components/FeedbackButton.tsx` (mount VoiceCapture)
- `apps/web/src/features/brief/components/VoiceCapture.tsx` (new)
- `supabase/functions/hub-feedback-intake/index.ts` (accept + pass context)

---

## Slice V2.3 — Feedback → NotebookLM on resolve

**Moonshot tenets:** Remembered.

**What the stakeholder sees:** "Ask the Brain" now answers
`"Did we ever fix the customer-picker add-new bug?"` with the actual PR link
and a one-sentence "what shipped" note. Today it can't — feedback lives
outside the knowledge layer.

**What to build:**

- Add `notebooklm_source_id text`, `notebooklm_synced_at timestamptz`, and
  `notebooklm_markdown text` to `hub_feedback`.
- Extend `hub-knowledge-sync` (the 4h cron) with a resolved-feedback source:
  rows where `status IN ('shipped','wont_fix') AND (notebooklm_synced_at IS
  NULL OR resolved_at > notebooklm_synced_at)`.
- Render each row as a markdown page with provenance (submitter, dates,
  status, type, body, suggested action, PR, merge SHA, feedback ID).
- Push to the same Google Drive folder as decisions/changelog. Record Drive
  file ID in `notebooklm_source_id`. The embeddings worker picks it up on
  its next pass — no custom indexing path needed.
- Unresolved feedback stays OUT of the brain. Half-formed complaints do not
  become institutional memory.

**Acceptance:**
- Feedback flips `awaiting_merge → shipped`. Within one sync cycle (max 4h,
  manually triggerable via `bun run hub:sync`), the item is in the pgvector
  index.
- "Ask the Brain" returns the fixed item as citation [n] with a working PR
  link in the rail.
- A `wont_fix` item is also synced, producing an "we decided not to do this
  because X" record in the brain.

**Files:**
- `supabase/migrations/323_hub_feedback_notebooklm.sql`
- `supabase/functions/hub-knowledge-sync/index.ts` (extend source list)
- `supabase/functions/hub-knowledge-sync/renderFeedback.ts` (new helper)

---

## Slice V2.4 — pgvector dedup on insert

**Moonshot tenets:** Understood, Acted on.

**What the stakeholder sees:** They submit "the customer picker won't let me
add a new one." The triage card now shows
`"This matches 2 earlier reports (Angela, Juan). Stacking with those."` Their
card shows a `Related (3)` chip that expands to the stack. Admin inbox sorts
by "hottest" (most-stacked, newest) so the painful-for-many issues rise.

**What to build:**

- Add `body_embedding vector(1536)` to `hub_feedback` (same embedding
  provider as `hub-knowledge-sync`).
- In `hub-feedback-intake`, after body is accepted and before triage:
  1. Embed the body.
  2. `SELECT id, body, ai_summary FROM hub_feedback WHERE body_embedding <=>
     $1 < 0.25 AND workspace_id = $wsId AND status NOT IN
     ('shipped','wont_fix') ORDER BY body_embedding <=> $1 LIMIT 5;`
  3. If matches, add `parent_feedback_id uuid` (new column) pointing at the
     oldest open match, include the match list in the triage context so
     Claude writes a "this is your 3rd report of this" summary.
- Frontend card shows `[+ N related]` chip when `parent_feedback_id` has
  siblings; click expands.
- View `hub_feedback_with_stacks` exposes `stacked_count` + `latest_stack_at`
  for the admin inbox sort.
- **Kickback:** when the stacked parent ships, V2.1's notify loop emails
  **all** submitters in the stack, not just the first.

**Acceptance:**
- Angela reports "can't add new customer in quote builder." 5 min later
  Juan submits similar text. His card shows `matches Angela's item from 5m
  ago` at triage. Admin inbox shows 1 row with `stacked_count = 2`, not 2
  rows. Shipping that parent emails both submitters.
- Submit an unrelated item — no false match, no `parent_feedback_id`,
  `stacked_count = 1`.
- Embedding failure (API down) → row still inserts, triage still runs,
  dedup is simply skipped. Zero-blocking.

**Files:**
- `supabase/migrations/324_hub_feedback_embeddings.sql` (column + index +
  `hub_feedback_with_stacks` view)
- `supabase/functions/hub-feedback-intake/index.ts` (embed → match → link)
- `apps/web/src/features/brief/pages/BriefFeedbackPage.tsx` (stack chip)

---

# v3 — Moonshot layer

v2 makes the Hub heard and remembered. v3 makes it **unprecedented**.

## Slice V3.1 — Agentic PR loop with live Netlify preview

**Moonshot tenet:** Acted on — the final form.

**What the stakeholder sees:** They submit "the quote builder customer
picker won't let me add a new one." 8 minutes later the card shows:

> **Draft ready to review.** I opened [PR #412](https://github.com/...) with
> a fix in `QuoteBuilderCustomerPicker.tsx`. **Preview:** https://deploy-preview-412--qep.netlify.app
> — open it, reproduce your exact flow, and click 👍 / 👎 on the card.

They click the preview, verify, thumbs-up. The thumbs-up triggers the merge.
The merge triggers the shipped email. The cycle closes **without Brian
being on his laptop.**

**What to build:**
- `hub-feedback-draft-fix` (exists) wired to emit a `drafting_started` event
  (already supported by V2.1 trigger), then a `pr_opened` event on success.
- Poll Netlify's deploy-preview API on the PR for ready-state; when ready,
  write `preview_url` onto the event payload. Hub renders the preview link
  in the timeline.
- New `hub-feedback-approve` edge function, callable by the submitter
  (not just admin) with `{feedback_id, verdict: "approve" | "reject",
  note}`. `approve` bumps status → `awaiting_merge` with a signal that the
  originating stakeholder verified; `reject` opens a new iteration loop
  (Claude re-reads the feedback + the reject note + the failing preview
  and tries again, max 3 rounds before escalating to Brian).
- UI: thumbs-up / thumbs-down + 1-line reason inside the timeline step for
  `pr_opened`.

**Acceptance:**
- A stakeholder can close the loop **without Brian being online**.
  Submit → triage → draft → preview → approve → merge → shipped → email-home,
  fully hands-off in ≤ 20 minutes on the happy path.
- `reject` produces a new draft that Claude attributes to the reject note
  ("retrying with: 'the modal still doesn't show the Save button on
  mobile'").
- Max 3 iterations before human escalation. The 4th reject pages Brian.

**Why this is moonshot:** today no CRM / feedback tool on the market closes
the loop end-to-end with an LLM agent and a live preview. This is the
"built around equipment + parts + sales + rental for the employees" line
from the mission statement — a tool that respects the stakeholder's time
enough to ship the fix **themselves** when possible.

---

## Slice V3.2 — Multimodal capture

**Moonshot tenet:** Heard + Understood, with fidelity.

**What the stakeholder sees:** The feedback modal is a single composable
input. They can:
- speak (V2.2),
- screenshot the current viewport with one tap (browser `getDisplayMedia()`
  or `html2canvas` fallback),
- annotate the screenshot with a finger / pointer (red-circle the broken
  control),
- drop in a photo from their phone camera roll (QR-scanned a label? just
  send the photo, Claude OCRs it),
- leave an audio voicemail-style clip if they don't want text at all.

Every one of these attaches to the feedback row and is threaded into the
triage context. The admin card shows them as inline thumbnails.

**What to build:**
- New table `hub_feedback_attachments (id, feedback_id, kind text check in
  ('audio','screenshot','photo','dom'), storage_path, caption, created_at)`.
- Frontend multi-upload component with live thumbnail previews before submit.
- Screenshot-with-annotation canvas overlay (react-konva or plain canvas).
- Triage extension: when attachments present, Claude receives a vision +
  audio composite message (Sonnet 4.6 is multimodal). OCR text from images
  is extracted and appended to the `ai_summary` context.

**Acceptance:**
- Submit an item with a voice clip + annotated screenshot. `ai_summary`
  references both visible text in the image and spoken content.
- Mobile: screenshot works on iOS Safari via `getUserMedia` camera path or
  the native "share as image" flow.

---

## Slice V3.3 — Business-impact scoring tied to QRM signal

**Moonshot tenet:** Understood — the model knows what *matters* to the
business, not just what's loud.

**What the stakeholder sees:** High-impact feedback surfaces with a red
"**Revenue at risk**" or "**Blocks field ops**" halo. Admin inbox sorts
by `impact_score DESC` by default, not by creation date.

**What to build:**
- `impact_score numeric(4,2)` + `impact_reasons text[]` on `hub_feedback`.
- Scoring function (called from `hub-feedback-intake` after triage):
  - Field-blocking flow (mentions "quote", "rental", "dispatch", etc.)
    scores +30.
  - Submitter role weight — owner +20, primary_contact +15, technical +10,
    admin +5.
  - QRM join: if the feedback references a `build_item_id` that ships an
    active revenue surface (check `qrm_router` contract coverage), +25.
  - Stack size (V2.4) × 10.
  - Recency × time-since-last-feedback-from-submitter (stakeholders who
    rarely complain get weighted higher — they don't cry wolf).
- View `hub_feedback_triage_queue` joins stack size, impact score, and
  returns a single ordered inbox for admins.

**Acceptance:**
- Angela (owner) says "quotes are broken" → score ≥ 75.
- Ryan (technical) says "typo on About page" → score ≤ 15.
- Sort on the admin inbox is obviously correct to a human glance at 10 rows.

**Why this is moonshot:** the Hub stops being a fair-share queue and starts
being a triage system that knows QEP's business. Every other feedback tool
makes you sort manually.

---

## Slice V3.4 — "What shipped because of you" stakeholder ledger

**Moonshot tenet:** Heard + Remembered, at the human level.

**What the stakeholder sees:** On `/brief`, a new card:

> **You (Angela) shipped 7 things this month.**
> Customer picker fix · Quote PDF margin tightening · 5 more →

Each line is a row from `hub_feedback` where `submitted_by = me` AND
`status = 'shipped'`. Clicking expands to the PR link, the changelog entry,
and a one-sentence "how it felt to ship this" note.

The ledger is the **opposite of a support ticket queue.** It's a trophy case
for the stakeholder. It says: *your voice changes the product.*

**What to build:**
- New component `StakeholderLedgerCard` on the Dashboard.
- Query: `hub_feedback where submitted_by = $me and status = 'shipped' and
  resolved_at > now() - interval '30 days'`.
- Monthly email digest (`stakeholder-ledger-monthly` cron) recaps each
  stakeholder's ledger with a single sentence per item. A thank-you note,
  essentially, sent the first of every month.
- Leaderboard (opt-in, off by default): which stakeholder's feedback has
  shipped the most this quarter. Useful internally for Brian; surfaced only
  to `admin`/`owner` audience.

**Acceptance:**
- Dashboard ledger updates within 30s of a `shipped` event.
- Monthly digest lands on the 1st at 8am in the stakeholder's timezone
  (timezone lives on `profiles`; default America/Chicago).
- Stakeholders describe the experience as "I feel heard" in the usage
  review. That's the real KPI.

---

## Slice V3.5 — Proactive nudges

**Moonshot tenet:** Heard — before the stakeholder knows to ask.

**What the stakeholder sees:** Push notifications or in-Hub banners like:

> **Angela — the quote PDF you flagged last week ships tomorrow. Want to
> preview it now?** [Preview](https://deploy-preview-…) · [Snooze]

Or:

> **Rylee — 3 other stakeholders just reported something similar to what
> you submitted Tuesday. We're treating it as priority. Here's the thread.**

Or:

> **Juan — your `wont_fix` from 2 months ago: new context arrived (Angela
> just hit the same case). Re-opening?**

**What to build:**
- `hub_feedback_nudges` table.
- Cron `hub-feedback-nudge-scheduler` runs hourly, scans for trigger
  conditions:
  - Stack-size threshold crossings (V2.4).
  - PR previews becoming ready for a stakeholder's item (V3.1).
  - Reopens when a `wont_fix` item gets a new stack entry (V2.4 × V3.1).
  - Silence detection — if a stakeholder hasn't logged in for 7 days and
    has an `awaiting_merge` item, nudge them.
- Deliver via web-push + email + optional SMS (Twilio edge fn exists).

**Acceptance:**
- Receive at least one nudge that was not manually triggered within the
  first 14 days of use.
- Every nudge is dismissible, snoozable, and shows a "why am I seeing
  this?" link to the underlying rule.

---

## Non-goals for v2+v3

- **Slack / Teams integration.** Email + in-Hub loop is enough until
  adoption crosses ≥ 50 submissions/week. Revisit then.
- **Multi-tenant.** `workspace_id = 'default'` is locked per Decisions log.
- **Public (customer-facing) feedback intake.** Stakeholder-only. Customer
  feedback is a separate product surface.
- **Autonomous merge.** Even at V3.1, Claude drafts + the stakeholder
  approves + the human merges. No feedback item ever hits main without a
  human click.

---

## Rollout discipline

Each slice is feature-flagged in `public.feature_flags`:

| Flag | Enables |
|---|---|
| `hub_feedback_loopback` | V2.1 |
| `hub_feedback_voice` | V2.2 mic UI |
| `hub_feedback_kb_sync` | V2.3 knowledge sync |
| `hub_feedback_dedup` | V2.4 embeddings + stacking |
| `hub_feedback_agent_loop` | V3.1 agentic PR loop |
| `hub_feedback_multimodal` | V3.2 attachments + vision |
| `hub_feedback_impact_score` | V3.3 impact scoring |
| `hub_feedback_ledger` | V3.4 stakeholder ledger |
| `hub_feedback_nudges` | V3.5 proactive nudges |

All flags default `false` in prod. Smoke-test with Ryan + Rylee on the
Netlify deploy, flip the flag, watch telemetry for 24h, lock it on.

Schema changes are **always additive** — new columns, new tables, new
views. No column drops, no constraint tightening that breaks in-flight
rows. Rollback = flip the flag off.

---

## Definition of done (the whole v2+v3 program)

Build Hub v2+v3 is **done** when all four of these are true — together, for
the same stakeholder, in the same week:

1. Rylee walks the yard, holds the mic button, says "the rental return flow
   is slow on my phone." Within 3 seconds she sees a transcript. Within 60
   seconds she sees her card triaged. Within 20 minutes she has a preview
   link. She clicks 👍. The fix merges. The bell lights. She reads
   "your fix shipped." She never opened her laptop.
2. Angela asks the Brain "what have we shipped for me this month?" and gets
   7 citations with PR links and a plain-English summary of each.
3. Juan submits a concern that three others already submitted. His card
   says "stacked with Angela's from Monday." When Brian ships that parent,
   all four stakeholders hear about it simultaneously.
4. Brian looks at his admin inbox and the first item is the one with
   highest **business impact**, not the most recent one.

Until all four are true, feedback is still a form. After, it's a colleague.

---

## Change log

- **2026-04-20 initial.** v2 (4 slices) written from v1 usage review.
- **2026-04-20 moonshot.** v3 (5 slices) added, tenets locked, acceptance
  rubric stiffened to "world-class" grade. Slice V2.1 flagged as building
  now.
