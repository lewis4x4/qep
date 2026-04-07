# Sentry Setup Guide for QEP OS (+ Lewis Insurance + Redex)

**Audience:** Speedy, step-by-step. Do these in order.
**Time:** ~45 minutes end-to-end for QEP. Add ~10 min per additional project.

---

## Step 1 — Create the Sentry organization

1. Go to https://sentry.io/signup/ and sign up with `blewis@lewisinsurance.com`.
2. When asked for organization name, use: **BlackRock AI** (this is your umbrella org — QEP, Lewis Insurance, Redex all live underneath).
3. Pick the **Team plan** ($26/mo base). Do NOT start on Developer free — it caps at 1 user and you'll outgrow it in a week.
4. Set on-demand budget cap: **$50/month**. This prevents surprise bills if a bug causes an error loop. You can raise it later.
5. Enable 2FA on your account immediately.

---

## Step 2 — Create projects (one per app, under the single org)

You will create multiple projects under the one BlackRock AI org. Each project is one app/surface. Naming convention: `{client}-{surface}`.

Create these now:

| Project name | Platform | Purpose |
|---|---|---|
| `qep-web` | React | QEP frontend (apps/web) |
| `qep-edge` | Deno | QEP Supabase edge functions |
| `lewis-insurance-web` | (whatever stack) | Lewis Insurance public site |
| `redex-ops` | React | Redex Operations internal apps |

For each project, Sentry generates a **DSN** (a URL like `https://abc123@o12345.ingest.sentry.io/67890`). Save each DSN — you'll paste them as env vars.

---

## Step 3 — Install in QEP frontend (`apps/web`)

From `/Users/brianlewis/client-projects/qep/apps/web`:

```bash
bun add @sentry/react
```

Create `apps/web/src/lib/sentry.ts`:

```typescript
import * as Sentry from '@sentry/react';

export function initSentry() {
  if (!import.meta.env.VITE_SENTRY_DSN) return;

  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_ENV || 'development',
    release: import.meta.env.VITE_GIT_SHA || 'local',

    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,          // privacy: mask all text by default
        blockAllMedia: true,
        maskAllInputs: true,
      }),
    ],

    // Cost control — tune these, they matter
    tracesSampleRate: 0.1,          // 10% of transactions
    replaysSessionSampleRate: 0.0,  // 0% of normal sessions
    replaysOnErrorSampleRate: 1.0,  // 100% of sessions that hit an error

    // Drop noise
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured',
      /Network request failed/i,
      /Load failed/i,
    ],
    denyUrls: [
      /extensions\//i,
      /^chrome:\/\//i,
      /^moz-extension:\/\//i,
    ],

    beforeSend(event) {
      // Strip auth headers defensively
      if (event.request?.headers) {
        delete event.request.headers['Authorization'];
        delete event.request.headers['Cookie'];
      }
      return event;
    },
  });
}
```

In `apps/web/src/main.tsx` (or wherever the React root mounts), add this **before** `ReactDOM.createRoot`:

```typescript
import { initSentry } from './lib/sentry';
initSentry();
```

Add env vars to `apps/web/.env.example`:

```
VITE_SENTRY_DSN=
VITE_ENV=development
```

Set the real DSN in Netlify dashboard → Site settings → Environment variables:
- `VITE_SENTRY_DSN` = the qep-web DSN from Step 2
- `VITE_ENV` = `production` (for the main site) or `staging` (for deploy previews if you have a staging branch)

---

## Step 4 — Identify users in Sentry (so you know WHO hit the error)

In your Supabase auth hook / app bootstrap after login, add:

```typescript
import * as Sentry from '@sentry/react';

Sentry.setUser({
  id: user.id,
  email: user.email,
  username: user.full_name,
  // custom fields
  workspace_id: user.workspace_id,
  role: user.role,
  iron_role: user.iron_role,
});
```

On logout:

```typescript
Sentry.setUser(null);
```

Now every error tells you exactly which dealership user hit it.

---

## Step 5 — Install in QEP edge functions (Deno)

For each edge function where you want Sentry (start with `flare-submit`, `voice-to-qrm`, `draft-email`, `tax-calculator`), add at the top:

```typescript
import * as Sentry from 'https://deno.land/x/sentry/index.mjs';

Sentry.init({
  dsn: Deno.env.get('SENTRY_DSN_EDGE'),
  environment: Deno.env.get('SUPABASE_ENV') || 'production',
  tracesSampleRate: 0.1,
});
```

Wrap your handler:

```typescript
serve(async (req) => {
  try {
    return await handleRequest(req);
  } catch (err) {
    Sentry.captureException(err);
    await Sentry.flush(2000);  // critical in serverless — flush before function exits
    return safeJsonError(500, 'internal');
  }
});
```

Set the secret:

```bash
supabase secrets set SENTRY_DSN_EDGE=<qep-edge DSN from Step 2>
```

---

## Step 6 — Source maps (so stack traces are readable)

Without source maps, your stack traces look like `main.a8f3c.js:1:45892`. With source maps, they look like `QuoteBuilderV2Page.tsx:142`.

Install the Vite plugin:

```bash
bun add -d @sentry/vite-plugin
```

In `apps/web/vite.config.ts`:

```typescript
import { sentryVitePlugin } from '@sentry/vite-plugin';

export default defineConfig({
  build: { sourcemap: true },
  plugins: [
    react(),
    sentryVitePlugin({
      org: 'blackrock-ai',
      project: 'qep-web',
      authToken: process.env.SENTRY_AUTH_TOKEN,
    }),
  ],
});
```

Create a Sentry auth token: Sentry dashboard → Settings → Account → API → Auth Tokens → Create New Token. Scopes: `project:releases`, `org:read`. Save as `SENTRY_AUTH_TOKEN` in Netlify env vars (NOT `VITE_` prefix — this stays server-side at build time).

---

## Step 7 — Wire Sentry into Flare (do this when Wave 6.11 ships)

In `apps/web/src/lib/flare/captureContext.ts`, add:

```typescript
import * as Sentry from '@sentry/react';

export function buildContext(): FlareContext {
  const sentryEventId = Sentry.lastEventId() || null;
  return {
    // ...existing fields...
    sentry_event_id: sentryEventId,
  };
}
```

Add column to `flare_reports`:

```sql
alter table flare_reports add column sentry_event_id text;
```

Then when you open a flare in `/admin/flare`, you get a "View in Sentry" link that jumps directly to the error trace. This is the combo that makes both tools 10x better together.

---

## Step 8 — Configure alerts

Sentry dashboard → Alerts → Create Alert.

Create these four to start:

1. **New issue in production** — when: a new unique issue is created, environment = production. Action: email blewis@lewisinsurance.com + post to Slack `#qep-alerts`.
2. **Issue affects >10 users** — when: users affected > 10 in 1h. Action: email + Slack.
3. **Error rate spike** — when: event frequency > 2x baseline. Action: email + Slack.
4. **Performance regression** — when: p95 transaction duration > 3s on `/quotes/:id/edit`. Action: email only (less noisy).

You can add Slack as an integration from Settings → Integrations → Slack.

---

## Step 9 — Add releases (so you know WHICH deploy broke it)

Every Netlify build should notify Sentry of a new release. Add to `apps/web/package.json` scripts:

```json
{
  "scripts": {
    "build": "vite build && sentry-cli releases new $VITE_GIT_SHA && sentry-cli releases set-commits $VITE_GIT_SHA --auto && sentry-cli releases finalize $VITE_GIT_SHA"
  }
}
```

Or simpler: the `@sentry/vite-plugin` from Step 6 handles this automatically if you pass `release: process.env.VITE_GIT_SHA` in the plugin config.

Set Netlify build command to export git SHA:

```bash
export VITE_GIT_SHA=$COMMIT_REF && bun run build
```

Now Sentry shows you "this error started appearing in release abc123def" and you can diff that against the previous release.

---

## Step 10 — Smoke test

Deploy to staging. Then:

1. Open the deployed QEP site.
2. In the browser console, run: `throw new Error('sentry smoke test')`.
3. Within 30 seconds, check Sentry dashboard → Issues. You should see the error with your user info, browser, URL, and a readable stack trace pointing to source code (if Step 6 worked).
4. Check the Alerts — you should get an email because it matched "New issue in production".

If all four work, Sentry is live.

---

## Cost expectations

- **Team plan:** $26/mo base.
- **Typical QEP usage in first 3 months:** probably within base quota at the sampling rates above (10% traces, 0% session replay). Expect $26–$40/mo.
- **Watch:** the on-demand dashboard in Sentry weekly for the first month. If replays or performance spans spike, drop sample rates.

---

## Repeat for other projects

For Lewis Insurance and Redex, repeat Steps 3, 4, 6, 7, 8 with the respective project DSN. Steps 1–2 are already done (one org, multiple projects under it).

---

## What you get after this

1. Every JS error in production lands in Sentry with user, workspace, route, release, and readable stack trace.
2. Every edge function exception lands in Sentry with request context.
3. Every Flare report can jump straight to the matching Sentry trace.
4. You get emailed on new issues, user-impact spikes, and error rate regressions.
5. You know exactly which deploy introduced which bug, because every release is tagged with its git SHA.

---

## Not yet, but later

- **PagerDuty integration** — wire when Wave 6.10 Executive Command Center ships.
- **Sentry Cron monitors** — wire when you have scheduled jobs (health score worker, attribution compute, geofence evaluator).
- **User feedback widget** — Sentry has a built-in one, but you're building Flare which is better. Don't enable Sentry's feedback widget — it would conflict.

**End of guide.**
