# Wave 6.11 — Flare: In-App Context-Aware Bug Capture

**Audience:** Claude Code (build agent). This document is the implementation contract.
**Repo:** `/Users/brianlewis/client-projects/qep`
**Status:** Ready to build. Do not deviate from section names, file paths, table names, column names, route paths, or env var names without updating this document first.
**Hotkey:** `Ctrl+Shift+B` (Win/Linux) / `Cmd+Shift+B` (Mac). Idea variant: `Ctrl+Shift+I` / `Cmd+Shift+I`.

---

## 0. Mission Fit Check (mandatory per CLAUDE.md)

- **Mission Fit:** Reduces time-to-report from minutes (leave page, open ticket system, re-describe, attach screenshot) to ~10 seconds (one hotkey, one sentence). Improves operator decision/execution quality by closing the bug-reporting loop inside the workflow.
- **Transformation:** Auto-captures DOM, click trail, network trail, console errors, route history, store snapshot, perf metrics, and visible entity IDs — context no human would type and no commodity bug tracker captures.
- **Pressure Test:** Must survive: offline, 3G, modal-open state, error-boundary fallback UI, password-field redaction, rate-limit floods, PII scrubbing, and dual-ticket dispatch failures.
- **Operator Utility:** Every role benefits. Reps report broken buttons. Managers flag wrong numbers. Owners report vision gaps. Portal users (future Wave 6.7) report customer-facing breakage.

---

## 1. Scope Boundary (what this ships, what it does not)

### Ships in v1
- Global hotkey (`Ctrl+Shift+B` / `Cmd+Shift+B`) and idea variant (`Ctrl+Shift+I` / `Cmd+Shift+I`).
- Right-side slide-in drawer (shadcn `Sheet`).
- Auto-captured context payload (see §4).
- Screenshot via `html2canvas`.
- Optional on-screenshot annotation (red arrow + red circle + free-draw, 3 tools max).
- Ring buffers for clicks / network / console errors / route changes.
- PII + secret redaction layer.
- `flare-submit` Supabase Edge Function.
- `flare_reports` table + RLS (migration 167).
- Supabase Storage bucket `flare-artifacts` for screenshots + DOM snapshots.
- Dual-dispatch to Linear AND Paperclip (zero-blocking — missing creds do not crash submission).
- Slack notification to `#qep-flare` with deep-link back to user's exact page.
- Email notification to Speedy (`blewis@lewisinsurance.com`) for severity = `blocker`.
- Toast confirmation with ticket ID + deep-link.
- "Also happened to N teammates this week" dedupe hint.
- Manager triage dashboard at `/admin/flare`.
- Auto-follow-up email when status transitions to `fixed`.
- Rate limiting: 20 flares / user / hour.
- Wire flares of severity `blocker` into Wave 6.9 Exception Inbox.

### Does NOT ship in v1 (explicitly out of scope)
- Video replay (that's Sentry/LogRocket territory; add later only if needed).
- PagerDuty integration (gated behind Wave 6.10 Executive Command Center).
- Mobile native app equivalent (deferred until there's a native app).
- In-drawer chat with support (deferred).
- AI auto-triage / auto-labeling (deferred to v2).

---

## 2. File / Directory Layout (exact paths, create these)

```
apps/web/src/lib/flare/
├── FlareProvider.tsx              # React provider, mounts hotkey + ring buffers
├── FlareDrawer.tsx                # The slide-in UI
├── FlareAnnotator.tsx             # Canvas overlay on screenshot for drawing
├── captureContext.ts              # Builds the payload
├── ringBuffers.ts                 # Click / network / console / route buffers
├── redactPII.ts                   # PII + secret scrubber
├── screenshot.ts                  # html2canvas wrapper
├── flareClient.ts                 # POSTs to flare-submit edge function
├── useFlareHotkey.ts              # Hotkey hook
├── types.ts                       # FlareReport, FlareContext, Severity enums
└── __tests__/
    ├── redactPII.test.ts
    ├── ringBuffers.test.ts
    └── captureContext.test.ts

apps/web/src/pages/admin/
└── FlareAdminPage.tsx             # /admin/flare triage dashboard

apps/web/src/components/admin/flare/
├── FlareQueueTable.tsx
├── FlareDetailDrawer.tsx
├── FlareSeverityChip.tsx
└── FlareStatusChip.tsx

supabase/functions/flare-submit/
├── index.ts                       # Edge function
├── linear.ts                      # Linear dispatch helper
├── paperclip.ts                   # Paperclip dispatch helper
├── slack.ts                       # Slack webhook helper
├── email.ts                       # Resend / SMTP helper for fixed-notify + blocker alerts
└── safe-cors.ts                   # Import from ../_shared/safe-cors.ts

supabase/migrations/
└── 167_flare_reports.sql          # Table, indexes, RLS, trigger, storage bucket

apps/web/src/lib/flare/stories/    # Storybook (Wave 6.1 primitives pattern)
├── FlareDrawer.stories.tsx
└── FlareSeverityChip.stories.tsx
```

Mount `<FlareProvider>` inside `apps/web/src/App.tsx` inside the auth-gated tree, outside the router but inside the `QueryClientProvider` and the global shell. It must wrap everything else so the hotkey is global.

---

## 3. Data Flow — "How does the information get to me?"

This is the answer to Speedy's question. There are **five delivery lanes**, in order of priority. Lane 1 is never skipped. Lanes 2–5 are fire-and-forget and fail open.

```
┌──────────────────────────────────────────────────────────────────┐
│  USER hits Ctrl+Shift+B on any page                              │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
         ┌────────────────────────────────┐
         │ FlareProvider intercepts       │
         │ - captures screenshot          │
         │ - snapshots DOM (gzipped)      │
         │ - reads ring buffers           │
         │ - redacts PII + secrets        │
         │ - opens FlareDrawer            │
         └──────────────┬─────────────────┘
                        │
                        ▼
         ┌────────────────────────────────┐
         │ User types 1 sentence,         │
         │ picks severity, optional draw, │
         │ hits Cmd+Enter                 │
         └──────────────┬─────────────────┘
                        │
          POST /functions/v1/flare-submit
                        │
                        ▼
  ┌──────────────────────────────────────────────────────┐
  │ flare-submit EDGE FUNCTION (single entry, fan-out)   │
  │                                                      │
  │ Step 1: Auth check (JWT) — REQUIRED                  │
  │ Step 2: Rate limit check — REQUIRED                  │
  │ Step 3: Upload screenshot + dom_snapshot to Storage  │
  │         (bucket: flare-artifacts)                    │
  │ Step 4: INSERT into flare_reports — REQUIRED         │
  │ Step 5: Fan-out dispatch (parallel, fail-open):      │
  └───┬──────────┬──────────┬──────────┬──────────┬──────┘
      │          │          │          │          │
      ▼          ▼          ▼          ▼          ▼
  ┌───────┐ ┌────────┐ ┌──────┐ ┌────────┐ ┌──────────┐
  │LANE 1 │ │LANE 2  │ │LANE 3│ │LANE 4  │ │LANE 5    │
  │Supa   │ │Linear  │ │Paper │ │Slack   │ │Email     │
  │DB row │ │issue   │ │clip  │ │webhook │ │(blocker  │
  │(SoR)  │ │create  │ │issue │ │#qep-   │ │only →    │
  │       │ │        │ │      │ │flare   │ │Speedy)   │
  └───────┘ └────────┘ └──────┘ └────────┘ └──────────┘
      │         │          │          │          │
      └─────────┴──────────┴──────────┴──────────┘
                        │
                        ▼
         ┌────────────────────────────────┐
         │ Response: { report_id,         │
         │   linear_url, paperclip_url,   │
         │   slack_ts }                   │
         └──────────────┬─────────────────┘
                        │
                        ▼
  Toast: "Reported. Ticket QEP-1847 created. [View]"
```

### Lane 1 — Supabase (System of Record, blocking)
- Must succeed or the whole submission fails and the drawer shows an error.
- This is what the triage dashboard at `/admin/flare` reads from.
- This is what the Exception Inbox joins against.
- This is what the "seen N times this week" dedupe query runs against.
- **If Supabase is down, nothing else runs.** This is intentional — we will not dispatch to Linear/Paperclip without the audit row.

### Lane 2 — Linear (Ticketing, fail-open)
- Creates issue in Linear team `QEP` with title = first 80 chars of `user_description`, body = markdown including screenshot URL (signed 7-day), context summary, and a "View full context in QEP admin" link back to `/admin/flare/:report_id`.
- Labels: `flare`, `severity:{blocker|bug|annoyance|idea}`, `route:{route}`.
- Assigns to Speedy by default; round-robins to on-call engineer later.
- **If Linear API fails**, write `null` to `linear_issue_id` and `flare_reports.dispatch_errors.linear = <error>`. Do NOT retry inline — a cron job in Wave 6.11.1 will retry failed dispatches.

### Lane 3 — Paperclip (Agent pipeline, fail-open)
- Creates Paperclip issue in the QEP project, routed to the CEO agent for triage.
- Title + body same as Linear, plus `source: flare`, `flare_report_id: <uuid>`.
- Lets the 15-agent pipeline auto-triage, auto-route to the right sub-agent, and auto-draft a fix PR where possible.
- Same fail-open behavior as Linear.

### Lane 4 — Slack (Human notification, fail-open)
- POST to workspace Slack webhook `SLACK_FLARE_WEBHOOK_URL`.
- Channel: `#qep-flare` (or configured per-workspace in `workspace_settings.flare_slack_channel`).
- Message format:
  ```
  :rotating_light: *BLOCKER* from *Brian Lewis* (owner)
  > the save button on the quote builder spins forever after hitting save
  Page: /quotes/7234/edit  ·  Route: /quotes/:id/edit
  Seen 3 times this week on the same route.
  <screenshot thumbnail>
  [Open in QEP] [Open in Linear] [Open in Paperclip]
  ```
- Severity emoji: `:rotating_light:` blocker, `:bug:` bug, `:mag:` annoyance, `:bulb:` idea.
- Severity color: red / orange / yellow / blue.

### Lane 5 — Email (Blocker escalation, fail-open)
- Only fires when `severity = 'blocker'`.
- Sends via Resend (preferred) or SMTP fallback.
- Hardcoded recipient in v1: `blewis@lewisinsurance.com`. Move to `workspace_settings.flare_blocker_email_recipients` in v1.1.
- Subject: `[QEP BLOCKER] <first 60 chars of description>`
- Body: plain text with description, reporter name + role, URL, route, one-line context summary, deep-link to `/admin/flare/:report_id`, deep-link to Linear issue, signed screenshot URL (1-hour expiry).

### Answering "How do I get the information?"

Speedy, you get it in **four places simultaneously**, and you pick the one that fits your current context:

1. **Slack `#qep-flare`** — your real-time firehose. Watch this during active test phases. Low friction to see, triage, dismiss.
2. **Email inbox** — only for blockers. This is your "wake me up" lane. Nothing else hits email by default.
3. **`/admin/flare` inside QEP** — your triage queue. Full context, filters, status transitions, assign, mark fixed. This is where you close the loop.
4. **Linear + Paperclip** — your engineering work surfaces. Linear is for you to see, Paperclip is for the agent pipeline to auto-work on.

All five lanes point at the same `flare_reports` row in Supabase. The DB row is the source of truth; everything else is a projection of it.

### Reverse flow (close-the-loop)
When a flare's `status` is updated to `fixed` in any of those surfaces:
- DB trigger fires → calls `flare-notify-fixed` edge function.
- Sends email to the original reporter: "The bug you reported on {date} is fixed in the deploy that went out {time ago}. Thanks — this one caught {3} teammates before you flagged it."
- Posts threaded reply in Slack.
- Updates Linear + Paperclip issue state to `done`.

---

## 4. Captured Context Payload (canonical shape — DO NOT rename fields)

```typescript
// apps/web/src/lib/flare/types.ts

export type FlareSeverity = 'blocker' | 'bug' | 'annoyance' | 'idea';
export type FlareStatus =
  | 'new' | 'triaged' | 'in_progress' | 'fixed' | 'wontfix' | 'duplicate';

export interface FlareClickEvent {
  ts: number;              // epoch ms
  selector: string;        // CSS selector path, capped at 200 chars
  text: string | null;     // innerText, capped at 80 chars, PII-redacted
  x: number;
  y: number;
}

export interface FlareNetworkEvent {
  ts: number;
  url: string;             // with query params stripped if contains 'token','key','secret','password'
  method: string;
  status: number | null;   // null if failed
  duration_ms: number | null;
  error: string | null;
}

export interface FlareConsoleError {
  ts: number;
  level: 'error' | 'warn';
  message: string;         // capped at 500 chars
  stack: string | null;    // capped at 2000 chars
}

export interface FlareRouteChange {
  ts: number;
  from: string;
  to: string;
}

export interface FlareContext {
  // Identity
  user_id: string;
  workspace_id: string;
  reporter_email: string;
  reporter_role: string;     // 'owner'|'admin'|'manager'|'rep'|'portal_user'
  reporter_iron_role: string | null;

  // Location
  url: string;
  route: string;             // matched react-router path e.g. '/quotes/:id/edit'
  page_title: string;

  // Visible entities (scraped from data-entity-id / data-entity-type attrs on viewport elements)
  visible_entities: Array<{ type: string; id: string }>;

  // Ring buffer snapshots
  click_trail: FlareClickEvent[];        // last 10
  network_trail: FlareNetworkEvent[];    // last 10
  console_errors: FlareConsoleError[];   // last 50
  route_trail: FlareRouteChange[];       // last 10

  // State
  store_snapshot: Record<string, unknown> | null;  // zustand/redux, PII-redacted
  react_query_cache_keys: string[];                // stringified
  feature_flags: Record<string, boolean>;

  // Environment
  browser: string;
  os: string;
  viewport: { width: number; height: number; dpr: number };
  network_type: string | null;      // navigator.connection.effectiveType
  app_version: string;              // VITE_APP_VERSION
  git_sha: string;                  // VITE_GIT_SHA
  build_timestamp: string;          // VITE_BUILD_TIMESTAMP

  // Session
  session_id: string;               // generated once per tab, persisted in sessionStorage
  tab_id: string;
  time_on_page_ms: number;

  // Performance
  performance_metrics: {
    lcp_ms: number | null;
    fid_ms: number | null;
    cls: number | null;
    memory_used_mb: number | null;
  };
}

export interface FlareSubmitPayload {
  severity: FlareSeverity;
  user_description: string;        // required, 1-2000 chars
  screenshot_base64: string;       // PNG, capped at 2MB
  dom_snapshot_gzipped: string;    // base64 gzipped, capped at 500KB
  annotations: Array<{ type: 'arrow'|'circle'|'scribble'; points: number[] }>;
  context: FlareContext;
}

export interface FlareSubmitResponse {
  report_id: string;
  linear_issue_url: string | null;
  paperclip_issue_url: string | null;
  slack_ts: string | null;
  similar_count_last_7d: number;
}
```

---

## 5. Ring Buffers (how they get populated)

`apps/web/src/lib/flare/ringBuffers.ts` exports `installRingBuffers()` which is called once inside `FlareProvider` mount. It:

1. **Click trail:** adds a delegated `document.addEventListener('click', handler, true)` — captures target selector (compute stable selector via `@medv/finder` or inline equivalent), innerText (PII-redacted, capped 80), coords, timestamp. Keep last 10.
2. **Network trail:** monkey-patches `window.fetch` (wrap original, measure duration, record url/method/status/error). Keep last 10. **Strip any URL query param matching `/token|key|secret|password|jwt/i`.** Strip `Authorization` header references. Do NOT record request body or response body.
3. **Console errors:** monkey-patches `console.error` and `console.warn`. Also attaches `window.addEventListener('error', ...)` and `window.addEventListener('unhandledrejection', ...)`. Keep last 50. Cap message 500, stack 2000.
4. **Route trail:** monkey-patches `history.pushState` + `history.replaceState` + listens for `popstate`. Keep last 10.

All buffers are in-memory per tab. No persistence. No leak to other tabs.

Each buffer is a fixed-length array using shift-on-overflow.

---

## 6. PII + Secret Redaction (`redactPII.ts`)

Apply to: click-trail `text`, network-trail `url`, console-error `message` + `stack`, store snapshot values, visible-entity scraped text, DOM snapshot.

Redaction rules (regex-based, applied in order):

```typescript
const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const CC_LIKE = /\b(?:\d[ -]*?){13,16}\b/g;
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const BEARER = /Bearer\s+[A-Za-z0-9._-]+/gi;
const API_KEY_LIKE = /\b(sk_|pk_|rk_|whsec_|SG\.|xox[bps]-)[A-Za-z0-9_.-]{20,}/g;
```

Replace all matches with `[REDACTED]`.

**Always blank** any DOM element matching `input[type=password]`, `[data-flare-redact]`, `[autocomplete~="cc-number"]`, `[autocomplete~="cc-csc"]`.

**Password field values are never serialized.** When serializing store snapshots, deep-walk and drop any key matching `/password|secret|token|apiKey|api_key|jwt|authorization/i`.

Unit tests required in `__tests__/redactPII.test.ts` covering all 7 regex cases plus password-field DOM blanking plus store-snapshot key dropping.

---

## 7. Migration 167 — `supabase/migrations/167_flare_reports.sql`

```sql
-- Wave 6.11 Flare: in-app context-aware bug capture

create table if not exists flare_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete set null,
  reporter_role text not null,
  reporter_iron_role text,

  severity text not null check (severity in ('blocker','bug','annoyance','idea')),
  user_description text not null check (char_length(user_description) between 1 and 2000),

  -- Location
  url text not null,
  route text,
  page_title text,

  -- Captured context (all JSONB for flexibility)
  visible_entities jsonb not null default '[]'::jsonb,
  click_trail jsonb not null default '[]'::jsonb,
  network_trail jsonb not null default '[]'::jsonb,
  console_errors jsonb not null default '[]'::jsonb,
  route_trail jsonb not null default '[]'::jsonb,
  store_snapshot jsonb,
  react_query_cache_keys jsonb not null default '[]'::jsonb,
  feature_flags jsonb not null default '{}'::jsonb,

  -- Environment
  browser text,
  os text,
  viewport jsonb,           -- {width, height, dpr}
  network_type text,
  app_version text,
  git_sha text,
  build_timestamp timestamptz,

  -- Session
  session_id text,
  tab_id text,
  time_on_page_ms integer,
  performance_metrics jsonb,

  -- Storage artifacts
  screenshot_path text,      -- flare-artifacts/{workspace_id}/{id}/screenshot.png
  dom_snapshot_path text,    -- flare-artifacts/{workspace_id}/{id}/dom.html.gz
  annotations jsonb not null default '[]'::jsonb,

  -- Dispatch outcomes
  linear_issue_id text,
  linear_issue_url text,
  paperclip_issue_id text,
  paperclip_issue_url text,
  slack_ts text,
  dispatch_errors jsonb not null default '{}'::jsonb,

  -- Triage state
  status text not null default 'new'
    check (status in ('new','triaged','in_progress','fixed','wontfix','duplicate')),
  triaged_by uuid references auth.users(id),
  triaged_at timestamptz,
  assigned_to uuid references auth.users(id),
  resolution_notes text,
  duplicate_of uuid references flare_reports(id),
  fixed_at timestamptz,
  fix_deploy_sha text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index idx_flare_workspace_status_created
  on flare_reports (workspace_id, status, created_at desc);

create index idx_flare_severity_open
  on flare_reports (workspace_id, severity)
  where status in ('new','triaged','in_progress');

create index idx_flare_reporter
  on flare_reports (reporter_id, created_at desc);

create index idx_flare_route_dedupe
  on flare_reports (workspace_id, route, created_at desc)
  where status != 'duplicate';

create index idx_flare_fixed_at
  on flare_reports (fixed_at desc)
  where status = 'fixed';

-- RLS
alter table flare_reports enable row level security;

create policy flare_workspace_read on flare_reports
  for select using (workspace_id = get_my_workspace());

create policy flare_insert_own on flare_reports
  for insert with check (
    workspace_id = get_my_workspace()
    and reporter_id = auth.uid()
  );

create policy flare_admin_update on flare_reports
  for update using (
    workspace_id = get_my_workspace()
    and get_my_role() in ('owner','admin','manager')
  );

create policy flare_service_role_all on flare_reports
  for all to service_role using (true) with check (true);

create trigger trg_flare_reports_updated_at
  before update on flare_reports
  for each row execute function set_updated_at();

-- Rate limit helper table
create table if not exists flare_rate_limits (
  reporter_id uuid not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (reporter_id, window_start)
);

create index idx_flare_rate_limits_cleanup on flare_rate_limits (window_start);

-- Storage bucket (run separately via supabase client — migrations can't create buckets directly,
-- but we create the RLS policies here assuming bucket 'flare-artifacts' exists)
-- Bucket creation is handled in supabase/functions/flare-submit/index.ts on first run.

-- Fixed-notify trigger: fires when status transitions to 'fixed'
create or replace function notify_flare_fixed()
returns trigger language plpgsql as $$
begin
  if (old.status is distinct from 'fixed') and (new.status = 'fixed') then
    new.fixed_at = now();
    perform net.http_post(
      url := current_setting('app.settings.edge_url', true) || '/functions/v1/flare-notify-fixed',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object('report_id', new.id)
    );
  end if;
  return new;
end;
$$;

create trigger trg_flare_notify_fixed
  before update on flare_reports
  for each row execute function notify_flare_fixed();

comment on table flare_reports is
  'Wave 6.11 Flare: in-app bug/idea reports with full captured context. See WAVE-6.11-FLARE-BUILD-SPEC.md.';
```

Rollback migration `167_flare_reports_rollback.sql`:

```sql
drop trigger if exists trg_flare_notify_fixed on flare_reports;
drop function if exists notify_flare_fixed();
drop table if exists flare_rate_limits;
drop table if exists flare_reports cascade;
```

---

## 8. Edge Function — `supabase/functions/flare-submit/index.ts`

### Contract

- **Route:** `POST /functions/v1/flare-submit`
- **Auth:** JWT required. Extract `user_id`, `workspace_id` via `supabaseAdmin.auth.getUser(jwt)` + workspace lookup.
- **Body:** `FlareSubmitPayload` (see §4).
- **Response 200:** `FlareSubmitResponse`.
- **Response 401:** `{ error: 'unauthorized' }`
- **Response 429:** `{ error: 'rate_limited', retry_after_seconds: N }`
- **Response 400:** `{ error: 'invalid_payload', fields: [...] }`
- **Response 500:** `{ error: 'internal', report_id: null }` — Lane 1 failed.

### Steps

1. **CORS preflight** via shared `safe-cors.ts` `optionsResponse()`.
2. **Parse + validate payload.** Required: `severity`, `user_description` (1–2000), `context` with `workspace_id`, `url`, `route`. If invalid → `safeJsonErrorWithFields(400, 'invalid_payload', errors)`.
3. **Auth check.** If no JWT or user mismatch → 401.
4. **Rate limit.** UPSERT `flare_rate_limits` with `window_start = date_trunc('hour', now())`. If `count >= 20` → 429. Else increment.
5. **Insert flare_reports row** (status = 'new', dispatch_errors = {}). Capture `report_id`. If this fails → 500.
6. **Upload screenshot** to `flare-artifacts/{workspace_id}/{report_id}/screenshot.png`. On failure, log to `dispatch_errors.screenshot` but continue.
7. **Upload DOM snapshot** to `flare-artifacts/{workspace_id}/{report_id}/dom.html.gz`. Same fail-open behavior.
8. **Update row** with `screenshot_path` + `dom_snapshot_path`.
9. **Dedupe query:** count flare_reports in last 7 days where `workspace_id` matches, `route` matches, and `console_errors->0->>message` matches (if present). Capture `similar_count_last_7d`.
10. **Fan-out dispatch** using `Promise.allSettled`:
    - `dispatchToLinear(report)` → returns `{ issue_id, issue_url }` or throws.
    - `dispatchToPaperclip(report)` → same shape.
    - `dispatchToSlack(report, similar_count_last_7d)` → returns `{ ts }` or throws.
    - If `severity === 'blocker'`: `dispatchBlockerEmail(report)` → returns `void` or throws.
11. **Update row** with dispatch outcomes (IDs, URLs) and any `dispatch_errors`.
12. **Respond** with `FlareSubmitResponse`.

### Dispatch helpers

- `linear.ts` uses `LINEAR_API_KEY` env var. GraphQL mutation `issueCreate`. Team ID from `LINEAR_QEP_TEAM_ID`. Assignee from `LINEAR_DEFAULT_ASSIGNEE_ID`.
- `paperclip.ts` uses `PAPERCLIP_API_KEY` + `PAPERCLIP_BASE_URL`. REST POST to `/api/issues` per the `paperclip-core` skill.
- `slack.ts` uses `SLACK_FLARE_WEBHOOK_URL`. Uses Block Kit for the message. Includes signed screenshot URL (`createSignedUrl`, 7-day expiry).
- `email.ts` uses `RESEND_API_KEY` (preferred) or falls back to `SMTP_*` env vars. From: `flare@qep.app`. To: hardcoded `blewis@lewisinsurance.com` in v1.

### Zero-blocking rule (per CLAUDE.md)
If any dispatch env var is missing, log `dispatch_errors.{lane} = 'missing_credentials'`, do NOT throw, continue. Row is still created in Supabase. User still sees success toast. Admin dashboard surfaces the dispatch_errors field so Speedy can see which lane failed.

---

## 9. Edge Function — `supabase/functions/flare-notify-fixed/index.ts`

### Contract
- **Triggered by:** DB trigger `trg_flare_notify_fixed` after row transitions to `fixed`.
- **Body:** `{ report_id: string }`
- **Actions:**
  1. Load flare_report row.
  2. Look up reporter email.
  3. Send email via Resend: subject `Your bug report is fixed`, body mentions original description, fix deploy SHA, time-since-report.
  4. Post threaded Slack reply to `slack_ts` if present.
  5. PATCH Linear issue state → done (if `linear_issue_id`).
  6. PATCH Paperclip issue state → done (if `paperclip_issue_id`).
- All fail-open.

---

## 10. Frontend — `FlareProvider.tsx`

```typescript
// Pseudocode — Claude Code, implement in full.

export function FlareProvider({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'bug' | 'idea'>('bug');
  const [frozenContext, setFrozenContext] = useState<FlareContext | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [domSnapshot, setDomSnapshot] = useState<string | null>(null);

  // Install ring buffers once
  useEffect(() => {
    const uninstall = installRingBuffers();
    return uninstall;
  }, []);

  // Hotkey
  useFlareHotkey({
    onBug: async () => {
      const ctx = await buildContext();
      const [shot, dom] = await Promise.all([
        captureScreenshot(),
        captureDomSnapshot(),
      ]);
      setFrozenContext(ctx);
      setScreenshot(shot);
      setDomSnapshot(dom);
      setDrawerMode('bug');
      setDrawerOpen(true);
    },
    onIdea: async () => { /* same, mode = 'idea' */ },
  });

  return (
    <FlareContext.Provider value={{ /* ... */ }}>
      {children}
      <FlareDrawer
        open={drawerOpen}
        mode={drawerMode}
        context={frozenContext}
        screenshot={screenshot}
        domSnapshot={domSnapshot}
        onClose={() => setDrawerOpen(false)}
      />
    </FlareContext.Provider>
  );
}
```

### Hotkey hook

```typescript
// useFlareHotkey.ts
export function useFlareHotkey({ onBug, onIdea }: { onBug: () => void; onIdea: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod || !e.shiftKey) return;
      if (e.key === 'B' || e.key === 'b') {
        e.preventDefault();
        onBug();
      } else if (e.key === 'I' || e.key === 'i') {
        e.preventDefault();
        onIdea();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onBug, onIdea]);
}
```

**IMPORTANT:** The hotkey uses capture phase (`true`) so it fires even when focus is inside `contentEditable`, Monaco editor, etc. Prevent default so browser shortcuts don't swallow it.

### Drawer UX

- Slides in from right, width `420px` on desktop, full-width on mobile.
- Top: severity chips (Blocker / Bug / Annoyance / Idea). Default = Bug.
- Screenshot thumbnail, 240px tall. Click → opens annotator modal.
- Textarea: autofocus, placeholder `What went wrong?`, 1–2000 chars.
- "Also happened to N teammates this week" chip appears after context is built (fetched via a lightweight GET `/functions/v1/flare-dedupe-peek?route=&msg=` — optional v1.1).
- Buttons: `Cancel` (Esc) and `Submit` (Cmd+Enter).
- On submit: disable buttons, show spinner, POST, on success show toast with ticket link, close drawer.
- On error: show inline error, keep drawer open, do NOT lose user's typed text.

### Drawer is error-boundary safe
Wrap FlareProvider in its own error boundary so that if a bug exists in Flare itself, it does NOT break the host app. The error boundary catches and logs to console (not via ring buffer — that creates recursion).

---

## 11. Admin Triage Page — `/admin/flare`

Route: `apps/web/src/pages/admin/FlareAdminPage.tsx`. RBAC: `owner`, `admin`, `manager` only.

Layout:
- **Left:** filter bar (Wave 6.1 `FilterBar` primitive) — severity, status, reporter, route, date range.
- **Center:** `FlareQueueTable` — columns: severity chip, status chip, reporter, description (truncated), route, created_at (relative), `similar_count_last_7d` badge.
- **Right (on row click):** `FlareDetailDrawer` — shows full context, screenshot, DOM snapshot (rendered in sandboxed iframe with `sandbox="allow-same-origin"` only), click trail, network trail, console errors, store snapshot tree, feature flags, env info. Action buttons: `Mark triaged`, `Assign to...`, `Mark in progress`, `Mark fixed` (prompts for deploy SHA), `Mark wontfix`, `Mark duplicate of...`.

Top of page shows rollup cards: Open blockers, Open bugs, Fixed last 7d, Median time-to-fix, Top offending route.

---

## 12. Environment Variables (add to `.env.example` and Netlify config)

```
# Frontend (public, exposed via import.meta.env)
VITE_APP_VERSION=0.0.0
VITE_GIT_SHA=local
VITE_BUILD_TIMESTAMP=1970-01-01T00:00:00Z
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# Edge function (secret, set via `supabase secrets set`)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
LINEAR_API_KEY=
LINEAR_QEP_TEAM_ID=
LINEAR_DEFAULT_ASSIGNEE_ID=
PAPERCLIP_API_KEY=
PAPERCLIP_BASE_URL=
SLACK_FLARE_WEBHOOK_URL=
RESEND_API_KEY=
FLARE_BLOCKER_EMAIL_TO=blewis@lewisinsurance.com
FLARE_FROM_EMAIL=flare@qep.app
```

All edge-function secrets are loaded via `Deno.env.get`. Missing values → lane fails open, no crash.

---

## 13. Package Dependencies to Add

In `apps/web/package.json`:

```json
{
  "dependencies": {
    "html2canvas": "^1.4.1",
    "pako": "^2.1.0",
    "@medv/finder": "^3.2.0"
  },
  "devDependencies": {
    "@types/pako": "^2.0.3"
  }
}
```

No new backend deps — edge function uses Deno std + `@supabase/supabase-js` already in the project.

---

## 14. Test Plan

### Unit (vitest)
- `redactPII.test.ts` — 7 regex cases + password DOM + store snapshot key dropping.
- `ringBuffers.test.ts` — buffer overflow (11 clicks → keeps last 10), fetch monkey-patch preserves original behavior, console.error captured.
- `captureContext.test.ts` — builds valid `FlareContext`, visible_entities scraped correctly, performance_metrics shaped correctly when APIs unavailable.

### Integration (vitest + MSW)
- Mock `/functions/v1/flare-submit`, simulate 200 / 429 / 500, assert drawer behavior.
- Rate limit: submit 21 flares, 21st shows 429 error with retry time.

### E2E (playwright)
- `flare.e2e.ts`: open quote builder page, press `Cmd+Shift+B`, drawer opens, screenshot present, type description, submit, toast shows ticket ID, row exists in DB.
- `flare.hotkey.e2e.ts`: press hotkey while focus is inside a textarea — drawer still opens.
- `flare.password.e2e.ts`: type in password field, open flare, verify password value not present in DOM snapshot.

### Manual smoke (CLAUDE.md build gate)
- Deploy to staging.
- Press hotkey on 5 different pages. All open the drawer.
- Submit one blocker → verify Slack + email + Linear + Paperclip all get it.
- Submit one idea → verify only Slack gets it (not email).
- Kill Linear API key → submit → verify Supabase row created, `dispatch_errors.linear` populated, user still sees success toast.

---

## 15. Build Gate (per CLAUDE.md §Build and Release Gates)

Before closing Wave 6.11:

1. `bun run migrations:check` — 167 applies cleanly, rollback works.
2. `bun run build` (repo root).
3. `bun run build` in `apps/web`.
4. `bun run test` in `apps/web` — all Flare tests green.
5. Edge function test: `supabase functions serve flare-submit` + curl a payload, verify row inserted.
6. RLS check: as rep, can SELECT own workspace flares; cannot SELECT other workspace; can INSERT own; cannot UPDATE; as manager, can UPDATE.
7. Zero-blocking check: with all dispatch env vars unset, submission still succeeds and row is created.
8. Mission check: hotkey works on Iron Manager, Advisor, Woman, and Man role logins.

---

## 16. Pipeline Handoff (Paperclip routing)

This spec can be handed directly to the Paperclip CEO agent. Suggested agent routing:

- **Architect** → review this doc, produce blueprint from §§4, 7, 8 (no changes expected; doc is already blueprint-shaped).
- **Engineer** → build §§10, 11, 13 (frontend) and §§8, 9 (edge functions) in parallel.
- **Data & Integration** → build §7 migration and Storage bucket setup.
- **QA** → execute §14 test plan.
- **Security** → audit §6 redaction + §7 RLS + §12 secret hygiene.
- **DevOps** → deploy migration 167, edge functions, set secrets, verify Slack + Linear + Paperclip dispatch end-to-end on staging.
- **Quality Review** → verify §15 build gate.

Estimated effort: **4 engineer-days** (2 FE, 1 BE, 0.5 migration+RLS, 0.5 tests). Parallelizable to ~2 calendar days with Engineer + Data & Integration working simultaneously.

---

## 17. Definition of Done

- [ ] Migration 167 deployed to staging and production.
- [ ] `flare-artifacts` Storage bucket exists with RLS.
- [ ] `flare-submit` and `flare-notify-fixed` edge functions deployed.
- [ ] Hotkey works on every page in apps/web (verified on 10+ routes).
- [ ] Submission succeeds end-to-end: Supabase row + screenshot uploaded + Linear + Paperclip + Slack + (blocker) email all fire.
- [ ] Zero-blocking verified: with all 3rd-party creds missing, submission still persists.
- [ ] PII redaction unit tests green; manual password-field test passes.
- [ ] Admin dashboard at `/admin/flare` loads, filters work, status transitions work.
- [ ] Fixed-notify loop verified: mark row `fixed`, reporter receives email.
- [ ] Rate limit verified (21st flare in an hour returns 429).
- [ ] Documentation: this file committed at repo root + referenced from `QEP-OS-WAVE-5-6-ROADMAP.md` §6.11.
- [ ] Mission check signed off by Speedy.

---

**End of Wave 6.11 Flare build spec.**
