#!/usr/bin/env node
// scripts/roadmap-reconcile.mjs
// Audits every qep_roadmap_task against its Linear mirror. Reports drift.
// With --fix, marks rows for re-sync (does NOT push changes itself — sync runner does).
//
// Flags:
//   --fix       Mark drifting rows as linear_sync_status='pending' so sync runner repairs them
//   --verbose   Print every task, not just drift
//   --json      JSON output for scripting

import { LinearClient } from './lib/linear.mjs';
import { SupabaseClient } from './lib/supabase.mjs';
import { resolveStateId } from './lib/status-map.mjs';

const FIX = process.argv.includes('--fix');
const VERBOSE = process.argv.includes('--verbose');
const AS_JSON = process.argv.includes('--json');

const {
  LINEAR_API_KEY,
  LINEAR_TEAM_KEY = 'QEP',
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;
for (const [k, v] of Object.entries({ LINEAR_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(2); }
}

const linear = new LinearClient(LINEAR_API_KEY);
const supa = new SupabaseClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });

const team = await linear.getTeamByKey(LINEAR_TEAM_KEY);
if (!team) throw new Error(`No team with key ${LINEAR_TEAM_KEY}`);
const states = await linear.getWorkflowStates(team.id);

const tasks = await supa.listAllRoadmapTasks();

const report = {
  total: tasks.length,
  perfect: 0,
  no_linear_link: [],
  missing_in_linear: [],
  status_drift: [],
  api_errors: [],
  fixed: 0,
};

for (const task of tasks) {
  if (!task.linear_issue_id) {
    report.no_linear_link.push(task.task_id);
    if (FIX) {
      await supa.patch('qep_roadmap_tasks',
        { linear_sync_status: 'pending', linear_sync_attempt_count: 0 },
        { query: `id=eq.${task.id}` });
      report.fixed++;
    }
    continue;
  }

  try {
    const data = await linear.gql(`
      query($id:String!){
        issue(id:$id){ id identifier url state{ id name type } title }
      }
    `, { id: task.linear_issue_id });
    const issue = data.issue;

    if (!issue) {
      report.missing_in_linear.push(task.task_id);
      if (FIX) {
        await supa.patch('qep_roadmap_tasks',
          {
            linear_issue_id: null,
            linear_issue_identifier: null,
            linear_url: null,
            linear_sync_status: 'pending',
            linear_sync_attempt_count: 0,
          },
          { query: `id=eq.${task.id}` });
        report.fixed++;
      }
      continue;
    }

    const expectedStateId = resolveStateId(task.ship_state, states);
    if (issue.state.id !== expectedStateId) {
      report.status_drift.push({
        task_id: task.task_id,
        supabase_state: task.ship_state,
        linear_state: issue.state.name,
        linear_url: issue.url,
      });
      if (FIX) {
        await supa.patch('qep_roadmap_tasks',
          { linear_sync_status: 'pending', linear_sync_attempt_count: 0 },
          { query: `id=eq.${task.id}` });
        report.fixed++;
      }
      continue;
    }

    report.perfect++;
    if (VERBOSE) {
      console.log(`OK ${task.task_id} ↔ ${issue.identifier} (${issue.state.name})`);
    }
  } catch (err) {
    report.api_errors.push({ task_id: task.task_id, error: err?.message ?? String(err) });
  }
}

// Log a reconcile event summary
await fetch(`${SUPABASE_URL}/rest/v1/qep_roadmap_sync_events`, {
  method: 'POST',
  headers: {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  },
  body: JSON.stringify({
    direction: 'reconcile',
    action: report.no_linear_link.length + report.missing_in_linear.length + report.status_drift.length === 0 ? 'skip' : 'update',
    changed_fields: {
      perfect: report.perfect,
      no_linear_link: report.no_linear_link.length,
      missing_in_linear: report.missing_in_linear.length,
      status_drift: report.status_drift.length,
      api_errors: report.api_errors.length,
      fixed: report.fixed,
    },
    actor: FIX ? 'reconcile-fix' : 'reconcile-dry',
  }),
});

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.api_errors.length > 0 ? 1 : 0);
}

console.log('━'.repeat(70));
console.log(`Reconcile report (${report.total} tasks)`);
console.log('━'.repeat(70));
console.log(`  perfect:           ${report.perfect}`);
console.log(`  no_linear_link:    ${report.no_linear_link.length}${report.no_linear_link.length ? '  ' + report.no_linear_link.slice(0, 10).join(', ') + (report.no_linear_link.length > 10 ? '…' : '') : ''}`);
console.log(`  missing_in_linear: ${report.missing_in_linear.length}${report.missing_in_linear.length ? '  ' + report.missing_in_linear.slice(0, 10).join(', ') + (report.missing_in_linear.length > 10 ? '…' : '') : ''}`);
console.log(`  status_drift:      ${report.status_drift.length}`);
for (const d of report.status_drift.slice(0, 20)) {
  console.log(`    ${d.task_id}: supabase=${d.supabase_state} ↔ linear=${d.linear_state}`);
}
if (report.status_drift.length > 20) console.log(`    … and ${report.status_drift.length - 20} more`);
console.log(`  api_errors:        ${report.api_errors.length}`);
for (const e of report.api_errors.slice(0, 5)) console.log(`    ${e.task_id}: ${e.error}`);
if (FIX) console.log(`  marked for re-sync: ${report.fixed}`);
console.log('━'.repeat(70));

if (!FIX && (report.no_linear_link.length + report.missing_in_linear.length + report.status_drift.length > 0)) {
  console.log('Run with --fix to mark drifting rows for re-sync.');
}

if (report.api_errors.length > 0) process.exit(1);
