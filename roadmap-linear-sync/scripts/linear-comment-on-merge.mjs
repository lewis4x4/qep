#!/usr/bin/env node
// scripts/linear-comment-on-merge.mjs
// Invoked by .github/workflows/pr-roadmap-comment.yml. Parses Roadmap: X.xx
// task IDs out of a PR's title and body, looks up the Linear issue for each,
// and posts a "PR landed" comment. Targets qep_roadmap_tasks.
//
// Required env (set by the workflow):
//   LINEAR_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   PR_TITLE, PR_BODY, PR_NUMBER, PR_URL, PR_AUTHOR, PR_MERGED_AT

import { LinearClient } from './lib/linear.mjs';
import { SupabaseClient } from './lib/supabase.mjs';
import { extractTaskIdsFromPR, buildPrLandedComment } from './lib/task-utils.mjs';

const {
  LINEAR_API_KEY,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  PR_TITLE = '',
  PR_BODY = '',
  PR_NUMBER = '0',
  PR_URL = '',
  PR_AUTHOR = 'unknown',
  PR_MERGED_AT = new Date().toISOString(),
} = process.env;

for (const [k, v] of Object.entries({ LINEAR_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) {
  if (!v) {
    console.error(`Missing env var: ${k}`);
    process.exit(2);
  }
}

const taskIds = extractTaskIdsFromPR([PR_TITLE, PR_BODY]);
if (taskIds.length === 0) {
  console.log(`No "Roadmap: X.xx" found in PR #${PR_NUMBER}. Nothing to do.`);
  process.exit(0);
}
console.log(`PR #${PR_NUMBER} references task_ids: ${taskIds.join(', ')}`);

const linear = new LinearClient(LINEAR_API_KEY);
const supa = new SupabaseClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });

let posted = 0;
let missing = 0;

for (const taskId of taskIds) {
  const rows = await supa.select('qep_roadmap_tasks', {
    query: `select=task_id,linear_issue_id,linear_issue_identifier&task_id=eq.${encodeURIComponent(taskId)}`,
  });
  const row = rows[0];
  if (!row) {
    console.warn(`No qep_roadmap_tasks row for task_id=${taskId}`);
    missing++;
    continue;
  }
  if (!row.linear_issue_id) {
    console.warn(`Task ${taskId} has no linear_issue_id. Run linear-import-roadmap first.`);
    missing++;
    continue;
  }
  try {
    await linear.createComment({
      issueId: row.linear_issue_id,
      body: buildPrLandedComment({
        prNumber: PR_NUMBER,
        prTitle: PR_TITLE,
        prUrl: PR_URL,
        author: PR_AUTHOR,
        mergedAt: PR_MERGED_AT,
      }),
    });
    console.log(`Commented on ${row.linear_issue_identifier} for task ${taskId}`);
    posted++;
  } catch (err) {
    console.error(`Failed to comment on task ${taskId}: ${err?.message ?? err}`);
  }
}

console.log(`Done. posted=${posted} missing=${missing}`);
if (missing > 0 && posted === 0) process.exit(1);
