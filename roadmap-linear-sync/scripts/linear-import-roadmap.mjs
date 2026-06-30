#!/usr/bin/env node
// scripts/linear-import-roadmap.mjs
// One-time import: read all qep_roadmap_tasks rows, create matching Linear issues,
// and write linear_issue_id / linear_issue_identifier / linear_url back to Supabase.
//
// Safe to re-run: if a task already has linear_issue_id, it's skipped.
// If a task is missing linear_issue_id but a matching issue exists in Linear
// (matched by `task_id:` line in description), we adopt it without creating a duplicate.
//
// Usage:
//   LINEAR_API_KEY=lin_api_... LINEAR_TEAM_KEY=QEP \
//   SUPABASE_URL=https://iciddijgonywtxoelous.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/linear-import-roadmap.mjs
//
// Flags:
//   --dry-run     Print what would happen without mutating.
//   --limit N     Cap the number of issues created (useful for first runs).

import { LinearClient } from './lib/linear.mjs';
import { SupabaseClient } from './lib/supabase.mjs';
import { resolveStateId, STREAM_PROJECT_NAMES, deriveLabelNamesFromTask, labelColorFor } from './lib/status-map.mjs';
import { buildIssueBody, buildIssueTitle } from './lib/task-utils.mjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;

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

const log = (...a) => console.log('[import]', ...a);

async function main() {
  const linear = new LinearClient(LINEAR_API_KEY);
  const supa = new SupabaseClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });

  const team = await linear.getTeamByKey(LINEAR_TEAM_KEY);
  if (!team) throw new Error(`No team with key ${LINEAR_TEAM_KEY}`);
  log(`Team: ${team.name}`);

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
      log(`(dry-run) would create label: ${name}`);
      return fake;
    }
    const created = await linear.createLabel({ teamId: team.id, name, color: labelColorFor(name) });
    labelByName.set(name, created);
    log(`Created label: ${name}`);
    return created;
  }

  const tasks = await supa.listAllRoadmapTasks();
  log(`Loaded ${tasks.length} qep_roadmap_tasks from Supabase`);

  let created = 0;
  let adopted = 0;
  let skipped = 0;
  let errors = 0;

  for (const task of tasks) {
    if (created + adopted >= LIMIT) {
      log(`Hit --limit ${LIMIT}, stopping.`);
      break;
    }

    try {
      // 1. Already linked? skip
      if (task.linear_issue_id) {
        skipped++;
        continue;
      }

      // 2. Look for an existing issue by task_id marker (adoption path)
      const existing = await linear.findIssueByTaskId(team.id, task.task_id);
      if (existing) {
        if (DRY_RUN) {
          log(`(dry-run) would adopt ${task.task_id} -> ${existing.identifier}`);
        } else {
          await supa.markLinearSynced(task.id, {
            linear_issue_id: existing.id,
            linear_issue_identifier: existing.identifier,
            linear_url: existing.url,
          });
        }
        adopted++;
        continue;
      }

      // 3. Build payload
      const stateId = resolveStateId(task.ship_state, states);
      const projectName = STREAM_PROJECT_NAMES[task.stream];
      const project = projectName ? projectByName.get(projectName) : null;
      const labelNames = deriveLabelNamesFromTask(task);
      const labelIds = [];
      labelIds.push((await ensureLabel('mirrored-from-supabase')).id);
      for (const name of labelNames) labelIds.push((await ensureLabel(name)).id);

      const input = {
        teamId: team.id,
        title: buildIssueTitle(task),
        description: buildIssueBody(task),
        stateId,
        labelIds,
      };
      if (project && !project.id.startsWith('dry-')) input.projectId = project.id;

      if (DRY_RUN) {
        log(`(dry-run) would create issue for ${task.task_id}: ${input.title}`);
        created++;
        continue;
      }

      const issue = await linear.createIssue(input);
      await supa.markLinearSynced(task.id, {
        linear_issue_id: issue.id,
        linear_issue_identifier: issue.identifier,
        linear_url: issue.url,
      });
      created++;
      if (created % 10 === 0) log(`Created ${created} so far...`);
    } catch (err) {
      errors++;
      const msg = err?.message ?? String(err);
      console.error(`[import] ERROR on ${task.task_id}: ${msg}`);
      if (!DRY_RUN) {
        try {
          await supa.markLinearError(task.id, msg, task.linear_sync_attempt_count || 0);
        } catch (innerErr) {
          console.error(`[import] also failed to record error: ${innerErr?.message}`);
        }
      }
    }
  }

  log(`Done. created=${created} adopted=${adopted} skipped=${skipped} errors=${errors}`);
  if (errors > 0) process.exit(1);
}

main().catch(err => {
  console.error('[import] FATAL:', err);
  process.exit(1);
});
