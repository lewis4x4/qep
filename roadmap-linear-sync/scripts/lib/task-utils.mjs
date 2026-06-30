// scripts/lib/task-utils.mjs
// Builders, parsers, and formatters used by import / sync / Edge Function / GH Actions.
// QEP-specific column names: stream / wave / blocking_decision / evidence_link.

const TASK_ID_LINE_RE = /^task_id:\s*([A-Za-z0-9._-]+)\s*$/m;

/**
 * Build the canonical Linear issue body for a QEP roadmap task.
 * Includes a machine-readable metadata block (task_id) so sync runs can
 * re-find the issue even if linear_issue_id is lost.
 */
export function buildIssueBody(task) {
  const parts = [];
  if (task.description && task.description.trim()) {
    parts.push(task.description.trim());
    parts.push('');
  }
  if (task.notes && task.notes.trim()) {
    parts.push('### Notes');
    parts.push(task.notes.trim());
    parts.push('');
  }
  if (task.depends_on && Array.isArray(task.depends_on) && task.depends_on.length > 0) {
    parts.push('### Depends on');
    parts.push(task.depends_on.map(d => `- ${d}`).join('\n'));
    parts.push('');
  }
  if (task.blocking_decision) {
    parts.push('### Blocked by');
    parts.push(String(task.blocking_decision).trim());
    parts.push('');
  }
  if (task.evidence_link) {
    parts.push('### Evidence');
    parts.push(String(task.evidence_link).trim());
    parts.push('');
  }
  parts.push('---');
  parts.push('<!-- Mirrored from Supabase qep_roadmap_tasks. Edit in the QEP roadmap UI, not here. -->');
  parts.push('```yaml');
  parts.push(`task_id: ${task.task_id}`);
  if (task.stream) parts.push(`stream: ${task.stream}`);
  if (task.wave) parts.push(`wave: ${task.wave}`);
  if (task.owner) parts.push(`owner: ${task.owner}`);
  if (task.blocking_decision) parts.push(`blocking_decision: ${task.blocking_decision}`);
  parts.push('```');
  return parts.join('\n');
}

export function buildIssueTitle(task) {
  const prefix = task.task_id ? `${task.task_id} — ` : '';
  return `${prefix}${task.title || '(untitled)'}`.slice(0, 250);
}

export function extractTaskIdFromBody(body) {
  if (!body) return null;
  const m = body.match(TASK_ID_LINE_RE);
  return m ? m[1] : null;
}

/**
 * Parse "Roadmap: A1.1" (or "Roadmap: A1.1, B5.2") from a GitHub PR title or body.
 * Returns array of task_id strings (deduped, in order).
 */
const PR_ROADMAP_RE = /Roadmap:\s*([A-Za-z0-9._\-,\s]+)/gi;
export function extractTaskIdsFromPR(textBlocks) {
  const found = new Set();
  for (const text of textBlocks) {
    if (!text) continue;
    for (const match of text.matchAll(PR_ROADMAP_RE)) {
      const ids = match[1]
        .split(',')
        .map(s => s.trim())
        .filter(s => /^[A-Za-z0-9._-]+$/.test(s));
      for (const id of ids) found.add(id);
    }
  }
  return [...found];
}

export function buildPrLandedComment({ prNumber, prTitle, prUrl, author, mergedAt }) {
  return [
    `**PR landed** — [#${prNumber} ${prTitle}](${prUrl})`,
    '',
    `- Author: @${author}`,
    `- Merged: ${mergedAt}`,
    '',
    `_Posted automatically by the QEP roadmap → Linear sync. Status is not changed by PR merges; flip the task in the QEP roadmap UI._`,
  ].join('\n');
}

export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
