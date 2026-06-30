#!/usr/bin/env node
// scripts/roadmap-task.mjs
// CLI for daily task ops. All writes go to Supabase qep_roadmap_tasks;
// sync propagates to Linear.
//
// Usage:
//   npm run task A1.1                          # view details
//   npm run task A1.1 -- --start                # set in_progress
//   npm run task A1.1 -- --ship                 # set shipped
//   npm run task A1.1 -- --block "reason"       # set blocked + append dated note
//   npm run task A1.1 -- --pending "Q6"         # set pending_decision (sets blocking_decision)
//   npm run task A1.1 -- --defer "reason"       # set deferred + dated note
//   npm run task A1.1 -- --note "text"          # append dated note
//   npm run task A1.1 -- --unblock              # back to not_started
//   npm run task A1.1 -- --state shipped        # explicit ship_state
//   npm run task A1.1 -- --history              # show sync event history

import { SupabaseClient } from './lib/supabase.mjs';

function getArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
function hasFlag(name) { return process.argv.includes(name); }

const TASK_ID = process.argv[2];
if (!TASK_ID || TASK_ID.startsWith('--')) {
  console.error('Usage: npm run task <task_id> [-- --start|--ship|--block "reason"|--pending <code>|--defer "reason"|--note "text"|--unblock|--state <s>|--history]');
  process.exit(2);
}

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(2); }
}

const supa = new SupabaseClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });
const rows = await supa.select('qep_roadmap_tasks', {
  query: `select=*&task_id=eq.${encodeURIComponent(TASK_ID)}`,
});
const task = rows[0];
if (!task) {
  console.error(`No task with task_id=${TASK_ID}`);
  process.exit(3);
}

const SHOW_HISTORY = hasFlag('--history');
const START    = hasFlag('--start');
const SHIP     = hasFlag('--ship') || hasFlag('--complete');
const UNBLOCK  = hasFlag('--unblock');
const BLOCK    = getArg('--block');
const PENDING  = getArg('--pending');
const DEFER    = getArg('--defer');
const NOTE     = getArg('--note');
const STATE    = getArg('--state');

if (SHOW_HISTORY) {
  const events = await supa.select('qep_roadmap_sync_events', {
    query: `select=*&task_id=eq.${encodeURIComponent(TASK_ID)}&order=occurred_at.desc&limit=50`,
  });
  console.log(`Sync history for ${TASK_ID}:`);
  if (events.length === 0) {
    console.log('  (no events recorded)');
  } else {
    for (const e of events) {
      const dir = e.direction === 'supabase_to_linear' ? '→Lin' :
                  e.direction === 'linear_to_supabase' ? '←Lin' :
                  e.direction === 'pr_merge_comment' ? '↳PR' :
                  '⇆rec';
      const fields = e.changed_fields ? JSON.stringify(e.changed_fields) : '';
      console.log(`  ${e.occurred_at.replace('T', ' ').slice(0, 19)}  ${dir}  ${e.action.padEnd(7)}  ${fields}  ${e.actor ?? ''}`);
    }
  }
  process.exit(0);
}

// Determine patch
const patch = {};
let appendNote = '';
const today = new Date().toISOString().slice(0, 10);

if (STATE)    patch.ship_state = STATE;
if (START)    patch.ship_state = 'in_progress';
if (SHIP)     patch.ship_state = 'shipped';
if (UNBLOCK) {
  patch.ship_state = 'not_started';
  patch.blocking_decision = null;
  appendNote = `[${today}] Unblocked.`;
}
if (BLOCK !== null && BLOCK !== undefined) {
  patch.ship_state = 'blocked';
  appendNote = `[${today}] Blocked: ${BLOCK}`;
}
if (PENDING !== null && PENDING !== undefined) {
  patch.ship_state = 'pending_decision';
  patch.blocking_decision = PENDING;
  appendNote = `[${today}] Pending decision: ${PENDING}`;
}
if (DEFER !== null && DEFER !== undefined) {
  patch.ship_state = 'deferred';
  appendNote = `[${today}] Deferred: ${DEFER}`;
}
if (NOTE !== null && NOTE !== undefined) {
  const noteText = `[${today}] ${NOTE}`;
  appendNote = appendNote ? `${appendNote}\n${noteText}` : noteText;
}

if (appendNote) {
  patch.notes = task.notes ? `${task.notes}\n${appendNote}` : appendNote;
}

// No patch -> display
if (Object.keys(patch).length === 0) {
  console.log('━'.repeat(70));
  console.log(`${task.task_id} — ${task.title}`);
  console.log('━'.repeat(70));
  console.log(`Stream:    ${task.stream ?? '—'}`);
  console.log(`Wave:      ${task.wave ?? '—'}`);
  console.log(`Owner:     ${task.owner ?? '—'}`);
  console.log(`State:     ${task.ship_state}`);
  console.log(`Blocking:  ${task.blocking_decision ?? '—'}`);
  console.log(`Sync:      ${task.linear_sync_status} (synced ${task.linear_synced_at ?? 'never'})`);
  if (task.linear_sync_error) console.log(`Sync err:  ${task.linear_sync_error}`);
  if (task.description) console.log(`\nDescription:\n  ${task.description.split('\n').join('\n  ')}`);
  if (task.notes)       console.log(`\nNotes:\n  ${task.notes.split('\n').join('\n  ')}`);
  if (task.depends_on?.length) console.log(`\nDepends on: ${task.depends_on.join(', ')}`);
  if (task.evidence_link) console.log(`Evidence:   ${task.evidence_link}`);
  if (task.linear_url) console.log(`\nLinear: ${task.linear_url}`);
  console.log('━'.repeat(70));
  process.exit(0);
}

// Apply patch
await supa.patch('qep_roadmap_tasks', patch, { query: `id=eq.${task.id}` });
console.log(`✓ Updated ${task.task_id}:`);
for (const [k, v] of Object.entries(patch)) {
  const oldVal = task[k];
  if (k === 'notes') {
    const newLines = (v ?? '').split('\n').length - (oldVal ?? '').split('\n').length;
    console.log(`  notes: +${newLines} line(s) appended`);
  } else {
    console.log(`  ${k}: ${oldVal ?? '(null)'} → ${v}`);
  }
}
if (task.linear_issue_id) {
  console.log(`  Linear ${task.linear_issue_identifier} will sync within seconds (Edge Function) or by next cron.`);
} else {
  console.log(`  No Linear issue linked yet — run \`npm run import\` to create one.`);
}
