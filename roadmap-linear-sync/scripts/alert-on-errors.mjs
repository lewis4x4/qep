#!/usr/bin/env node
// scripts/alert-on-errors.mjs
// Reads v_qep_roadmap_sync_health and posts a Slack message if anything is wrong.
// Designed for a frequent cron (every 30 min). Without SLACK_WEBHOOK_URL prints
// to stdout instead.

import { SupabaseClient } from './lib/supabase.mjs';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SLACK_WEBHOOK_URL,
  ALERT_ERROR_THRESHOLD = '3',
  ALERT_RECENT_ERROR_THRESHOLD = '5',
  ALERT_STALE_PENDING_THRESHOLD = '5',
  ALERT_PENDING_BACKLOG_THRESHOLD = '25',
} = process.env;

const supa = new SupabaseClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });
const rows = await supa.select('v_qep_roadmap_sync_health', { query: 'select=*' });
const h = rows[0];

const issues = [];
if (h.error_count >= parseInt(ALERT_ERROR_THRESHOLD, 10)) {
  issues.push(`*${h.error_count}* task(s) in error state`);
}
if (h.errors_last_24h >= parseInt(ALERT_RECENT_ERROR_THRESHOLD, 10)) {
  issues.push(`*${h.errors_last_24h}* sync errors in last 24h`);
}
if (h.stale_pending_count >= parseInt(ALERT_STALE_PENDING_THRESHOLD, 10)) {
  issues.push(`*${h.stale_pending_count}* rows pending > 1 hour (Edge Function may be down)`);
}
if (h.pending_count >= parseInt(ALERT_PENDING_BACKLOG_THRESHOLD, 10)) {
  issues.push(`*${h.pending_count}* total pending — sync may be falling behind`);
}

if (issues.length === 0) {
  console.log('Health OK:', JSON.stringify(h));
  process.exit(0);
}

const summary = [
  ':rotating_light: *QEP Roadmap Sync Alert*',
  '',
  ...issues.map((i) => `• ${i}`),
  '',
  `Synced *${h.synced_count}* / Pending *${h.pending_count}* / Errors *${h.error_count}* (of ${h.total_tasks})`,
  `Last successful sync: ${h.last_synced_at ?? 'never'}`,
  '',
  '_Investigate:_',
  '```',
  "SELECT task_id, linear_sync_error, linear_sync_attempt_count",
  "FROM qep_roadmap_tasks WHERE linear_sync_status = 'error'",
  "ORDER BY linear_sync_attempt_count DESC;",
  '```',
].join('\n');

if (!SLACK_WEBHOOK_URL) {
  console.log(summary);
  console.log('\n(SLACK_WEBHOOK_URL not set; printed instead of posted.)');
  process.exit(1);
}

const res = await fetch(SLACK_WEBHOOK_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: summary, mrkdwn: true }),
});

if (!res.ok) {
  console.error(`Slack post failed: ${res.status} ${await res.text()}`);
  process.exit(2);
}
console.log('Posted alert to Slack.');
process.exit(1); // non-zero so GH Action surfaces the failure
