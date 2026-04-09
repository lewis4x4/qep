# Wave 6.11 Flare — Paperclip Pipeline Handoff

**Project:** QEP OS
**Repo:** `/Users/brianlewis/client-projects/qep`
**Owner:** Brian Lewis (Speedy)
**Build spec (source of truth):** `WAVE-6.11-FLARE-BUILD-SPEC.md` at repo root
**Estimated effort:** 4 engineer-days (parallelizable to ~2 calendar days)
**Dependencies:** None. Ships as cross-cutting infrastructure mounted at app shell.

---

## One-line summary

Ctrl+Shift+B anywhere in QEP OS → right-side drawer slides in with auto-captured screenshot, DOM, click/network/console/route trails, store snapshot, and env metadata → user types one sentence + severity → single edge function fans out to Supabase (SoR), Linear, Paperclip, Slack `#qep-flare`, and (blocker-only) email to Speedy.

---

## Pipeline routing

| Agent | Deliverable | Reads |
|---|---|---|
| **Architect** | Blueprint confirmation — no design changes expected; spec is already blueprint-shaped | BUILD-SPEC §§1–17 |
| **Data & Integration** | Migration 167 + `flare-artifacts` Storage bucket + RLS verification | BUILD-SPEC §7 |
| **Engineer (BE)** | `flare-submit` + `flare-notify-fixed` edge functions with Linear/Paperclip/Slack/Email dispatch helpers | BUILD-SPEC §§8–9 |
| **Engineer (FE)** | `FlareProvider` + `FlareDrawer` + ring buffers + PII redaction + hotkey + annotator + `/admin/flare` triage page | BUILD-SPEC §§10–11, 13 |
| **Security** | Audit PII regex set, RLS policies, secret redaction, rate limiting, Storage bucket ACL | BUILD-SPEC §§6, 7, 12 |
| **QA** | Unit + integration + e2e + manual smoke per test plan | BUILD-SPEC §14 |
| **DevOps** | Deploy migration 167, edge functions, set env secrets, end-to-end dispatch verification on staging | BUILD-SPEC §§12, 15 |
| **Quality Review** | Verify Definition of Done checklist | BUILD-SPEC §17 |

Engineer (FE) and Engineer (BE) run in parallel. Data & Integration blocks Engineer (BE).

---

## Work order

1. **Data & Integration** — apply migration 167, create `flare-artifacts` Storage bucket, verify RLS as rep / manager / owner, confirm rollback script works.
2. **Engineer (BE)** — build `flare-submit` with all five dispatch lanes and zero-blocking behavior. Build `flare-notify-fixed`. Unit tests.
3. **Engineer (FE)** — build ring buffers, PII redactor, capture context, hotkey, provider, drawer, annotator, client adapter. Unit tests.
4. **Engineer (FE)** — build `/admin/flare` triage page, queue table, detail drawer, status transitions.
5. **Security** — review all of the above against BUILD-SPEC §6, §7, §12.
6. **QA** — full test plan per BUILD-SPEC §14 including e2e flare from 5 different pages, rate limit test, password-field redaction test, zero-blocking test.
7. **DevOps** — deploy to staging, set secrets, run end-to-end smoke. Deploy to production.
8. **Quality Review** — verify DoD, hand back to CEO.

---

## Env secrets to set (DevOps)

```
LINEAR_API_KEY
LINEAR_QEP_TEAM_ID
LINEAR_DEFAULT_ASSIGNEE_ID
PAPERCLIP_API_KEY
PAPERCLIP_BASE_URL
SLACK_FLARE_WEBHOOK_URL
RESEND_API_KEY
FLARE_BLOCKER_EMAIL_TO=blewis@lewisinsurance.com
FLARE_FROM_EMAIL=flare@qep.app
```

Frontend envs (public):

```
VITE_APP_VERSION
VITE_GIT_SHA
VITE_BUILD_TIMESTAMP
```

Wire `VITE_GIT_SHA` and `VITE_BUILD_TIMESTAMP` through Netlify build command so every deploy stamps the version into the bundle.

---

## Acceptance criteria (Speedy's sign-off)

1. Hotkey works on 10+ pages including inside modals and contentEditable fields.
2. Submission creates DB row + screenshot in Storage + Linear issue + Paperclip issue + Slack message + (for blocker) email to blewis@lewisinsurance.com — all end-to-end on staging.
3. With all 3rd-party env vars cleared, submission still succeeds and row is created.
4. Password field never appears in DOM snapshot.
5. `/admin/flare` dashboard loads, filters work, status transitions work, fixed-notify loop sends email to reporter.
6. 21st flare in one hour returns 429.
7. Mission check: spec Section 0 criteria met.

---

## Commands to deploy

From `/Users/brianlewis/client-projects/qep`:

```bash
# Migration
supabase db push

# Edge functions
supabase functions deploy flare-submit
supabase functions deploy flare-notify-fixed

# Secrets
supabase secrets set LINEAR_API_KEY=xxx LINEAR_QEP_TEAM_ID=xxx LINEAR_DEFAULT_ASSIGNEE_ID=xxx
supabase secrets set PAPERCLIP_API_KEY=xxx PAPERCLIP_BASE_URL=xxx
supabase secrets set SLACK_FLARE_WEBHOOK_URL=xxx
supabase secrets set RESEND_API_KEY=xxx FLARE_BLOCKER_EMAIL_TO=blewis@lewisinsurance.com FLARE_FROM_EMAIL=flare@qep.app

# Build + deploy frontend
cd apps/web && bun run build
# Netlify auto-deploys on push to main
```

---

**Hand this file + `WAVE-6.11-FLARE-BUILD-SPEC.md` to Paperclip CEO agent. Everything else is in the spec.**
