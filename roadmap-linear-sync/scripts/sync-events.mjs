#!/usr/bin/env node
// scripts/sync-events.mjs
// Query the qep_roadmap_sync_events audit log.
//
// Usage:
//   npm run events                       # last 25 events
//   npm run events -- --task A1.1        # events for one task
//   npm run events -- --errors            # only error/skip events
//   npm run events -- --since 24h         # last 24 hours
//   npm run events -- --direction linear_to_supabase
//   npm run events -- --limit 100

import { SupabaseClient } from './lib/supabase.mjs';

function getArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
function hasFlag(name) { return process.argv.includes(name); }

const TASK = getArg('--task');
const SINCE = getArg('--since');
const DIRECTION = getArg('--direction');
const LIMIT = parseInt(getArg('--limit') ?? '25', 10);
const ERRORS_ONLY = hasFlag('--errors');

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const supa = new SupabaseClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });

const parts = ['select=*', `order=occurred_at.desc`, `limit=${LIMIT}`];
if (TASK) parts.push(`task_id=eq.${encodeURIComponent(TASK)}`);
if (DIRECTION) parts.push(`direction=eq.${DIRECTION}`);
if (ERRORS_ONLY) parts.push(`action=in.(error,skip)`);
if (SINCE) {
  const m = SINCE.match(/^(\d+)([hd])$/);
  if (m) {
    const n = parseInt(m[1], 10);
    const ms = m[2] === 'h' ? n * 3600_000 : n * 86_400_000;
    const isoSince = new Date(Date.now() - ms).toISOString();
    parts.push(`occurred_at=gte.${isoSince}`);
  } else {
    parts.push(`occurred_at=gte.${SINCE}`);
  }
}

const events = await supa.select('qep_roadmap_sync_events', { query: parts.join('&') });
if (events.length === 0) {
  console.log('No matching events.');
  process.exit(0);
}

const dirSymbol = {
  supabase_to_linear: '→Lin',
  linear_to_supabase: '←Lin',
  reconcile: '⇆rec',
  pr_merge_comment: '↳PR',
};

console.log(`${events.length} event(s):`);
console.log('─'.repeat(100));
for (const e of events) {
  const ts = e.occurred_at.replace('T', ' ').slice(0, 19);
  const sym = dirSymbol[e.direction] ?? e.direction.slice(0, 4);
  const task = (e.task_id ?? '-').padEnd(8);
  const act = (e.action ?? '-').padEnd(7);
  const actor = (e.actor ?? '-').slice(0, 20).padEnd(20);
  const changed = e.changed_fields ? JSON.stringify(e.changed_fields).slice(0, 60) : '';
  const err = e.error_message ? ` ⚠ ${e.error_message.slice(0, 60)}` : '';
  console.log(`${ts}  ${sym}  ${task}  ${act}  ${actor}  ${changed}${err}`);
}
console.log('─'.repeat(100));
