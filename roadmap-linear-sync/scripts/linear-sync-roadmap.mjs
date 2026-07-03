#!/usr/bin/env node
// scripts/linear-sync-roadmap.mjs
// Delta sync: read v_qep_roadmap_tasks_pending_linear_sync and push updates to Linear.
// Safe to run repeatedly (cron, manual, post-merge).
//
// Usage:
//   LINEAR_API_KEY=... LINEAR_TEAM_KEY=QEP SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/linear-sync-roadmap.mjs
//
// Flags:
//   --dry-run                         Print actions without mutating.
//   --batch N                         Max rows to process per run (default 100).
//   --task-ids A1.1,B2.2              Only sync pending rows with these task IDs.
//   --linear-issue-identifiers QEP-1  Only sync pending rows with these Linear IDs.

import { LinearClient } from './lib/linear.mjs';
import { SupabaseClient } from './lib/supabase.mjs';
import { resolveStateId, STREAM_PROJECT_NAMES, deriveLabelNamesFromTask, labelColorFor } from './lib/status-map.mjs';
import { buildIssueBody, buildIssueTitle } from './lib/task-utils.mjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const batchIdx = args.indexOf('--batch');
const BATCH = batchIdx >= 0 ? parseInt(args[batchIdx + 1], 10) : 100;
const TASK_IDS = parseListFlags('--task-id', '--task-ids');
const LINEAR_ISSUE_IDENTIFIERS = parseListFlags('--linear-issue-identifier', '--linear-issue-identifiers');

const {
  LINEAR_API_KEY,
  LINEAR_TEAM_KEY = 'QEP',
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

for (const [k, v] of Object.entries({ LINEAR_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) {
  if (!v) {
    console.error(`Missing env var: ${k}`);
    process.exit(2);
  }
}

const log = (...a) => console.log('[sync]', ...a);

function parseListFlags(...names) {
  const values = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const eqName = names.find((name) => arg.startsWith(`${name}=`));
    if (eqName) {
      values.push(arg.slice(eqName.length + 1));
      continue;
    }
    if (names.includes(arg)) {
      values.push(args[i + 1] ?? '');
      i++;
    }
  }
  return [...new Set(values.flatMap((value) => String(value).split(',')).map((value) => value.trim()).filter(Boolean))];
}

function scopeDescription() {
  const parts = [];
  if (TASK_IDS.length > 0) parts.push(`task_ids=${TASK_IDS.join(',')}`);
  if (LINEAR_ISSUE_IDENTIFIERS.length > 0) parts.push(`linear_issue_identifiers=${LINEAR_ISSUE_IDENTIFIERS.join(',')}`);
  return parts.length > 0 ? ` scope(${parts.join(' ')})` : '';
}

async function main() {
  const linear = new LinearClient(LINEAR_API_KEY);
  const supa = new SupabaseClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });

  const team = await linear.getTeamByKey(LINEAR_TEAM_KEY);
  if (!team) throw new Error(`No team with key ${LINEAR_TEAM_KEY}`);

  const [states, projects, labels] = await Promise.all([
    linear.getWorkflowStates(team.id),
    linear.listProjects(team.id),
    linear.listLabels(team.id),
  ]);
  const projectByName = new Map(projects.map(p => [p.name, p]));
  const labelByName = new Map(labels.map(l => [l.name, l]));

  async function ensureLabel(name) {
    if (labelByName.has(name)) return labelByName.get(name);
    if (DRY_RUN) {
      const fake = { id: `dry-${name}`, name };
      labelByName.set(name, fake);
      return fake;
    }
    const created = await linear.createLabel({ teamId: team.id, name, color: labelColorFor(name) });
    labelByName.set(name, created);
    return created;
  }

  const pending = await supa.listPendingLinearSync(BATCH, {
    taskIds: TASK_IDS,
    linearIssueIdentifiers: LINEAR_ISSUE_IDENTIFIERS,
  });
  log(`${pending.length} task(s) need sync (batch limit ${BATCH})${scopeDescription()}`);

  let updated = 0;
  let createdMissing = 0;
  let errors = 0;

  for (const task of pending) {
    try {
      const stateId = resolveStateId(task.ship_state, states);
      const projectName = STREAM_PROJECT_NAMES[task.stream];
      const project = projectName ? projectByName.get(projectName) : null;

      const labelNames = ['mirrored-from-supabase', ...deriveLabelNamesFromTask(task)];
      const labelIds = [];
      for (const n of labelNames) labelIds.push((await ensureLabel(n)).id);

      const payload = {
        title: buildIssueTitle(task),
        description: buildIssueBody(task),
        stateId,
        labelIds,
      };
      if (project && !project.id.startsWith('dry-')) payload.projectId = project.id;

      if (task.linear_issue_id) {
        if (DRY_RUN) {
          log(`(dry-run) would update ${task.linear_issue_identifier} (${task.task_id})`);
        } else {
          const updatedIssue = await linear.updateIssue(task.linear_issue_id, payload);
          await supa.markLinearSynced(task.id, {
            linear_issue_id: updatedIssue.id,
            linear_issue_identifier: updatedIssue.identifier,
            linear_url: updatedIssue.url,
          });
        }
        updated++;
      } else {
        const createPayload = { teamId: team.id, ...payload };
        if (DRY_RUN) {
          log(`(dry-run) would CREATE missing issue for ${task.task_id}`);
        } else {
          const issue = await linear.createIssue(createPayload);
          await supa.markLinearSynced(task.id, {
            linear_issue_id: issue.id,
            linear_issue_identifier: issue.identifier,
            linear_url: issue.url,
          });
        }
        createdMissing++;
      }
    } catch (err) {
      errors++;
      const msg = err?.message ?? String(err);
      console.error(`[sync] ERROR on ${task.task_id}: ${msg}`);
      if (!DRY_RUN) {
        try {
          await supa.markLinearError(task.id, msg, task.linear_sync_attempt_count || 0);
        } catch (innerErr) {
          console.error(`[sync] also failed to record error: ${innerErr?.message}`);
        }
      }
    }
  }

  log(`Done. updated=${updated} created_missing=${createdMissing} errors=${errors}`);
  if (errors > 0) process.exit(1);
}

main().catch(err => {
  console.error('[sync] FATAL:', err);
  process.exit(1);
});
